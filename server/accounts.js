// Identity, for the host that has more than one owner.
//
// The gate (server/gate.js) is one shared secret, and the vision is explicit
// that it gets thrown away at G2 because building identity before knowing what
// sharing needs of it is guessing. This is the throwing-away: an account is an
// email, a scrypt hash of a password, and an id that is also a folder name
// under `<data>/users/`.
//
// Two decisions worth stating, because both are the kind that survive a
// rewrite:
//
//   - the store is append-only JSONL, folded on read with later lines winning
//     — the same shape as `trash.jsonl` and the op log. A write that is only
//     ever an append cannot half-happen, and there is no schema migration for a
//     log, only a new kind of line.
//   - registration is invite-gated. A preview anybody can flood is a preview
//     that is down. A code carries a `uses` count so one of them can seat a lab
//     rather than a person.
//
// This repo has one dependency and it is not a password library, so scrypt is
// from `node:crypto` with the standard parameters written next to the call. A
// login is not a hot path.

import crypto from 'node:crypto';
import fsp from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);

// The standard interactive parameters. N is the work factor; r and p are fixed
// at the values every reference uses. 32 bytes out, to match the salt.
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 32 };
const SALT_BYTES = 16;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PASSWORD = 8;
const MAX_PASSWORD = 200;
const MAX_EMAIL = 254;

export class AccountError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AccountError';
    this.status = 400;
  }
}

const normalizeEmail = (input) => String(input ?? '').trim().toLowerCase();

/** An id that is also a legal path segment, so `<data>/users/<id>` needs no
 *  sanitising and cannot collide with the store's own `.marble`. Sixteen hex
 *  characters is 64 bits, which is enough when the id is never a secret. */
const newId = () => crypto.randomBytes(8).toString('hex');

const newCode = () => crypto.randomBytes(9).toString('base64url');

async function hashPassword(password) {
  const salt = crypto.randomBytes(SALT_BYTES);
  const derived = await scrypt(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return `scrypt$${salt.toString('hex')}$${derived.toString('hex')}`;
}

async function verifyPassword(password, stored) {
  const parts = String(stored ?? '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const salt = Buffer.from(parts[1], 'hex');
  const expected = Buffer.from(parts[2], 'hex');
  if (salt.length !== SALT_BYTES || expected.length !== SCRYPT.keylen) return false;
  const derived = await scrypt(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return crypto.timingSafeEqual(derived, expected);
}

export function createAccounts({ dir }) {
  const accountsLog = path.join(dir, 'accounts.jsonl');
  const invitesLog = path.join(dir, 'invites.jsonl');

  // One writer at a time, in this process. The CLI that mints an invite and the
  // host that spends it are two callers, but a single host process serialises
  // its own registrations so an invite with one use left cannot seat two.
  let writing = Promise.resolve();
  const serialize = (task) => {
    const next = writing.then(task, task);
    writing = next.catch(() => {});
    return next;
  };

  const readLines = async (file) => {
    const text = await fsp.readFile(file, 'utf8').catch(() => '');
    const out = [];
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // A truncated last line is what an interrupted append looks like.
      }
    }
    return out;
  };

  const append = (file, entry) =>
    fsp
      .mkdir(dir, { recursive: true })
      .then(() => fsp.appendFile(file, `${JSON.stringify(entry)}\n`));

  /** The identity log, folded to the current state. `user` seeds a record;
   *  every later line for that id patches it. */
  async function fold() {
    const users = new Map();
    for (const line of await readLines(accountsLog)) {
      if (line.kind === 'user') {
        users.set(line.id, {
          id: line.id,
          email: line.email,
          hash: line.hash,
          created: line.t,
          invite: line.invite ?? null,
        });
        continue;
      }
      const record = users.get(line.id);
      if (!record) continue;
      if (line.kind === 'password') record.hash = line.hash;
      if (line.kind === 'email') record.email = line.email;
    }
    return users;
  }

  /** Invite codes, with `used` counted from the `redeem` lines rather than
   *  written back — the log stays append-only. */
  async function foldInvites() {
    const invites = new Map();
    for (const line of await readLines(invitesLog)) {
      if (line.kind === 'invite') {
        invites.set(line.code, { code: line.code, note: line.note ?? null, uses: line.uses, used: 0 });
      } else if (line.kind === 'redeem') {
        const invite = invites.get(line.code);
        if (invite) invite.used += 1;
      }
    }
    return invites;
  }

  const strip = ({ id, email, created }) => ({ id, email, created });

  async function ready() {
    await fsp.mkdir(dir, { recursive: true });
  }

  async function get(id) {
    const record = (await fold()).get(id);
    return record ? strip(record) : null;
  }

  async function byEmail(email) {
    const wanted = normalizeEmail(email);
    for (const record of (await fold()).values()) {
      if (record.email === wanted) return strip(record);
    }
    return null;
  }

  async function list() {
    return [...(await fold()).values()]
      .sort((a, b) => a.created - b.created)
      .map(strip);
  }

  const count = async () => (await fold()).size;

  async function mintInvite({ note = null, uses = 1 } = {}) {
    const seats = Number.isInteger(uses) && uses > 0 ? uses : 1;
    const code = newCode();
    await serialize(() =>
      append(invitesLog, { t: Date.now(), kind: 'invite', code, note, uses: seats }),
    );
    return { code };
  }

  async function invites() {
    return [...(await foldInvites()).values()].map((invite) => ({
      ...invite,
      spent: invite.used >= invite.uses,
    }));
  }

  /** A new account. The invite is checked and spent inside the same serialised
   *  turn as the write, so a code with one seat left cannot admit two people
   *  who raced. */
  async function register({ email, password, invite } = {}) {
    const address = normalizeEmail(email);
    if (!EMAIL.test(address) || address.length > MAX_EMAIL) {
      throw new AccountError('that is not an email address');
    }
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      throw new AccountError(`a password is at least ${MIN_PASSWORD} characters`);
    }
    if (password.length > MAX_PASSWORD) {
      throw new AccountError(`a password is at most ${MAX_PASSWORD} characters`);
    }
    const code = String(invite ?? '').trim();
    if (!code) throw new AccountError('an invite code is required');

    const hash = await hashPassword(password);

    return serialize(async () => {
      const users = await fold();
      for (const record of users.values()) {
        if (record.email === address) throw new AccountError('that email is already registered');
      }

      const invited = (await foldInvites()).get(code);
      if (!invited) throw new AccountError('that invite code is not one of ours');
      if (invited.used >= invited.uses) throw new AccountError('that invite code is spent');

      const id = newId();
      await append(accountsLog, { t: Date.now(), kind: 'user', id, email: address, hash, invite: code });
      await append(invitesLog, { t: Date.now(), kind: 'redeem', code, by: id });
      return { id, email: address, created: Date.now() };
    });
  }

  /** The email and password at the door. `null` for every failure — a wrong
   *  password and an unknown email are the same answer on purpose. */
  async function authenticate({ email, password } = {}) {
    const address = normalizeEmail(email);
    if (!EMAIL.test(address) || typeof password !== 'string' || !password) return null;

    const record = [...(await fold()).values()].find((entry) => entry.email === address);
    if (!record) {
      // Spend the time a real verification would, so a missing account and a
      // wrong password are not tellable apart by the clock.
      await verifyPassword(password, `scrypt$${'0'.repeat(32)}$${'0'.repeat(64)}`).catch(() => {});
      return null;
    }
    return (await verifyPassword(password, record.hash)) ? strip(record) : null;
  }

  async function setPassword(id, password) {
    if (typeof password !== 'string' || password.length < MIN_PASSWORD) {
      throw new AccountError(`a password is at least ${MIN_PASSWORD} characters`);
    }
    const hash = await hashPassword(password);
    return serialize(async () => {
      if (!(await fold()).has(id)) throw new AccountError('no such account');
      await append(accountsLog, { t: Date.now(), kind: 'password', id, hash });
      return { id };
    });
  }

  return {
    dir,
    ready,
    get,
    byEmail,
    list,
    count,
    register,
    authenticate,
    setPassword,
    mintInvite,
    invites,
  };
}

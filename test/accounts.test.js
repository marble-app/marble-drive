import assert from 'node:assert/strict';
import fsp from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { AccountError, createAccounts } from '../server/accounts.js';

const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'marble-drive-accounts-'));
const accounts = createAccounts({ dir });
await accounts.ready();

/** Every real registration needs a fresh code, because a code is spent once. */
const seat = async (note = 'test') => (await accounts.mintInvite({ note })).code;

test('registration needs an invite, and spends it', async () => {
  await assert.rejects(
    accounts.register({ email: 'a@example.com', password: 'hunter2!!', invite: '' }),
    AccountError,
  );
  await assert.rejects(
    accounts.register({ email: 'a@example.com', password: 'hunter2!!', invite: 'not-a-code' }),
    /not one of ours/,
  );

  const code = await seat();
  const user = await accounts.register({ email: 'a@example.com', password: 'hunter2!!', invite: code });
  assert.match(user.id, /^[0-9a-f]{16}$/);
  assert.equal(user.email, 'a@example.com');

  // The same code a second time is spent.
  await assert.rejects(
    accounts.register({ email: 'b@example.com', password: 'hunter2!!', invite: code }),
    /spent/,
  );
});

test('a code with more than one seat admits more than one person', async () => {
  const { code } = await accounts.mintInvite({ note: 'a lab', uses: 3 });
  await accounts.register({ email: 'one@lab.edu', password: 'password-one', invite: code });
  await accounts.register({ email: 'two@lab.edu', password: 'password-two', invite: code });
  const listed = (await accounts.invites()).find((entry) => entry.code === code);
  assert.equal(listed.used, 2);
  assert.equal(listed.spent, false);

  await accounts.register({ email: 'three@lab.edu', password: 'password-3x', invite: code });
  await assert.rejects(
    accounts.register({ email: 'four@lab.edu', password: 'password-4x', invite: code }),
    /spent/,
  );
});

test('an email cannot register twice', async () => {
  const code = await seat();
  await assert.rejects(
    accounts.register({ email: 'A@Example.com', password: 'another-one', invite: code }),
    /already registered/,
  );
});

test('a bad email or a short password is refused before anything is written', async () => {
  const before = await accounts.count();
  await assert.rejects(accounts.register({ email: 'no-at-sign', password: 'longenough', invite: await seat() }), AccountError);
  await assert.rejects(accounts.register({ email: 'ok@ok.com', password: 'short', invite: await seat() }), /at least 8/);
  assert.equal(await accounts.count(), before);
});

test('authenticate returns the account for the right password and null otherwise', async () => {
  const found = await accounts.authenticate({ email: 'a@example.com', password: 'hunter2!!' });
  assert.equal(found.email, 'a@example.com');
  assert.equal(found.hash, undefined, 'the hash never leaves the module');

  assert.equal(await accounts.authenticate({ email: 'a@example.com', password: 'wrong' }), null);
  assert.equal(await accounts.authenticate({ email: 'nobody@example.com', password: 'hunter2!!' }), null);
});

test('setPassword takes effect and the old one stops working', async () => {
  const { id } = await accounts.byEmail('a@example.com');
  await accounts.setPassword(id, 'a-new-secret');
  assert.equal(await accounts.authenticate({ email: 'a@example.com', password: 'hunter2!!' }), null);
  assert.ok(await accounts.authenticate({ email: 'a@example.com', password: 'a-new-secret' }));
});

test('the state survives a reopen — it is a folded log, not memory', async () => {
  const reopened = createAccounts({ dir });
  const user = await reopened.byEmail('one@lab.edu');
  assert.ok(user);
  assert.ok(await reopened.authenticate({ email: 'one@lab.edu', password: 'password-one' }));
  assert.equal(await reopened.get('0'.repeat(16)), null);
});

test('the identity log is where it belongs and holds no cleartext password', async () => {
  const log = await fsp.readFile(path.join(dir, 'accounts.jsonl'), 'utf8');
  assert.ok(!log.includes('hunter2!!'));
  assert.ok(!log.includes('a-new-secret'));
  assert.match(log, /"kind":"user"/);
  assert.match(log, /scrypt\$/);
});

test.after(() => fsp.rm(dir, { recursive: true, force: true }));

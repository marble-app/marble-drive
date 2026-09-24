// A drive's own settings file, ~/.config/marble-drive/sprite.env on its sprite:
// KEY=value lines and # comments, read by tools/sprite/release.sh into the
// service's environment. The console changes it line by line, so the owner's
// comments and order survive, and refuses what the service cannot hold: the
// service's settings are one comma-separated list, so a comma would split a
// value silently, and a newline would start a line of its own.

const KEY = /^[A-Z_][A-Z0-9_]*$/;
const LINE = /^([A-Z_][A-Z0-9_]*)=(.*)$/;

/** A value that must never be shown or logged, known by its name. */
export const isSecret = (key) => /SECRET|KEY|TOKEN|PASSWORD|PASSPHRASE/.test(key);

/** The settings, in file order. Comments and blank lines are not settings. */
export function parse(text) {
  const out = [];
  for (const line of String(text ?? '').split('\n')) {
    const match = LINE.exec(line);
    if (match) out.push({ key: match[1], value: match[2] });
  }
  return out;
}

function check(key, value) {
  if (!KEY.test(key)) throw new Error(`${key} is not a setting's name (capitals, digits and _)`);
  if (/[\r\n]/.test(value)) throw new Error(`${key}: a value is one line`);
  if (value.includes(',')) throw new Error(`${key}: a value cannot hold a comma (the service's settings are a comma-separated list)`);
}

/** The file with `set` values changed in place or added at the end, and
 *  `unset` keys removed. Everything else is left exactly as it was. */
export function patch(text, { set = {}, unset = [] } = {}) {
  for (const [key, value] of Object.entries(set)) check(key, String(value));
  const drop = new Set(unset);
  const pending = new Map(Object.entries(set).map(([k, v]) => [k, String(v)]));
  const lines = String(text ?? '').replace(/\n$/, '').split('\n');
  const out = [];
  for (const line of lines) {
    const match = LINE.exec(line);
    if (!match) {
      out.push(line);
      continue;
    }
    const key = match[1];
    if (drop.has(key) && !pending.has(key)) continue;
    if (pending.has(key)) {
      out.push(`${key}=${pending.get(key)}`);
      pending.delete(key);
      continue;
    }
    out.push(line);
  }
  for (const [key, value] of pending) out.push(`${key}=${value}`);
  while (out.length && out[0] === '' && lines[0] !== '') out.shift();
  return `${out.join('\n')}\n`;
}

// The small things every route does, in one place so no route does them
// slightly differently.

export const send = (res, status, body, headers = {}) => {
  res.writeHead(status, { 'Cache-Control': 'no-store', ...headers });
  res.end(body);
};

export const json = (res, status, obj, headers = {}) =>
  send(res, status, JSON.stringify(obj), { 'Content-Type': 'application/json', ...headers });

export const text = (res, status, body, headers = {}) =>
  send(res, status, body, { 'Content-Type': 'text/plain; charset=utf-8', ...headers });

export const html = (res, status, body, headers = {}) =>
  send(res, status, body, { 'Content-Type': 'text/html; charset=utf-8', ...headers });

export async function readBody(req, limit) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) {
      const err = new Error(`request body is larger than ${limit} bytes`);
      err.status = 413;
      throw err;
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export const readJson = async (req, limit) => {
  const body = (await readBody(req, limit)).toString('utf8');
  if (!body.trim()) return {};
  try {
    return JSON.parse(body);
  } catch {
    const err = new Error('that body is not JSON');
    err.status = 400;
    throw err;
  }
};

export const escapeHtml = (value) =>
  String(value).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

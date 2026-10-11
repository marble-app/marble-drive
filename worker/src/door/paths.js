// worker/src/door/paths.js
// Where the door may send a browser after it signs in: a path, never another
// host. The same rules as the drive's own gate (server/gate.js returnPath),
// which cannot be imported here because the Worker has no node:crypto; a test
// holds the two to the same answers.

export function returnPath(to) {
  if (typeof to !== 'string' || !to.startsWith('/') || to.startsWith('//') || to.startsWith('/\\')) return '/';
  if (/[\u0000-\u001f\u007f]/.test(to)) return '/';
  try {
    const url = new URL(to, 'http://x');
    if (url.origin !== 'http://x') return '/';
    const result = url.pathname + url.search + url.hash;
    if (result.startsWith('//') || result.startsWith('/\\')) return '/';
    return new URL(result, 'http://x').origin === 'http://x' ? result : '/';
  } catch {
    return '/';
  }
}

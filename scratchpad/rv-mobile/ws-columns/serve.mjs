// Serves the untouched document with this workspace's part.css / part.js
// injected. The agent edits only part.css and part.js; rv.html is read-only,
// so four workspaces can run at once without ever touching the same bytes.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const dir = process.cwd();
const port = +(process.argv[2] || 8731);
const doc = path.join(dir, 'rv.html');

http.createServer((req, res) => {
  const url = (req.url || '/').split('?')[0];
  if (url === '/rv.html' || url === '/') {
    let html = fs.readFileSync(doc, 'utf8');
    const css = fs.existsSync(path.join(dir, 'part.css')) ? fs.readFileSync(path.join(dir, 'part.css'), 'utf8') : '';
    const js = fs.existsSync(path.join(dir, 'part.js')) ? fs.readFileSync(path.join(dir, 'part.js'), 'utf8') : '';
    // after every existing <style>, so the part wins ties on source order
    if (css) html = html.replace('</head>', `<style id="part-css">\n${css}\n</style>\n</head>`);
    // after every existing <script>, so the document's own behaviour is up
    if (js) html = html.replace('</body>', `<script id="part-js">\n${js}\n</script>\n</body>`);
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
    res.end(html);
    return;
  }
  res.writeHead(404).end('no');
}).listen(port, '127.0.0.1', () => console.log('preview on http://127.0.0.1:' + port + '/rv.html'));

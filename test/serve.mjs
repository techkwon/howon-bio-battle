// site/ 를 로컬에서 띄우는 작은 정적 서버 (npx serve 대신 — 내려받기 없음)
//   node test/serve.mjs [--port 8080]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.md': 'text/plain; charset=utf-8' };

export function startStatic({ port = 8080, root = path.join(here, '../site') } = {}) {
  const server = http.createServer((req, res) => {
    let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (p.endsWith('/')) p += 'index.html';
    const f = path.join(root, p);
    if (!f.startsWith(root)) { res.writeHead(403); return res.end(); }
    fs.readFile(f, (err, data) => {
      if (err) { res.writeHead(404); return res.end('not found'); }
      res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
      res.end(data);
    });
  });
  return new Promise(r => server.listen(port, '127.0.0.1', () => r({ server, port, close: () => server.close() })));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const i = process.argv.indexOf('--port');
  const s = await startStatic({ port: i > 0 ? Number(process.argv[i + 1]) : 8080 });
  console.log(`http://127.0.0.1:${s.port}/host.html  ·  http://127.0.0.1:${s.port}/`);
}

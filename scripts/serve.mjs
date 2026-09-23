import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';

const root = fileURLToPath(new URL('../dist/', import.meta.url));
const port = Number(process.env.PORT || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.webp': 'image/webp' };
http.createServer(async (req, res) => {
  try {
    if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    if (pathname === '/__atlas_health') {
      const body = JSON.stringify({ service: 'halann-historical-atlas', root, pid: process.pid });
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }
    const target = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    const relative = path.relative(root, target);
    if (relative.startsWith('..') || path.isAbsolute(relative)) { res.writeHead(403); res.end(); return; }
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
    res.writeHead(200, { 'Content-Type': types[path.extname(target)] || 'application/octet-stream', 'Content-Length': info.size, 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    if (req.method === 'HEAD') res.end();
    else {
      const stream = createReadStream(target);
      // A cancelled browser fetch must not keep the source file open on Windows.
      res.once('close', () => stream.destroy());
      stream.on('error', () => res.destroy());
      stream.pipe(res);
    }
  } catch { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); res.end('文件不存在'); }
}).listen(port, '127.0.0.1', () => console.log(`Halann Atlas · Local: http://127.0.0.1:${port}/`));

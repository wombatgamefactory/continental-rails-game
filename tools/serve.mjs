// serve.mjs - a tiny zero-dependency static file server for local play and tests.
//
//   node tools/serve.mjs 8080        serve the repo on http://localhost:8080
//   node tools/serve.mjs 0           pick a free port and print it
//
// ES modules and module Web Workers need http, not file://. Nothing is cached
// (every response says no-store), so an edited file is always the one served.
// Node built-ins only. Also exports startServer() for tests/ui-smoke.mjs.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
};

/** Resolves a request path to a file under ROOT, or null if it escapes ROOT. */
function resolvePath(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  const full = path.normalize(path.join(ROOT, decoded));
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) return null;
  return full;
}

function handler(req, res) {
  const headers = { 'Cache-Control': 'no-store, max-age=0', 'X-Content-Type-Options': 'nosniff' };
  let file = resolvePath(req.url || '/');
  if (file === null) {
    res.writeHead(403, headers);
    res.end('Forbidden');
    return;
  }
  fs.stat(file, (err, stat) => {
    if (!err && stat.isDirectory()) {
      file = path.join(file, 'index.html');
    }
    fs.readFile(file, (readErr, data) => {
      if (readErr) {
        res.writeHead(404, { ...headers, 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not found');
        return;
      }
      const type = MIME[path.extname(file).toLowerCase()] || 'application/octet-stream';
      res.writeHead(200, { ...headers, 'Content-Type': type, 'Content-Length': data.length });
      res.end(req.method === 'HEAD' ? undefined : data);
    });
  });
}

/**
 * Starts the server. Port 0 picks a free one.
 * @returns {Promise<{ server: http.Server, port: number, url: string, close: () => Promise<void> }>}
 */
export function startServer(port = 0) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.on('error', reject);
    server.listen(port, () => {
      const actual = server.address().port;
      resolve({
        server,
        port: actual,
        url: `http://localhost:${actual}/`,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const port = Number(process.argv[2] ?? 8080);
  startServer(port).then(({ url }) => {
    process.stdout.write(`Serving ${ROOT}\n${url}\n`);
  });
}

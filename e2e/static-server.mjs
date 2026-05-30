// Minimal static file server for the built WebUI (dist/web) with SPA fallback.
//
// Playwright launches this via the `webServer` block in playwright.config.ts.
// It serves the production build produced by `npm run build:web` and falls
// back to index.html for unknown routes so client-side routing (react-router)
// works. All /api, /auth and /health requests are mocked at the browser level
// via page.route() in the test fixtures, so this server never needs a backend.

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, normalize, extname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..', 'dist', 'web');
const PORT = Number(process.env.E2E_PORT) || 4173;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.map': 'application/json; charset=utf-8',
};

async function tryFile(path) {
  try {
    const info = await stat(path);
    if (info.isFile()) return await readFile(path);
  } catch {
    // not found
  }
  return null;
}

const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    // Strip query/hash, prevent path traversal outside ROOT.
    const safePath = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, '');
    let filePath = join(ROOT, safePath);

    let body = safePath === '/' ? null : await tryFile(filePath);

    // SPA fallback: serve index.html for any route without a file extension.
    if (!body) {
      filePath = join(ROOT, 'index.html');
      body = await tryFile(filePath);
    }

    if (!body) {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('Not found');
      return;
    }

    const type = MIME[extname(filePath)] || 'application/octet-stream';
    res.writeHead(200, { 'content-type': type });
    res.end(body);
  } catch (err) {
    res.writeHead(500, { 'content-type': 'text/plain' });
    res.end(`Server error: ${err instanceof Error ? err.message : String(err)}`);
  }
});

server.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`[e2e] static server serving ${ROOT} on http://localhost:${PORT}`);
});

import { stat, readFile } from 'node:fs/promises';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { checkSite } from './check-site.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '..', '..');
const distRoot = path.join(repoRoot, 'dist');

const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.wasm', 'application/wasm'],
]);

const args = new Set(process.argv.slice(2));
const headed = args.has('--headed');

await stat(path.join(distRoot, 'index.html'));

const server = http.createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    const pathname = decodeURIComponent(url.pathname);
    const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
    const filePath = path.resolve(distRoot, relativePath);

    if (!filePath.startsWith(distRoot)) {
      response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('forbidden');
      return;
    }

    const data = await readFile(filePath);
    response.writeHead(200, {
      'content-type': mimeTypes.get(path.extname(filePath)) ?? 'application/octet-stream',
    });
    response.end(data);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
    response.end('not found');
  }
});

try {
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 5175;
  const result = await checkSite({ url: `http://127.0.0.1:${port}/`, headed });
  console.log(JSON.stringify(result, null, 2));

  const seriousErrors = result.errors.filter((error) => !error.includes('/favicon.ico'));
  const seriousBadResponses = result.badResponses.filter((response) => !response.includes('/favicon.ico'));

  if (seriousErrors.length > 0 || seriousBadResponses.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

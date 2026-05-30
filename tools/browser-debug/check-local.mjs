import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';
import { checkSite } from './check-site.mjs';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '..', '..');

const args = new Set(process.argv.slice(2));
const headed = args.has('--headed');

const server = await createServer({
  configFile: path.join(repoRoot, 'tools', 'vite.config.mjs'),
  root: repoRoot,
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
  },
});

try {
  await server.listen();
  const url = server.resolvedUrls?.local?.[0] ?? 'http://127.0.0.1:5173/';
  const result = await checkSite({ url, headed });
  console.log(JSON.stringify(result, null, 2));

  const seriousErrors = result.errors.filter((error) => !error.includes('/favicon.ico'));
  const seriousBadResponses = result.badResponses.filter((response) => !response.includes('/favicon.ico'));

  if (seriousErrors.length > 0 || seriousBadResponses.length > 0) {
    process.exitCode = 1;
  }
} finally {
  await server.close();
}

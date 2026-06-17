import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const DEFAULT_URL = 'http://127.0.0.1:5173/';
const DEFAULT_PROJECT = 'music/2022-04-17.sunvox';

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '..', '..');

function parseArgs() {
  const raw = process.argv.slice(2);
  const options = new Set(raw.filter((value) => value.startsWith('--')));
  const open = options.has('--no-open') ? false : true;
  const projectArg = raw.find((value) => !value.startsWith('--'));
  return {
    open,
    project: projectArg || DEFAULT_PROJECT,
  };
}

function openInBrowser(url) {
  const target = url.replace(/&/g, '^&');
  let program = 'xdg-open';
  let args = [target];
  if (process.platform === 'win32') {
    program = 'cmd';
    args = ['/c', 'start', '""', `"${target}"`];
  } else if (process.platform === 'darwin') {
    program = 'open';
    args = [target];
  }
  spawn(program, args, { detached: true, stdio: 'ignore' }).unref();
}

async function main() {
  const { open, project } = parseArgs();
  console.log('Starting playback manual server...');

  const server = await createServer({
    configFile: path.join(repoRoot, 'tools', 'vite.config.mjs'),
    root: repoRoot,
    server: {
      host: '127.0.0.1',
      port: 5173,
      strictPort: false,
    },
  });

  await server.listen();
  const closeServer = () => {
    void server.close();
  };

  process.on('SIGINT', closeServer);
  process.on('SIGTERM', closeServer);

  const url = server.resolvedUrls?.local?.[0] ?? DEFAULT_URL;
  const targetUrl = new URL(url);
  targetUrl.hash = `#file=${encodeURIComponent(project)}`;

  console.log('Playback manual check is ready.');
  console.log(`Open URL: ${targetUrl.href}`);

  if (open) {
    openInBrowser(targetUrl.href);
  }

  console.log('Press Ctrl+C to stop.');

  await new Promise(() => {});
}

await main();

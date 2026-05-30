import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_URL = 'http://127.0.0.1:5173/';
const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '..', '..');
const screenshotPath = path.join(repoRoot, 'var', 'browser-debug', 'playwright-site-check.png');

async function launchBrowser(headed) {
  const launchOptions = { headless: !headed };
  try {
    return await chromium.launch(launchOptions);
  } catch (error) {
    return await chromium.launch({ ...launchOptions, channel: 'msedge' });
  }
}

export async function checkSite({ url = DEFAULT_URL, headed = false } = {}) {
  const browser = await launchBrowser(headed);
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = [];
    const badResponses = [];

    page.on('pageerror', (error) => {
      errors.push(`pageerror: ${error.message}`);
    });
    page.on('console', (message) => {
      if (message.type() === 'error') {
        const location = message.location();
        const suffix = location.url ? ` (${location.url}:${location.lineNumber}:${location.columnNumber})` : '';
        errors.push(`console.error: ${message.text()}${suffix}`);
      }
    });
    page.on('response', (response) => {
      if (response.status() >= 400) {
        badResponses.push(`${response.status()} ${response.url()}`);
      }
    });

    await page.goto(url, { waitUntil: 'networkidle' });

    const initial = await page.evaluate(() => ({
      title: document.title,
      h1: document.querySelector('h1')?.textContent ?? null,
      projectButtons: document.querySelectorAll('.project-button').length,
      selected: document.querySelector('#project-details h2')?.textContent ?? null,
      graphSections: document.querySelectorAll('.module-graph').length,
      graphNodes: document.querySelectorAll('.graph-nodes g').length,
      graphEdges: document.querySelectorAll('.graph-edges line').length,
      licenseLinks: document.querySelectorAll('.licenses a').length,
    }));

    const musicButton = page.locator('.project-button', { hasText: 'music/2022-04-17.sunvox' });
    const musicButtonCount = await musicButton.count();
    if (musicButtonCount !== 1) {
      throw new Error(`Expected one music project button, found ${musicButtonCount}`);
    }

    await musicButton.click();
    await page.waitForTimeout(250);

    const afterSelect = await page.evaluate(() => ({
      selected: document.querySelector('#project-details h2')?.textContent ?? null,
      graphSections: document.querySelectorAll('.module-graph').length,
      graphNodes: document.querySelectorAll('.graph-nodes g').length,
      graphEdges: document.querySelectorAll('.graph-edges line').length,
      patternRows: document.querySelectorAll('.pattern-row').length,
      moduleRows: document.querySelectorAll('.module-row').length,
    }));

    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: true });

    return {
      url,
      headed,
      initial,
      afterSelect,
      errors,
      badResponses,
      screenshot: path.relative(repoRoot, screenshotPath).replaceAll('\\', '/'),
    };
  } finally {
    await browser.close();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const args = new Set(process.argv.slice(2));
  const result = await checkSite({
    headed: args.has('--headed'),
    url: process.argv.slice(2).find((arg) => !arg.startsWith('--')) ?? DEFAULT_URL,
  });

  console.log(JSON.stringify(result, null, 2));

  const seriousErrors = result.errors.filter((error) => !error.includes('/favicon.ico'));
  const seriousBadResponses = result.badResponses.filter((response) => !response.includes('/favicon.ico'));

  if (seriousErrors.length > 0 || seriousBadResponses.length > 0) {
    process.exitCode = 1;
  }
}

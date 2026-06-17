import { chromium } from 'playwright';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const DEFAULT_URL = 'http://127.0.0.1:5173/';
const TARGET_MUSIC_PROJECT = 'music/2022-04-17.sunvox';
const PLAYBACK_START_TIMEOUT_MS = 5000;
const PLAYBACK_STOP_TIMEOUT_MS = 2000;
const AUDIO_SIGNAL_TIMEOUT_MS = 3000;
const AUDIO_SIGNAL_MIN_PEAK = 0.00001;
const AUDIO_SILENCE_MAX_PEAK = 0.00001;
const WAIT_POLL_MS = 50;
const FAVICON_PATTERN = /favicon\.ico/i;

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '..', '..');
const screenshotPath = path.join(repoRoot, 'var', 'browser-debug', 'playback-smoke.png');

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const headed = args.has('--headed');
const targetProject = rawArgs.find((arg) => !arg.startsWith('--')) ?? TARGET_MUSIC_PROJECT;

function formatState(state = {}) {
  return {
    ready: !!state.ready,
    isPlaying: !!state.isPlaying,
    isLoading: !!state.isLoading,
    loadedPath: state.loadedPath || '',
    loadingPath: state.loadingPath || '',
  };
}

function toTimeoutError(message, state, timeoutMs, elapsedMs) {
  return new Error(
    `${message} after ${elapsedMs.toFixed(0)}ms; last state ${JSON.stringify(formatState(state), null, 2)}`
  );
}

async function waitForPlaybackState(page, predicate, timeoutMs) {
  const start = Date.now();
  let state = formatState(await page.evaluate(() => window.getPlayerState?.() ?? {}));
  while (Date.now() - start < timeoutMs) {
    if (predicate(state)) {
      return state;
    }
    await page.waitForTimeout(WAIT_POLL_MS);
    state = formatState(await page.evaluate(() => window.getPlayerState?.() ?? {}));
  }
  throw toTimeoutError('Playback state condition was not met', state, timeoutMs, Date.now() - start);
}

function installAudioProbe() {
  if (AudioNode.prototype.__sunvoxPlaybackProbeInstalled) {
    return;
  }
  const originalConnect = AudioNode.prototype.connect;
  AudioNode.prototype.__sunvoxPlaybackProbeInstalled = true;
  AudioNode.prototype.connect = function connectWithPlaybackProbe(destination, ...args) {
    if (this.constructor?.name === 'AudioWorkletNode' && !window.__sunvoxPlaybackAnalyser && destination instanceof AudioNode) {
      try {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        originalConnect.call(this, analyser);
        originalConnect.call(analyser, destination);
        window.__sunvoxPlaybackAnalyser = analyser;
        window.__sunvoxPlaybackAudioContext = this.context;
        return destination;
      } catch (error) {
        window.__sunvoxPlaybackAnalyserError = error instanceof Error ? error.message : String(error);
      }
    }
    return originalConnect.call(this, destination, ...args);
  };
}

async function readAudioSignal(page) {
  return await page.evaluate(() => {
    const analyser = window.__sunvoxPlaybackAnalyser;
    if (!analyser) {
      return {
        available: false,
        error: window.__sunvoxPlaybackAnalyserError || 'AudioWorklet analyser was not attached',
      };
    }
    const samples = new Float32Array(analyser.fftSize);
    analyser.getFloatTimeDomainData(samples);
    let sum = 0;
    let peak = 0;
    for (const sample of samples) {
      sum += sample * sample;
      peak = Math.max(peak, Math.abs(sample));
    }
    return {
      available: true,
      rms: Math.sqrt(sum / samples.length),
      peak,
      audioContextState: window.__sunvoxPlaybackAudioContext?.state ?? null,
    };
  });
}

async function waitForAudioSignal(page, timeoutMs) {
  const start = Date.now();
  let signal = null;
  while (Date.now() - start < timeoutMs) {
    signal = await readAudioSignal(page);
    if (signal.available && signal.peak >= AUDIO_SIGNAL_MIN_PEAK) {
      return signal;
    }
    await page.waitForTimeout(WAIT_POLL_MS);
  }
  throw new Error(`Playback audio signal stayed silent after ${timeoutMs}ms; last signal ${JSON.stringify(signal)}`);
}

async function waitForAudioSilence(page, timeoutMs) {
  const start = Date.now();
  let signal = null;
  while (Date.now() - start < timeoutMs) {
    signal = await readAudioSignal(page);
    if (signal.available && signal.peak <= AUDIO_SILENCE_MAX_PEAK) {
      return signal;
    }
    await page.waitForTimeout(WAIT_POLL_MS);
  }
  throw new Error(`Playback audio signal stayed audible after ${timeoutMs}ms; last signal ${JSON.stringify(signal)}`);
}

async function launchBrowser() {
  const launchOptions = { headless: !headed };
  try {
    return await chromium.launch(launchOptions);
  } catch {
    return await chromium.launch({ ...launchOptions, channel: 'msedge' });
  }
}

async function checkPlayback({ url = DEFAULT_URL, projectPath = TARGET_MUSIC_PROJECT }) {
  const browser = await launchBrowser();
  const errors = [];
  const status = {
    ok: false,
    projectPath,
    errors: [],
  };

  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.addInitScript(installAudioProbe);
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
        errors.push(`HTTP ${response.status()}: ${response.url()}`);
      }
    });

    await page.goto(url, { waitUntil: 'networkidle' });

    const available = await page.evaluate(() => ({
      hasGetPlayerState: typeof window.getPlayerState === 'function',
      hasLoadAndPlay: typeof window.loadAndPlay === 'function',
    }));
    if (!available.hasGetPlayerState || !available.hasLoadAndPlay) {
      throw new Error(`Playback API missing: getPlayerState=${available.hasGetPlayerState}, loadAndPlay=${available.hasLoadAndPlay}`);
    }

    await page.waitForSelector('.project-button');
    const projectButton = page.locator('.project-button', { hasText: projectPath });
    const projectButtonCount = await projectButton.count();
    if (projectButtonCount !== 1) {
      throw new Error(`Expected exactly one match for ${projectPath}, found ${projectButtonCount}`);
    }
    await projectButton.click();
    await page.waitForTimeout(100);

    const playButton = page.locator('#topbar-controls button').first();
    await playButton.waitFor({ state: 'visible' });
    if (await playButton.isDisabled()) {
      throw new Error('Topbar play button is disabled');
    }
    await playButton.click();

    const playbackStarted = await waitForPlaybackState(
      page,
      (state) => state.isPlaying && !state.isLoading && state.loadedPath === projectPath,
      PLAYBACK_START_TIMEOUT_MS,
    );

    const audioSignal = await waitForAudioSignal(page, AUDIO_SIGNAL_TIMEOUT_MS);

    await page.waitForTimeout(100);

    const stopButton = page.locator('#topbar-controls button').nth(1);
    if (await stopButton.isDisabled()) {
      throw new Error('Topbar stop button is disabled');
    }
    await stopButton.click();
    const playbackStopped = await waitForPlaybackState(
      page,
      (state) => !state.isLoading && !state.isPlaying,
      PLAYBACK_STOP_TIMEOUT_MS,
    );
    const audioSignalAfterStop = await waitForAudioSilence(page, PLAYBACK_STOP_TIMEOUT_MS);

    await mkdir(path.dirname(screenshotPath), { recursive: true });
    await page.screenshot({ path: screenshotPath, fullPage: false });
    status.ok = true;
    status.errors = errors;
    status.playbackStarted = playbackStarted;
    status.playbackStopped = playbackStopped;
    status.audioSignal = audioSignal;
    status.audioSignalAfterStop = audioSignalAfterStop;
    status.screenshot = path.relative(repoRoot, screenshotPath).replaceAll('\\', '/');
  } catch (error) {
    status.errors.push(error instanceof Error ? error.message : String(error));
  } finally {
    await browser.close();
  }

  return status;
}

async function main() {
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
    const url = server.resolvedUrls?.local?.[0] ?? DEFAULT_URL;
    const result = await checkPlayback({ url, projectPath: targetProject });
    result.errors = result.errors.filter((error) => !FAVICON_PATTERN.test(error));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok || result.errors.length > 0) {
      process.exitCode = 1;
    }
  } finally {
    await server.close();
  }
}

await main();

import { chromium, devices } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const DEFAULT_URL = 'http://127.0.0.1:5173/';
const TARGET_SYNTH = 'generated/instruments/Scratch FMX Tines.sunsynth';
const TARGET_NOTE_LABEL = 'C5';
const TARGET_NOTE = 60;
const TARGET_VELOCITY = 128;
const AUDIO_SIGNAL_TIMEOUT_MS = 3000;
const AUDIO_SIGNAL_MIN_PEAK = 0.00001;
const WAIT_POLL_MS = 50;
const FAVICON_PATTERN = /favicon\.ico/i;

const packageDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(packageDir, '..', '..');

const rawArgs = process.argv.slice(2);
const args = new Set(rawArgs);
const headed = args.has('--headed');
const targetSynth = rawArgs.find((arg) => !arg.startsWith('--')) ?? TARGET_SYNTH;

function installAudioProbe() {
  if (AudioNode.prototype.__sunvoxMobileTapProbeInstalled) {
    return;
  }
  const originalConnect = AudioNode.prototype.connect;
  AudioNode.prototype.__sunvoxMobileTapProbeInstalled = true;
  AudioNode.prototype.connect = function connectWithMobileTapProbe(destination, ...args) {
    if (this.constructor?.name === 'AudioWorkletNode' && !window.__sunvoxMobileTapAnalyser && destination instanceof AudioNode) {
      try {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        originalConnect.call(this, analyser);
        originalConnect.call(analyser, destination);
        window.__sunvoxMobileTapAnalyser = analyser;
        window.__sunvoxMobileTapAudioContext = this.context;
        return destination;
      } catch (error) {
        window.__sunvoxMobileTapAnalyserError = error instanceof Error ? error.message : String(error);
      }
    }
    return originalConnect.call(this, destination, ...args);
  };
}

async function readAudioSignal(page) {
  return await page.evaluate(() => {
    const analyser = window.__sunvoxMobileTapAnalyser;
    if (!analyser) {
      return {
        available: false,
        error: window.__sunvoxMobileTapAnalyserError || 'AudioWorklet analyser was not attached',
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
      audioContextState: window.__sunvoxMobileTapAudioContext?.state ?? null,
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
  throw new Error(`Mobile synth tap stayed silent after ${timeoutMs}ms; last signal ${JSON.stringify(signal)}`);
}

async function launchBrowser() {
  const launchOptions = { headless: !headed };
  try {
    return await chromium.launch(launchOptions);
  } catch {
    return await chromium.launch({ ...launchOptions, channel: 'msedge' });
  }
}

async function checkMobileSynthTap({ url = DEFAULT_URL, synthPath = TARGET_SYNTH }) {
  const browser = await launchBrowser();
  const errors = [];
  const status = {
    ok: false,
    synthPath,
    note: TARGET_NOTE,
    noteLabel: TARGET_NOTE_LABEL,
    errors: [],
  };

  try {
    const context = await browser.newContext(devices['iPhone 13']);
    const page = await context.newPage();
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

    const targetUrl = new URL(url);
    targetUrl.hash = `file=${encodeURIComponent(synthPath)}`;
    await page.goto(targetUrl.href, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      (noteLabel) =>
        typeof window.playSynthNote === 'function' &&
        typeof window.stopSynthNote === 'function' &&
        document.querySelector(`.piano-key[aria-label="${noteLabel}"]`),
      TARGET_NOTE_LABEL,
    );

    await page.evaluate(() => {
      const originalPlaySynthNote = window.playSynthNote;
      window.__sunvoxMobileTapCalls = [];
      window.playSynthNote = async (...args) => {
        window.__sunvoxMobileTapCalls.push(args);
        return await originalPlaySynthNote(...args);
      };
    });

    await page.locator('.virtual-keyboard-frame').scrollIntoViewIfNeeded();
    await page.locator(`.piano-key[aria-label="${TARGET_NOTE_LABEL}"]`).tap();
    const audioSignal = await waitForAudioSignal(page, AUDIO_SIGNAL_TIMEOUT_MS);
    const playCalls = await page.evaluate(() => window.__sunvoxMobileTapCalls ?? []);
    const expectedCall = playCalls.some(
      ([urlValue, noteValue, velocityValue]) =>
        urlValue === synthPath && noteValue === TARGET_NOTE && velocityValue === TARGET_VELOCITY,
    );
    if (!expectedCall) {
      throw new Error(`Mobile tap did not call playSynthNote as expected: ${JSON.stringify(playCalls)}`);
    }

    status.ok = true;
    status.errors = errors;
    status.audioSignal = audioSignal;
    status.playCalls = playCalls;
    status.viewport = page.viewportSize();
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
    const result = await checkMobileSynthTap({ url, synthPath: targetSynth });
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

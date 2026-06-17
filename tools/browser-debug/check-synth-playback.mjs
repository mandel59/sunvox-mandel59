import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

const DEFAULT_URL = 'http://127.0.0.1:5173/';
const TARGET_SYNTH = 'instruments/mandel59 shepard.sunsynth';
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
  if (AudioNode.prototype.__sunvoxSynthProbeInstalled) {
    return;
  }
  const originalConnect = AudioNode.prototype.connect;
  AudioNode.prototype.__sunvoxSynthProbeInstalled = true;
  AudioNode.prototype.connect = function connectWithSynthProbe(destination, ...args) {
    if (this.constructor?.name === 'AudioWorkletNode' && !window.__sunvoxSynthAnalyser && destination instanceof AudioNode) {
      try {
        const analyser = this.context.createAnalyser();
        analyser.fftSize = 2048;
        originalConnect.call(this, analyser);
        originalConnect.call(analyser, destination);
        window.__sunvoxSynthAnalyser = analyser;
        window.__sunvoxSynthAudioContext = this.context;
        return destination;
      } catch (error) {
        window.__sunvoxSynthAnalyserError = error instanceof Error ? error.message : String(error);
      }
    }
    return originalConnect.call(this, destination, ...args);
  };
}

async function readAudioSignal(page) {
  return await page.evaluate(() => {
    const analyser = window.__sunvoxSynthAnalyser;
    if (!analyser) {
      return {
        available: false,
        error: window.__sunvoxSynthAnalyserError || 'AudioWorklet analyser was not attached',
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
      audioContextState: window.__sunvoxSynthAudioContext?.state ?? null,
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
  throw new Error(`Synth audio signal stayed silent after ${timeoutMs}ms; last signal ${JSON.stringify(signal)}`);
}

async function waitForAudioSilence(page, timeoutMs) {
  const start = Date.now();
  let signal = null;
  while (Date.now() - start < timeoutMs) {
    signal = await readAudioSignal(page);
    if (signal.available && signal.peak < AUDIO_SIGNAL_MIN_PEAK) {
      return signal;
    }
    await page.waitForTimeout(WAIT_POLL_MS);
  }
  throw new Error(`Synth audio signal stayed active after topbar stop for ${timeoutMs}ms; last signal ${JSON.stringify(signal)}`);
}

async function launchBrowser() {
  const launchOptions = { headless: !headed };
  try {
    return await chromium.launch(launchOptions);
  } catch {
    return await chromium.launch({ ...launchOptions, channel: 'msedge' });
  }
}

async function checkSynthPlayback({ url = DEFAULT_URL, synthPath = TARGET_SYNTH }) {
  const browser = await launchBrowser();
  const errors = [];
  const status = {
    ok: false,
    synthPath,
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
    await page.waitForFunction(
      () =>
        typeof window.preloadSynth === 'function' &&
        typeof window.playSynthNote === 'function' &&
        typeof window.stopSynthNote === 'function',
    );

    const preload = await page.evaluate((pathValue) => window.preloadSynth(pathValue), synthPath);
    if (preload === false) {
      throw new Error(`preloadSynth returned false for ${synthPath}`);
    }
    const transport = await page.evaluate(() => window.getAudioTransportState?.() ?? null);
    const noteOn = await page.evaluate(
      ({ pathValue, note, velocity }) => window.playSynthNote(pathValue, note, velocity),
      { pathValue: synthPath, note: TARGET_NOTE, velocity: TARGET_VELOCITY },
    );
    if (noteOn === false) {
      throw new Error(`playSynthNote returned false for ${synthPath}`);
    }

    const audioSignal = await waitForAudioSignal(page, AUDIO_SIGNAL_TIMEOUT_MS);
    const stateDuringSynth = await page.evaluate(() => window.getPlayerState?.() ?? null);
    const noteOff = await page.evaluate((note) => window.stopSynthNote(note), TARGET_NOTE);
    await page.waitForTimeout(700);
    const audioSignalAfterOff = await readAudioSignal(page);
    const stateAfterOff = await page.evaluate(() => window.getPlayerState?.() ?? null);

    const noteOnForTopbarStop = await page.evaluate(
      ({ pathValue, note, velocity }) => window.playSynthNote(pathValue, note, velocity),
      { pathValue: synthPath, note: TARGET_NOTE, velocity: TARGET_VELOCITY },
    );
    if (noteOnForTopbarStop === false) {
      throw new Error(`playSynthNote returned false before topbar stop for ${synthPath}`);
    }
    const audioSignalBeforeTopbarStop = await waitForAudioSignal(page, AUDIO_SIGNAL_TIMEOUT_MS);
    const topbarStopDisabled = await page.evaluate(
      () => document.querySelector('#topbar-controls button:nth-of-type(2)')?.disabled ?? null,
    );
    if (topbarStopDisabled !== false) {
      throw new Error(`topbar stop button should stay enabled, got disabled=${topbarStopDisabled}`);
    }
    await page.locator('#topbar-controls button').nth(1).click();
    const audioSignalAfterTopbarStop = await waitForAudioSilence(page, AUDIO_SIGNAL_TIMEOUT_MS);
    const stateAfterTopbarStop = await page.evaluate(() => window.getPlayerState?.() ?? null);

    status.ok = true;
    status.errors = errors;
    status.preload = preload;
    status.noteOn = noteOn;
    status.noteOff = noteOff;
    status.noteOnForTopbarStop = noteOnForTopbarStop;
    status.transport = transport;
    status.audioSignal = audioSignal;
    status.audioSignalAfterOff = audioSignalAfterOff;
    status.audioSignalBeforeTopbarStop = audioSignalBeforeTopbarStop;
    status.audioSignalAfterTopbarStop = audioSignalAfterTopbarStop;
    status.stateDuringSynth = stateDuringSynth;
    status.stateAfterOff = stateAfterOff;
    status.stateAfterTopbarStop = stateAfterTopbarStop;
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
    const result = await checkSynthPlayback({ url, synthPath: targetSynth });
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

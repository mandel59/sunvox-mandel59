import { readFile } from "node:fs/promises";

import { buildContainer, parseContainer } from "./sunvox-codec.mjs";

const BS1770_OFFSET_LUFS = -0.691;
const K_WEIGHT_HIGH_SHELF = Object.freeze({
  frequency: 1681.974450955533,
  q: 0.7071752369554196,
  gainDb: 3.99984385397,
});
const K_WEIGHT_HIGH_PASS = Object.freeze({
  frequency: 38.13547087602444,
  q: 0.5003270373238773,
});
const ACTIVE_GATE_DB = -24;
const ACTIVE_TOP_RATIO = 0.7;
const BS1770_CHANNEL_WEIGHTS = Object.freeze([1, 1, 1, 1.41, 1.41]);

export function deterministicIconBase64(seed, salt) {
  let state = (Math.imul(seed + 1, 0x45d9f3b) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  const bytes = Buffer.alloc(32);
  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }
  return bytes.toString("base64");
}

function normalizeBiquad({ b0, b1, b2, a0, a1, a2 }) {
  return {
    b0: b0 / a0,
    b1: b1 / a0,
    b2: b2 / a0,
    a1: a1 / a0,
    a2: a2 / a0,
  };
}

function highPassBiquad(sampleRate, frequency, q) {
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const cos = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  return normalizeBiquad({
    b0: (1 + cos) / 2,
    b1: -(1 + cos),
    b2: (1 + cos) / 2,
    a0: 1 + alpha,
    a1: -2 * cos,
    a2: 1 - alpha,
  });
}

function highShelfBiquad(sampleRate, frequency, q, gainDb) {
  const amplitude = 10 ** (gainDb / 40);
  const omega = (2 * Math.PI * frequency) / sampleRate;
  const cos = Math.cos(omega);
  const alpha = Math.sin(omega) / (2 * q);
  const rootAmplitude = Math.sqrt(amplitude);
  return normalizeBiquad({
    b0: amplitude * ((amplitude + 1) + (amplitude - 1) * cos + 2 * rootAmplitude * alpha),
    b1: -2 * amplitude * ((amplitude - 1) + (amplitude + 1) * cos),
    b2: amplitude * ((amplitude + 1) + (amplitude - 1) * cos - 2 * rootAmplitude * alpha),
    a0: (amplitude + 1) - (amplitude - 1) * cos + 2 * rootAmplitude * alpha,
    a1: 2 * ((amplitude - 1) - (amplitude + 1) * cos),
    a2: (amplitude + 1) - (amplitude - 1) * cos - 2 * rootAmplitude * alpha,
  });
}

function applyBiquad(samples, channels, coefficients) {
  const output = new Float64Array(samples.length);
  for (let channel = 0; channel < channels; channel += 1) {
    let x1 = 0;
    let x2 = 0;
    let y1 = 0;
    let y2 = 0;
    for (let index = channel; index < samples.length; index += channels) {
      const x0 = samples[index];
      const y0 =
        coefficients.b0 * x0 +
        coefficients.b1 * x1 +
        coefficients.b2 * x2 -
        coefficients.a1 * y1 -
        coefficients.a2 * y2;
      output[index] = y0;
      x2 = x1;
      x1 = x0;
      y2 = y1;
      y1 = y0;
    }
  }
  return output;
}

function kWeightedSamples(samples, channels, sampleRate) {
  const shelved = applyBiquad(
    samples,
    channels,
    highShelfBiquad(sampleRate, K_WEIGHT_HIGH_SHELF.frequency, K_WEIGHT_HIGH_SHELF.q, K_WEIGHT_HIGH_SHELF.gainDb),
  );
  return applyBiquad(shelved, channels, highPassBiquad(sampleRate, K_WEIGHT_HIGH_PASS.frequency, K_WEIGHT_HIGH_PASS.q));
}

function kWeightedPower(samples, channels, startFrame, endFrame) {
  const frameCount = Math.floor(samples.length / channels);
  const start = Math.max(0, Math.min(frameCount, Math.round(startFrame)));
  const end = Math.max(start, Math.min(frameCount, Math.round(endFrame)));
  const frames = end - start;
  if (!frames) {
    return 0;
  }
  let weightedPower = 0;
  for (let channel = 0; channel < channels; channel += 1) {
    let sumSquares = 0;
    for (let frame = start; frame < end; frame += 1) {
      const value = samples[frame * channels + channel];
      sumSquares += value * value;
    }
    weightedPower += (BS1770_CHANNEL_WEIGHTS[channel] ?? 1) * (sumSquares / frames);
  }
  return weightedPower;
}

function frameLufs(samples, channels, startFrame, endFrame) {
  const power = kWeightedPower(samples, channels, startFrame, endFrame);
  return powerToLufs(power);
}

function powerToLufs(power) {
  return power > 0 ? BS1770_OFFSET_LUFS + 10 * Math.log10(power) : Number.NEGATIVE_INFINITY;
}

function frameRmsPower(samples, channels, startFrame, endFrame) {
  const frameCount = Math.floor(samples.length / channels);
  const start = Math.max(0, Math.min(frameCount, Math.round(startFrame)));
  const end = Math.max(start, Math.min(frameCount, Math.round(endFrame)));
  const frames = end - start;
  if (!frames) {
    return 0;
  }
  let sumSquares = 0;
  for (let frame = start; frame < end; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = samples[frame * channels + channel];
      sumSquares += value * value;
    }
  }
  return sumSquares / (frames * channels);
}

function envelopeWindows(samples, channels, sampleRate, windowMs = 20) {
  const frameCount = Math.floor(samples.length / channels);
  const windowFrames = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const windows = [];
  for (let start = 0; start < frameCount; start += windowFrames) {
    const end = Math.min(frameCount, start + windowFrames);
    const rmsPower = frameRmsPower(samples, channels, start, end);
    windows.push({
      startFrame: start,
      endFrame: end,
      centerFrame: (start + end) / 2,
      rmsPower,
      rms: Math.sqrt(rmsPower),
    });
  }
  return windows;
}

function activeRange(windows) {
  if (!windows.length) {
    return {
      startFrame: 0,
      endFrame: 0,
      windowCount: 0,
      threshold: 0,
      peakRms: 0,
      activePower: 0,
      activeLufs: Number.NEGATIVE_INFINITY,
      topActivePower: 0,
      topActiveLufs: Number.NEGATIVE_INFINITY,
      topWindowCount: 0,
    };
  }

  let peakRms = 0;
  for (const window of windows) {
    if (window.rms > peakRms) {
      peakRms = window.rms;
    }
  }

  const threshold = Math.max(1e-6, peakRms * 10 ** (ACTIVE_GATE_DB / 20));
  const activeWindows = windows.filter((window) => window.rms >= threshold);
  if (!activeWindows.length) {
    const first = windows[0];
    return {
      startFrame: first.startFrame,
      endFrame: first.endFrame,
      windowCount: 0,
      threshold,
      peakRms,
      activePower: 0,
      activeLufs: Number.NEGATIVE_INFINITY,
      topActivePower: 0,
      topActiveLufs: Number.NEGATIVE_INFINITY,
      topWindowCount: 0,
    };
  }

  let activePower = 0;
  for (const window of activeWindows) {
    activePower += window.rmsPower;
  }
  activePower /= activeWindows.length;

  const sortedPowers = activeWindows.map((window) => window.rmsPower).sort((left, right) => left - right);
  const topWindowCount = Math.max(1, Math.round(sortedPowers.length * ACTIVE_TOP_RATIO));
  const topActivePower = sortedPowers
    .slice(sortedPowers.length - topWindowCount)
    .reduce((total, value) => total + value, 0) / topWindowCount;

  return {
    startFrame: activeWindows[0].startFrame,
    endFrame: activeWindows.at(-1).endFrame,
    windowCount: activeWindows.length,
    threshold,
    peakRms,
    activePower,
    activeLufs: powerToLufs(activePower),
    topActivePower,
    topActiveLufs: powerToLufs(topActivePower),
    topWindowCount,
  };
}

function maxWindowLufs(samples, channels, sampleRate, startFrame, endFrame, windowMs) {
  const frameCount = Math.floor(samples.length / channels);
  const clampedStart = Math.max(0, Math.min(frameCount, Math.round(startFrame)));
  const clampedEnd = Math.max(clampedStart, Math.min(frameCount, Math.round(endFrame)));
  if (clampedEnd <= clampedStart) {
    return Number.NEGATIVE_INFINITY;
  }
  const windowFrames = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  if (clampedEnd - clampedStart <= windowFrames) {
    return frameLufs(samples, channels, clampedStart, clampedEnd);
  }
  const stepFrames = Math.max(1, Math.round(sampleRate * 0.02));
  let maxLufs = Number.NEGATIVE_INFINITY;
  for (let start = clampedStart; start <= clampedEnd - windowFrames; start += stepFrames) {
    maxLufs = Math.max(maxLufs, frameLufs(samples, channels, start, start + windowFrames));
  }
  const finalStart = clampedEnd - windowFrames;
  if ((finalStart - clampedStart) % stepFrames !== 0) {
    maxLufs = Math.max(maxLufs, frameLufs(samples, channels, finalStart, clampedEnd));
  }
  return maxLufs;
}

export function summarizeMomentaryLufs(samples, channels, sampleRate, options = {}) {
  const frameCount = Math.floor(samples.length / channels);
  if (!frameCount) {
    return {
      momentaryLufs: Number.NEGATIVE_INFINITY,
      momentaryPower: 0,
      shortLufs: Number.NEGATIVE_INFINITY,
      shortPower: 0,
      activeLufs: Number.NEGATIVE_INFINITY,
      activePower: 0,
      activeWindowCount: 0,
      activeThreshold: Number.POSITIVE_INFINITY,
    };
  }
  const momentaryMs = options.momentaryMs ?? 400;
  const shortMs = options.shortMs ?? 120;
  const momentaryLufs = maxWindowLufs(samples, channels, sampleRate, 0, frameCount, momentaryMs);
  const shortLufs = maxWindowLufs(samples, channels, sampleRate, 0, frameCount, shortMs);
  const weighted = kWeightedSamples(samples, channels, sampleRate);
  const windows = envelopeWindows(weighted, channels, sampleRate);
  const active = activeRange(windows);
  return {
    momentaryLufs,
    momentaryPower: momentaryLufs === Number.NEGATIVE_INFINITY ? 0 : 10 ** (momentaryLufs / 10),
    shortLufs,
    shortPower: shortLufs === Number.NEGATIVE_INFINITY ? 0 : 10 ** (shortLufs / 10),
    activeLufs: active.activeLufs,
    activePower: active.activePower,
    activeTopLufs: active.topActiveLufs,
    activeTopPower: active.topActivePower,
    activeWindowCount: active.windowCount,
    activeThreshold: active.threshold,
    activeTopWindowCount: active.topWindowCount,
  };
}

export function lufsToPower(lufs) {
  return Number.isFinite(lufs) ? 10 ** (lufs / 10) : 0;
}

export async function readSunsynthForMusic(path, options = {}) {
  const bytes = await readFile(path);
  if (options.rootVolume === undefined) {
    return bytes;
  }

  const document = parseContainer(bytes);
  if (!document.module) {
    throw new Error(`${path} is not a SunSynth document`);
  }
  if (Array.isArray(document.module.controllers)) {
    throw new Error(`${path} has unsupported root controller storage`);
  }
  document.module.controllers ??= {};
  document.module.controllers.volume = options.rootVolume;

  let changedEmbeddedProject = false;
  for (const dataChunk of document.module.dataChunks ?? []) {
    if (dataChunk.container?.project) {
      dataChunk.container.project.globalVolume = options.rootVolume;
      changedEmbeddedProject = true;
    }
  }
  if (!changedEmbeddedProject) {
    throw new Error(`${path} has no embedded project global volume`);
  }

  return buildContainer(document);
}

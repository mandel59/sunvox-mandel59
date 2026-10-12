// Deterministic offline DSP primitives for synthesizing one-shot samples
// (drums, FX, textures) that are later embedded into SunVox Sampler modules.
// Everything is seeded so recipes regenerate byte-identical audio.

export const SAMPLE_RATE = 44100;

export function createRng(seed) {
  let state = (seed >>> 0) || 0x9e3779b9;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function frames(seconds, sampleRate = SAMPLE_RATE) {
  return Math.max(1, Math.round(seconds * sampleRate));
}

export function silence(seconds, sampleRate = SAMPLE_RATE) {
  return new Float64Array(frames(seconds, sampleRate));
}

export function noise(seconds, seed, sampleRate = SAMPLE_RATE) {
  const rng = createRng(seed);
  const out = silence(seconds, sampleRate);
  for (let i = 0; i < out.length; i += 1) out[i] = rng() * 2 - 1;
  return out;
}

// Oscillator whose frequency may be a constant or a function of time (s).
export function osc(seconds, frequency, { shape = "sine", phase = 0, sampleRate = SAMPLE_RATE } = {}) {
  const out = silence(seconds, sampleRate);
  const freqAt = typeof frequency === "function" ? frequency : () => frequency;
  let p = phase;
  for (let i = 0; i < out.length; i += 1) {
    const t = i / sampleRate;
    const frac = p - Math.floor(p);
    switch (shape) {
      case "square":
        out[i] = frac < 0.5 ? 1 : -1;
        break;
      case "saw":
        out[i] = 2 * frac - 1;
        break;
      case "triangle":
        out[i] = 1 - 4 * Math.abs(frac - 0.5);
        break;
      default:
        out[i] = Math.sin(2 * Math.PI * frac);
    }
    p += freqAt(t) / sampleRate;
  }
  return out;
}

// Envelope helpers return gain arrays matching a buffer length.
export function expDecay(length, tauSeconds, { attackSeconds = 0, holdSeconds = 0, sampleRate = SAMPLE_RATE } = {}) {
  const out = new Float64Array(length);
  const attack = attackSeconds * sampleRate;
  const hold = holdSeconds * sampleRate;
  for (let i = 0; i < length; i += 1) {
    if (i < attack) out[i] = i / attack;
    else if (i < attack + hold) out[i] = 1;
    else out[i] = Math.exp(-(i - attack - hold) / (tauSeconds * sampleRate));
  }
  return out;
}

export function segments(length, points, sampleRate = SAMPLE_RATE) {
  // points: [[timeSeconds, gain], ...] with linear interpolation.
  const out = new Float64Array(length);
  let index = 0;
  for (let i = 0; i < length; i += 1) {
    const t = i / sampleRate;
    while (index < points.length - 2 && t >= points[index + 1][0]) index += 1;
    const [t0, g0] = points[index];
    const [t1, g1] = points[Math.min(points.length - 1, index + 1)];
    out[i] = t1 > t0 ? g0 + ((g1 - g0) * Math.max(0, Math.min(1, (t - t0) / (t1 - t0)))) : g1;
  }
  return out;
}

export function multiply(signal, gain) {
  const out = new Float64Array(signal.length);
  for (let i = 0; i < signal.length; i += 1) out[i] = signal[i] * (typeof gain === "number" ? gain : gain[i] ?? 0);
  return out;
}

export function mix(length, ...parts) {
  // parts: [signal, gain, offsetSeconds?]
  const out = new Float64Array(length);
  for (const [signal, gain = 1, offsetSeconds = 0] of parts) {
    const offset = Math.round(offsetSeconds * SAMPLE_RATE);
    for (let i = 0; i < signal.length && i + offset < length; i += 1) {
      if (i + offset >= 0) out[i + offset] += signal[i] * gain;
    }
  }
  return out;
}

function rbj(type, frequency, q, gainDb, sampleRate) {
  const w = (2 * Math.PI * Math.min(frequency, sampleRate * 0.49)) / sampleRate;
  const cos = Math.cos(w);
  const sin = Math.sin(w);
  const alpha = sin / (2 * q);
  const amp = 10 ** (gainDb / 40);
  let b0;
  let b1;
  let b2;
  let a0;
  let a1;
  let a2;
  switch (type) {
    case "lowpass":
      [b0, b1, b2] = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
      [a0, a1, a2] = [1 + alpha, -2 * cos, 1 - alpha];
      break;
    case "highpass":
      [b0, b1, b2] = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
      [a0, a1, a2] = [1 + alpha, -2 * cos, 1 - alpha];
      break;
    case "bandpass":
      [b0, b1, b2] = [alpha, 0, -alpha];
      [a0, a1, a2] = [1 + alpha, -2 * cos, 1 - alpha];
      break;
    case "peak":
      [b0, b1, b2] = [1 + alpha * amp, -2 * cos, 1 - alpha * amp];
      [a0, a1, a2] = [1 + alpha / amp, -2 * cos, 1 - alpha / amp];
      break;
    case "lowshelf": {
      const root = 2 * Math.sqrt(amp) * alpha;
      b0 = amp * (amp + 1 - (amp - 1) * cos + root);
      b1 = 2 * amp * (amp - 1 - (amp + 1) * cos);
      b2 = amp * (amp + 1 - (amp - 1) * cos - root);
      a0 = amp + 1 + (amp - 1) * cos + root;
      a1 = -2 * (amp - 1 + (amp + 1) * cos);
      a2 = amp + 1 + (amp - 1) * cos - root;
      break;
    }
    case "highshelf": {
      const root = 2 * Math.sqrt(amp) * alpha;
      b0 = amp * (amp + 1 + (amp - 1) * cos + root);
      b1 = -2 * amp * (amp - 1 + (amp + 1) * cos);
      b2 = amp * (amp + 1 + (amp - 1) * cos - root);
      a0 = amp + 1 - (amp - 1) * cos + root;
      a1 = 2 * (amp - 1 - (amp + 1) * cos);
      a2 = amp + 1 - (amp - 1) * cos - root;
      break;
    }
    default:
      throw new Error(`Unknown filter type: ${type}`);
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

// Biquad filter; frequency may be a function of time for sweeps.
export function filter(signal, type, frequency, { q = 0.707, gainDb = 0, sampleRate = SAMPLE_RATE } = {}) {
  const out = new Float64Array(signal.length);
  const freqAt = typeof frequency === "function" ? frequency : () => frequency;
  let coefficients = rbj(type, freqAt(0), q, gainDb, sampleRate);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < signal.length; i += 1) {
    if (typeof frequency === "function" && i % 32 === 0) {
      coefficients = rbj(type, freqAt(i / sampleRate), q, gainDb, sampleRate);
    }
    const { b0, b1, b2, a1, a2 } = coefficients;
    const x0 = signal[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

export function softClip(signal, drive = 1) {
  const out = new Float64Array(signal.length);
  const norm = Math.tanh(drive);
  for (let i = 0; i < signal.length; i += 1) out[i] = Math.tanh(signal[i] * drive) / norm;
  return out;
}

// Small feedback-delay-network room for baking short tails into one-shots.
export function room(signal, { seconds = 0.6, decay = 0.35, damp = 0.4, wet = 0.3, seed = 7, sampleRate = SAMPLE_RATE } = {}) {
  const rng = createRng(seed);
  const length = signal.length + frames(seconds, sampleRate);
  const out = new Float64Array(length);
  const delays = [1.0, 1.31, 1.63, 1.97].map((ratio) => Math.round((0.011 + rng() * 0.004) * ratio * sampleRate));
  const lines = delays.map((size) => new Float64Array(size));
  const positions = delays.map(() => 0);
  const lowpass = delays.map(() => 0);
  const gains = delays.map((size) => 10 ** ((-3 * size) / (decay * sampleRate)));
  for (let i = 0; i < length; i += 1) {
    const input = i < signal.length ? signal[i] : 0;
    const taps = lines.map((line, k) => line[positions[k]]);
    let wetSum = 0;
    for (let k = 0; k < taps.length; k += 1) wetSum += taps[k];
    // Householder feedback matrix keeps the network lossless before gains.
    const mean = (taps[0] + taps[1] + taps[2] + taps[3]) / 2;
    for (let k = 0; k < lines.length; k += 1) {
      const feedback = (taps[k] - mean) * gains[k];
      lowpass[k] = lowpass[k] + (1 - damp) * (feedback - lowpass[k]);
      lines[k][positions[k]] = input + lowpass[k];
      positions[k] = (positions[k] + 1) % lines[k].length;
    }
    out[i] = input + (wetSum / 4) * wet;
  }
  return out;
}

export function normalize(signal, peak = 0.95) {
  let max = 0;
  for (const value of signal) max = Math.max(max, Math.abs(value));
  return max > 0 ? multiply(signal, peak / max) : signal;
}

export function fadeOut(signal, seconds, sampleRate = SAMPLE_RATE) {
  const out = Float64Array.from(signal);
  const length = Math.min(out.length, frames(seconds, sampleRate));
  for (let i = 0; i < length; i += 1) {
    const index = out.length - length + i;
    out[index] *= 0.5 + 0.5 * Math.cos((Math.PI * i) / length);
  }
  return out;
}

export function trimSilence(signal, threshold = 1e-4) {
  let end = signal.length;
  while (end > 1 && Math.abs(signal[end - 1]) < threshold) end -= 1;
  return signal.slice(0, end);
}

export function reverse(signal) {
  return Float64Array.from(signal).reverse();
}

// 16-bit mono PCM WAV, the format SunVox Lib Samplers load from memory.
export function toWav16(signal, sampleRate = SAMPLE_RATE) {
  const buffer = Buffer.alloc(44 + signal.length * 2);
  buffer.write("RIFF", 0, "latin1");
  buffer.writeUInt32LE(36 + signal.length * 2, 4);
  buffer.write("WAVE", 8, "latin1");
  buffer.write("fmt ", 12, "latin1");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(1, 20);
  buffer.writeUInt16LE(1, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * 2, 28);
  buffer.writeUInt16LE(2, 32);
  buffer.writeUInt16LE(16, 34);
  buffer.write("data", 36, "latin1");
  buffer.writeUInt32LE(signal.length * 2, 40);
  for (let i = 0; i < signal.length; i += 1) {
    buffer.writeInt16LE(Math.round(Math.max(-1, Math.min(1, signal[i])) * 32767), 44 + i * 2);
  }
  return buffer;
}

#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { crc32, deflateSync } from "node:zlib";

import { readWavFile } from "./wav-io.mjs";

// Offline review aid for rendered audio: a log-frequency spectrogram PNG with
// waveform and short-term loudness lanes, plus a per-bar text report with
// K-weighted loudness, band balance, stereo width, and chroma. These are
// observations to guide listening, not quality scores.

const PITCH_CLASSES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BANDS = [
  ["sub", 20, 60],
  ["bass", 60, 250],
  ["lowmid", 250, 1000],
  ["mid", 1000, 4000],
  ["high", 4000, 16000],
];
const MAGMA = [
  [0, 0, 4],
  [28, 16, 68],
  [79, 18, 123],
  [129, 37, 129],
  [181, 54, 122],
  [229, 80, 100],
  [251, 135, 97],
  [254, 194, 135],
  [252, 253, 191],
];

function usage() {
  console.error(`Usage:
  node tools/audio-review.mjs [options] <input.wav>

Options:
  --png <file.png>      Write spectrogram image (default: <input>.png)
  --report <file.txt>   Write per-bar report (default: stdout)
  --bpm <bpm>           Draw bar lines and report per bar (4/4)
  --beats-per-bar <n>   Beats per bar (default: 4)
  --bars-per-row <n>    Group report rows by this many bars (default: 1)
  --start <seconds>     Analysis start (default: 0)
  --end <seconds>       Analysis end (default: file end)
  --width <px>          Image width (default: 1800)
  --labels <spec>       Section labels as bar:name,bar:name (drawn as ticks)`);
}

function parseArgs(argv) {
  const options = { width: 1800, beatsPerBar: 4, barsPerRow: 1, start: 0 };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (argv[index] === undefined) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--png") options.png = next();
    else if (arg === "--report") options.report = next();
    else if (arg === "--bpm") options.bpm = Number(next());
    else if (arg === "--beats-per-bar") options.beatsPerBar = Number(next());
    else if (arg === "--bars-per-row") options.barsPerRow = Number(next());
    else if (arg === "--start") options.start = Number(next());
    else if (arg === "--end") options.end = Number(next());
    else if (arg === "--width") options.width = Number(next());
    else if (arg === "--labels") options.labels = next();
    else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else options.input = arg;
  }
  return options;
}

function fftInPlace(re, im) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i += 1) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    const half = size >> 1;
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < half; k += 1) {
        const a = start + k;
        const b = a + half;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nextCr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nextCr;
      }
    }
  }
}

function biquad(samples, { b0, b1, b2, a1, a2 }) {
  const out = new Float64Array(samples.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;
  for (let i = 0; i < samples.length; i += 1) {
    const x0 = samples[i];
    const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
    out[i] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }
  return out;
}

function kWeight(samples, sampleRate) {
  // ITU-R BS.1770 pre-filter (shelf) and RLB high-pass via RBJ biquads.
  const shelf = (() => {
    const f = 1681.974450955533;
    const q = 0.7071752369554196;
    const amp = 10 ** (3.99984385397 / 40);
    const w = (2 * Math.PI * f) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const root = Math.sqrt(amp);
    const a0 = amp + 1 - (amp - 1) * cos + 2 * root * alpha;
    return {
      b0: (amp * (amp + 1 + (amp - 1) * cos + 2 * root * alpha)) / a0,
      b1: (-2 * amp * (amp - 1 + (amp + 1) * cos)) / a0,
      b2: (amp * (amp + 1 + (amp - 1) * cos - 2 * root * alpha)) / a0,
      a1: (2 * (amp - 1 - (amp + 1) * cos)) / a0,
      a2: (amp + 1 - (amp - 1) * cos - 2 * root * alpha) / a0,
    };
  })();
  const highPass = (() => {
    const f = 38.13547087602444;
    const q = 0.5003270373238773;
    const w = (2 * Math.PI * f) / sampleRate;
    const cos = Math.cos(w);
    const alpha = Math.sin(w) / (2 * q);
    const a0 = 1 + alpha;
    return {
      b0: (1 + cos) / 2 / a0,
      b1: -(1 + cos) / a0,
      b2: (1 + cos) / 2 / a0,
      a1: (-2 * cos) / a0,
      a2: (1 - alpha) / a0,
    };
  })();
  return biquad(biquad(samples, shelf), highPass);
}

function splitChannels(samples, channels, startFrame, endFrame) {
  const frames = endFrame - startFrame;
  const left = new Float64Array(frames);
  const right = new Float64Array(frames);
  for (let i = 0; i < frames; i += 1) {
    const base = (startFrame + i) * channels;
    left[i] = samples[base];
    right[i] = channels > 1 ? samples[base + 1] : samples[base];
  }
  return { left, right };
}

function powerDb(power) {
  return power > 0 ? 10 * Math.log10(power) : Number.NEGATIVE_INFINITY;
}

function analyzeStft(mono, sampleRate, { fftSize = 4096, hop = 1024 } = {}) {
  const window = new Float64Array(fftSize);
  for (let i = 0; i < fftSize; i += 1) window[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (fftSize - 1));
  const frames = [];
  const re = new Float64Array(fftSize);
  const im = new Float64Array(fftSize);
  for (let start = 0; start + fftSize <= mono.length; start += hop) {
    for (let i = 0; i < fftSize; i += 1) {
      re[i] = mono[start + i] * window[i];
      im[i] = 0;
    }
    fftInPlace(re, im);
    const power = new Float32Array(fftSize / 2);
    for (let k = 0; k < fftSize / 2; k += 1) power[k] = re[k] * re[k] + im[k] * im[k];
    frames.push({ time: (start + fftSize / 2) / sampleRate, power });
  }
  return { frames, fftSize, hop, binHz: sampleRate / fftSize };
}

function colorFor(value) {
  const t = Math.max(0, Math.min(1, value)) * (MAGMA.length - 1);
  const index = Math.min(MAGMA.length - 2, Math.floor(t));
  const frac = t - index;
  return MAGMA[index].map((channel, c) => Math.round(channel + (MAGMA[index + 1][c] - channel) * frac));
}

function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width * 3 + 1)] = 0;
    rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  }
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const typed = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(typed) >>> 0);
    return Buffer.concat([length, typed, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8;
  header[9] = 2;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

// 3x5 pixel font for digits and a few letters used in lane labels.
const FONT = {
  0: "111101101101111", 1: "010110010010111", 2: "111001111100111", 3: "111001111001111",
  4: "101101111001001", 5: "111100111001111", 6: "111100111101111", 7: "111001010010010",
  8: "111101111101111", 9: "111101111001111", k: "100101110101101", "-": "000000111000000",
  A: "010101111101101", B: "110101110101110", C: "111100100100111", D: "110101101101110",
  E: "111100111100111", F: "111100111100100", G: "111100101101111", H: "101101111101101",
  I: "111010010010111", K: "101101110101101", L: "100100100100111", M: "101111111101101",
  N: "110101101101101", O: "111101101101111", P: "111101111100100", R: "110101110101101",
  S: "111100111001111", T: "111010010010010", U: "101101101101111", V: "101101101101010",
  W: "101101111111101", X: "101101010101101", Y: "101101010010010", Z: "111001010100111",
  " ": "000000000000000",
};

function drawText(rgb, width, height, x0, y0, text, color) {
  let x = x0;
  for (const character of String(text).toUpperCase()) {
    const glyph = FONT[character] ?? FONT[character.toLowerCase()];
    if (glyph) {
      for (let row = 0; row < 5; row += 1) {
        for (let col = 0; col < 3; col += 1) {
          if (glyph[row * 3 + col] !== "1") continue;
          for (let sy = 0; sy < 2; sy += 1) {
            for (let sx = 0; sx < 2; sx += 1) {
              const px = x + col * 2 + sx;
              const py = y0 + row * 2 + sy;
              if (px >= 0 && px < width && py >= 0 && py < height) {
                rgb[(py * width + px) * 3] = color[0];
                rgb[(py * width + px) * 3 + 1] = color[1];
                rgb[(py * width + px) * 3 + 2] = color[2];
              }
            }
          }
        }
      }
    }
    x += 8;
  }
}

export function renderReviewImage({ left, right, sampleRate, stft, width, barSeconds, startSeconds, labels }) {
  const waveHeight = 90;
  const specHeight = 420;
  const loudHeight = 110;
  const gap = 4;
  const height = waveHeight + gap + specHeight + gap + loudHeight;
  const rgb = Buffer.alloc(width * height * 3, 12);
  const frames = left.length;
  const setPixel = (x, y, color) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const offset = (y * width + x) * 3;
    rgb[offset] = color[0];
    rgb[offset + 1] = color[1];
    rgb[offset + 2] = color[2];
  };

  // Waveform lane: per-column peak (light) and RMS (bright).
  for (let x = 0; x < width; x += 1) {
    const start = Math.floor((x / width) * frames);
    const end = Math.max(start + 1, Math.floor(((x + 1) / width) * frames));
    let peak = 0;
    let sum = 0;
    for (let i = start; i < end; i += 1) {
      const value = Math.max(Math.abs(left[i]), Math.abs(right[i]));
      peak = Math.max(peak, value);
      sum += (left[i] * left[i] + right[i] * right[i]) / 2;
    }
    const rms = Math.sqrt(sum / (end - start));
    const mid = waveHeight / 2;
    const peakPx = Math.round(Math.min(1, peak) * (mid - 2));
    const rmsPx = Math.round(Math.min(1, rms) * (mid - 2));
    for (let y = -peakPx; y <= peakPx; y += 1) setPixel(x, Math.round(mid + y), peak >= 0.999 ? [255, 60, 60] : [70, 110, 150]);
    for (let y = -rmsPx; y <= rmsPx; y += 1) setPixel(x, Math.round(mid + y), [150, 210, 255]);
  }

  // Spectrogram lane on a log-frequency axis from 30 Hz to 18 kHz.
  const minHz = 30;
  const maxHz = 18000;
  const specTop = waveHeight + gap;
  const columnPower = [];
  for (let x = 0; x < width; x += 1) {
    const time = startSeconds + ((x + 0.5) / width) * (frames / sampleRate);
    const frameIndex = Math.max(0, Math.min(stft.frames.length - 1, Math.round(((time - startSeconds) * sampleRate - stft.fftSize / 2) / stft.hop)));
    columnPower.push(stft.frames[frameIndex]?.power);
  }
  for (let y = 0; y < specHeight; y += 1) {
    const hz = minHz * (maxHz / minHz) ** (1 - (y + 0.5) / specHeight);
    const hzNext = minHz * (maxHz / minHz) ** (1 - (y + 1.5) / specHeight);
    const binLow = Math.max(1, Math.floor(Math.min(hz, hzNext) / stft.binHz));
    const binHigh = Math.max(binLow, Math.ceil(Math.max(hz, hzNext) / stft.binHz));
    for (let x = 0; x < width; x += 1) {
      const power = columnPower[x];
      if (!power) continue;
      let max = 0;
      for (let bin = binLow; bin <= binHigh && bin < power.length; bin += 1) max = Math.max(max, power[bin]);
      // Normalize: 0 dB ~ full-scale sine through a Hann window of this size.
      const db = powerDb(max / ((stft.fftSize / 4) ** 2));
      setPixel(x, specTop + y, colorFor((db + 96) / 90));
    }
  }
  for (const hz of [50, 100, 200, 500, 1000, 2000, 5000, 10000]) {
    const y = specTop + Math.round((1 - Math.log(hz / minHz) / Math.log(maxHz / minHz)) * specHeight);
    for (let x = 0; x < width; x += 6) setPixel(x, y, [90, 90, 90]);
    drawText(rgb, width, height, 2, y - 11, hz >= 1000 ? `${hz / 1000}k` : `${hz}`, [200, 200, 200]);
  }

  // Short-term loudness lane: 400 ms K-weighted windows, -40..0 LUFS.
  const loudTop = specTop + specHeight + gap;
  const kl = kWeight(left, sampleRate);
  const kr = kWeight(right, sampleRate);
  const win = Math.round(0.4 * sampleRate);
  let previousY;
  for (let x = 0; x < width; x += 1) {
    const center = Math.floor(((x + 0.5) / width) * frames);
    const start = Math.max(0, center - win / 2);
    const end = Math.min(frames, center + win / 2);
    let sum = 0;
    for (let i = start; i < end; i += 1) sum += kl[i] * kl[i] + kr[i] * kr[i];
    const lufs = -0.691 + powerDb(sum / Math.max(1, end - start));
    const y = loudTop + Math.round(Math.max(0, Math.min(1, -lufs / 40)) * (loudHeight - 1));
    if (previousY !== undefined) {
      for (let yy = Math.min(previousY, y); yy <= Math.max(previousY, y); yy += 1) setPixel(x, yy, [255, 200, 90]);
    }
    setPixel(x, y, [255, 200, 90]);
    previousY = y;
  }
  for (const lufs of [-10, -20, -30]) {
    const y = loudTop + Math.round((-lufs / 40) * (loudHeight - 1));
    for (let x = 0; x < width; x += 4) setPixel(x, y, [80, 80, 80]);
    drawText(rgb, width, height, 2, y - 11, `${lufs}`, [180, 180, 180]);
  }

  // Bar grid and section labels.
  if (barSeconds) {
    const total = frames / sampleRate;
    const firstBar = Math.ceil(startSeconds / barSeconds - 1e-9);
    for (let bar = firstBar; bar * barSeconds <= startSeconds + total; bar += 1) {
      const x = Math.round(((bar * barSeconds - startSeconds) / total) * width);
      const strong = bar % 4 === 0;
      for (let y = 0; y < height; y += strong ? 1 : 3) setPixel(x, y, strong ? [140, 140, 160] : [60, 60, 70]);
      if (strong) drawText(rgb, width, height, x + 2, 2, `${bar}`, [230, 230, 230]);
    }
    for (const [bar, name] of labels ?? []) {
      const x = Math.round(((bar * barSeconds - startSeconds) / total) * width);
      drawText(rgb, width, height, x + 2, specTop + 4, name, [120, 255, 160]);
    }
  }
  return encodePng(width, height, rgb);
}

export function barReport({ left, right, sampleRate, stft, barSeconds, startSeconds, barsPerRow }) {
  const frames = left.length;
  const rowSeconds = barSeconds ? barSeconds * barsPerRow : 2;
  const kl = kWeight(left, sampleRate);
  const kr = kWeight(right, sampleRate);
  const rows = [];
  const firstRow = barSeconds ? Math.floor(startSeconds / rowSeconds) : 0;
  for (let row = firstRow; ; row += 1) {
    const rowStart = row * rowSeconds - startSeconds;
    if (rowStart >= frames / sampleRate) break;
    const start = Math.max(0, Math.floor(rowStart * sampleRate));
    const end = Math.min(frames, Math.floor((rowStart + rowSeconds) * sampleRate));
    if (end - start < sampleRate * 0.05) continue;
    let kSum = 0;
    let peak = 0;
    let mid = 0;
    let side = 0;
    for (let i = start; i < end; i += 1) {
      kSum += kl[i] * kl[i] + kr[i] * kr[i];
      peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
      const m = (left[i] + right[i]) / 2;
      const s = (left[i] - right[i]) / 2;
      mid += m * m;
      side += s * s;
    }
    const bands = new Float64Array(BANDS.length);
    const chroma = new Float64Array(12);
    let centroidNum = 0;
    let centroidDen = 0;
    let frameCount = 0;
    for (const frame of stft.frames) {
      const t = frame.time;
      if (t < rowStart || t >= rowStart + rowSeconds) continue;
      frameCount += 1;
      for (let k = 1; k < frame.power.length; k += 1) {
        const hz = k * stft.binHz;
        const p = frame.power[k];
        centroidNum += hz * p;
        centroidDen += p;
        for (let b = 0; b < BANDS.length; b += 1) if (hz >= BANDS[b][1] && hz < BANDS[b][2]) bands[b] += p;
        if (hz >= 60 && hz <= 2200) {
          const midi = 69 + 12 * Math.log2(hz / 440);
          const nearest = Math.round(midi);
          if (Math.abs(midi - nearest) < 0.35) chroma[((nearest % 12) + 12) % 12] += p;
        }
      }
    }
    const bandTotal = bands.reduce((a, b) => a + b, 0) || 1;
    const chromaMax = Math.max(...chroma) || 1;
    const topChroma = [...chroma]
      .map((value, index) => ({ value: value / chromaMax, name: PITCH_CLASSES[index] }))
      .sort((a, b) => b.value - a.value)
      .filter((entry) => entry.value >= 0.35)
      .slice(0, 5)
      .map((entry) => `${entry.name}${Math.round(entry.value * 9)}`)
      .join(" ");
    rows.push({
      index: row,
      label: barSeconds ? `bar ${row * barsPerRow}` : `${(row * rowSeconds).toFixed(1)}s`,
      lufs: -0.691 + powerDb(kSum / (end - start)),
      peakDb: 20 * Math.log10(peak || 1e-12),
      width: mid > 0 ? side / mid : 0,
      centroid: centroidDen ? centroidNum / centroidDen : 0,
      bands: BANDS.map(([name], b) => [name, powerDb(bands[b] / bandTotal)]),
      chroma: frameCount ? topChroma : "",
    });
  }
  return rows;
}

// ITU-R BS.1770 integrated loudness with absolute (-70) and relative (-10) gates.
export function integratedLoudness(left, right, sampleRate) {
  const kl = kWeight(left, sampleRate);
  const kr = kWeight(right, sampleRate);
  const block = Math.round(0.4 * sampleRate);
  const hop = Math.round(0.1 * sampleRate);
  const powers = [];
  for (let start = 0; start + block <= kl.length; start += hop) {
    let sum = 0;
    for (let i = start; i < start + block; i += 1) sum += kl[i] * kl[i] + kr[i] * kr[i];
    powers.push(sum / block);
  }
  const lufs = (power) => -0.691 + powerDb(power);
  const absolute = powers.filter((power) => lufs(power) > -70);
  if (!absolute.length) return Number.NEGATIVE_INFINITY;
  const mean = (values) => values.reduce((a, b) => a + b, 0) / values.length;
  const relativeGate = lufs(mean(absolute)) - 10;
  const gated = absolute.filter((power) => lufs(power) > relativeGate);
  return lufs(mean(gated));
}

function formatReport(rows) {
  const header = "row      LUFS   peak  S/M   cent  sub  bass lowm  mid high  chroma";
  const lines = rows.map((row) => {
    const bands = row.bands.map(([, db]) => (Number.isFinite(db) ? db.toFixed(0).padStart(4) : "  -∞")).join(" ");
    return `${row.label.padEnd(8)} ${row.lufs.toFixed(1).padStart(5)} ${row.peakDb.toFixed(1).padStart(6)} ${row.width
      .toFixed(2)
      .padStart(4)} ${Math.round(row.centroid).toString().padStart(5)} ${bands}  ${row.chroma}`;
  });
  return [header, ...lines].join("\n");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.input) {
    usage();
    process.exitCode = options.help ? 0 : 1;
    return;
  }
  const inputPath = resolve(options.input);
  const { samples, sampleRate, channels } = await readWavFile(inputPath);
  const totalFrames = Math.floor(samples.length / channels);
  const startFrame = Math.max(0, Math.floor(options.start * sampleRate));
  const endFrame = Math.min(totalFrames, options.end ? Math.floor(options.end * sampleRate) : totalFrames);
  const { left, right } = splitChannels(samples, channels, startFrame, endFrame);
  const mono = new Float64Array(left.length);
  for (let i = 0; i < mono.length; i += 1) mono[i] = (left[i] + right[i]) / 2;
  const span = (endFrame - startFrame) / sampleRate;
  const hop = span < 20 ? 256 : 1024;
  const stft = analyzeStft(mono, sampleRate, { fftSize: 4096, hop });
  const barSeconds = options.bpm ? (60 / options.bpm) * options.beatsPerBar : undefined;
  const labels = (options.labels ?? "")
    .split(",")
    .filter(Boolean)
    .map((entry) => {
      const [bar, ...name] = entry.split(":");
      return [Number(bar), name.join(":")];
    });

  const pngPath = resolve(options.png ?? inputPath.replace(/\.wav$/iu, "") + ".png");
  await mkdir(dirname(pngPath), { recursive: true });
  await writeFile(
    pngPath,
    renderReviewImage({ left, right, sampleRate, stft, width: options.width, barSeconds, startSeconds: options.start, labels }),
  );

  const rows = barReport({ left, right, sampleRate, stft, barSeconds, startSeconds: options.start, barsPerRow: options.barsPerRow });
  let peak = 0;
  for (let i = 0; i < left.length; i += 1) peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i]));
  const summary = `integrated ${integratedLoudness(left, right, sampleRate).toFixed(1)} LUFS, sample peak ${(20 * Math.log10(peak || 1e-12)).toFixed(2)} dBFS, ${(left.length / sampleRate).toFixed(2)} s`;
  const text = `${summary}\n${formatReport(rows)}`;
  if (options.report) {
    await mkdir(dirname(resolve(options.report)), { recursive: true });
    await writeFile(resolve(options.report), `${text}\n`);
    console.log(`${pngPath}\n${resolve(options.report)}`);
  } else {
    console.log(pngPath);
    console.log(text);
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}

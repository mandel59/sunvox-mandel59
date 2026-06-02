#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_BLOCK_FRAMES,
  DEFAULT_CHANNELS,
  DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
  DEFAULT_SAMPLE_RATE,
  DEFAULT_SLOT as SLOT,
  assertSunVoxOk,
  createNoteProbePattern,
  loadSynthModuleFromBuffer,
  renderSlotAudio,
  withSunVoxSlot,
} from "./sunvox-node.mjs";

const DEFAULT_DURATION_SECONDS = 6;
const DEFAULT_NOTE_OFF_SECONDS = 3.2;
const DEFAULT_NOTE_SECONDS = 0.2;
const DEFAULT_NOTE = 48;
const DEFAULT_VELOCITY = 96;
const SPECTRUM_SIZE = 4096;
const PATTERN_LINE_COUNT = 256;
const SAMPLE_EXTENSIONS = new Set([".sunsynth"]);
const NOTE_NAMES = new Map([
  ["C", 0],
  ["C#", 1],
  ["DB", 1],
  ["D", 2],
  ["D#", 3],
  ["EB", 3],
  ["E", 4],
  ["F", 5],
  ["F#", 6],
  ["GB", 6],
  ["G", 7],
  ["G#", 8],
  ["AB", 8],
  ["A", 9],
  ["A#", 10],
  ["BB", 10],
  ["B", 11],
]);
const NOTE_LABELS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function usage() {
  console.error(`Usage:
  node tools/sunsynth-characterize.mjs [--json] [--detail] [--note <note|midi>] [--velocity <1..129>] <input.sunsynth> [...]

Examples:
  node tools/sunsynth-characterize.mjs instruments/*.sunsynth
  node tools/sunsynth-characterize.mjs --json --note C3 var/glass-chord-pad.sunsynth
  node tools/sunsynth-characterize.mjs --probe C2:72:2.0 --probe C4:112:1.5 var/glass-chord-pad.sunsynth`);
}

function parsePositiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return parsed;
}

export function parseNote(value) {
  if (/^\d+$/u.test(value)) {
    return Number(value);
  }
  const match = /^([A-Ga-g])([#bB]?)(-?\d+)$/u.exec(value);
  if (!match) {
    throw new Error(`Invalid note: ${value}`);
  }
  const name = `${match[1].toUpperCase()}${match[2].toUpperCase()}`;
  const semitone = NOTE_NAMES.get(name);
  if (semitone === undefined) {
    throw new Error(`Invalid note name: ${value}`);
  }
  const octave = Number(match[3]);
  return (octave + 1) * 12 + semitone;
}

function noteLabel(note) {
  const midiNote = Math.round(note);
  const octave = Math.floor(midiNote / 12) - 1;
  const pitchClass = ((midiNote % 12) + 12) % 12;
  return `${NOTE_LABELS[pitchClass]}${octave}`;
}

function noteFrequency(note) {
  return 440 * 2 ** ((note - 69) / 12);
}

function normalizeProbe(probe, label = "probe") {
  const note = Number(probe.note);
  const velocity = Number(probe.velocity);
  const gateSeconds = Number(probe.gateSeconds);
  if (!Number.isFinite(note)) {
    throw new Error(`${label} note must be numeric`);
  }
  if (!Number.isFinite(velocity) || velocity <= 0) {
    throw new Error(`${label} velocity must be a positive number`);
  }
  if (!Number.isFinite(gateSeconds) || gateSeconds <= 0) {
    throw new Error(`${label} gate must be a positive number`);
  }
  const normalized = {
    note: Math.round(note),
    velocity: Math.max(1, Math.min(129, Math.round(velocity))),
    gateSeconds,
  };
  return {
    ...normalized,
    id: `${noteLabel(normalized.note)}:${normalized.velocity}:${normalized.gateSeconds.toFixed(1)}s`,
    noteOffSeconds: DEFAULT_NOTE_SECONDS + normalized.gateSeconds,
    durationSeconds: DEFAULT_NOTE_SECONDS + normalized.gateSeconds + 2,
  };
}

export function parseProbe(value) {
  const [noteToken, velocityToken, gateToken] = value.split(":");
  if (!noteToken || !velocityToken || !gateToken) {
    throw new Error(`Invalid --probe value: ${value}`);
  }
  return normalizeProbe(
    {
      note: parseNote(noteToken),
      velocity: parsePositiveNumber(velocityToken, "--probe velocity"),
      gateSeconds: parsePositiveNumber(gateToken, "--probe gate"),
    },
    "--probe",
  );
}

function parseArgs(argv) {
  const options = {
    json: false,
    detail: false,
    note: DEFAULT_NOTE,
    velocity: DEFAULT_VELOCITY,
    durationSeconds: DEFAULT_DURATION_SECONDS,
    noteOffSeconds: DEFAULT_NOTE_OFF_SECONDS,
    probes: [],
    files: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--detail") {
      options.detail = true;
    } else if (arg === "--note") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--note requires a value");
      }
      options.note = parseNote(argv[index]);
    } else if (arg === "--velocity") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--velocity requires a value");
      }
      options.velocity = Math.max(1, Math.min(129, Math.round(parsePositiveNumber(argv[index], "--velocity"))));
    } else if (arg === "--duration") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--duration requires a value");
      }
      options.durationSeconds = parsePositiveNumber(argv[index], "--duration");
    } else if (arg === "--note-off") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--note-off requires a value");
      }
      options.noteOffSeconds = parsePositiveNumber(argv[index], "--note-off");
    } else if (arg === "--probe") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--probe requires a value");
      }
      options.probes.push(parseProbe(argv[index]));
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.files.push(arg);
    }
  }
  if (options.noteOffSeconds >= options.durationSeconds) {
    throw new Error("--note-off must be earlier than --duration");
  }
  if (!options.probes.length) {
    const probe = normalizeProbe(
      {
        note: options.note,
        velocity: options.velocity,
        gateSeconds: options.noteOffSeconds - DEFAULT_NOTE_SECONDS,
      },
      "default probe",
    );
    probe.noteOffSeconds = options.noteOffSeconds;
    probe.durationSeconds = options.durationSeconds;
    options.probes.push(probe);
  }
  return options;
}

async function renderSynth(filePath, probe) {
  return withSunVoxSlot(
    {
      sampleRate: DEFAULT_SAMPLE_RATE,
      channels: DEFAULT_CHANNELS,
      flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
      slot: SLOT,
    },
    async ({ module, slot, sampleRate, channels }) => {
      const bytes = await readFile(filePath);
      const moduleIndex = loadSynthModuleFromBuffer(module, bytes, { slot });
      assertSunVoxOk(module._sv_volume(slot, 256), "sv_volume");
      const pattern = createNoteProbePattern(module, {
        slot,
        moduleIndex,
        note: probe.note,
        velocity: probe.velocity,
        gateSeconds: probe.gateSeconds,
        sampleRate,
        lineCount: PATTERN_LINE_COUNT,
        name: "sunsynth-characterize",
      });
      assertSunVoxOk(module._sv_play_from_beginning(slot), "sv_play_from_beginning");
      const rendered = renderSlotAudio(module, {
        slot,
        sampleRate,
        channels,
        durationSeconds: probe.durationSeconds,
        blockFrames: DEFAULT_BLOCK_FRAMES,
      });
      return {
        ...rendered,
        note: probe.note,
        noteOnFrame: pattern.noteOnFrame,
        noteOffFrame: pattern.noteOffFrame,
        probePattern: pattern,
      };
    },
  );
}

function frameRms(samples, channels, startFrame, endFrame) {
  let sumSquares = 0;
  let count = 0;
  for (let frame = Math.max(0, startFrame); frame < Math.min(endFrame, samples.length / channels); frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const value = samples[frame * channels + channel];
      sumSquares += value * value;
      count += 1;
    }
  }
  return count ? Math.sqrt(sumSquares / count) : 0;
}

function envelope(samples, channels, sampleRate, windowMs = 20) {
  const windowFrames = Math.max(1, Math.round((windowMs / 1000) * sampleRate));
  const frameCount = Math.floor(samples.length / channels);
  const windows = [];
  for (let start = 0; start < frameCount; start += windowFrames) {
    const end = Math.min(frameCount, start + windowFrames);
    windows.push({
      startFrame: start,
      endFrame: end,
      centerFrame: (start + end) / 2,
      rms: frameRms(samples, channels, start, end),
    });
  }
  return windows;
}

function attackMs(windows, noteOnFrame, noteOffFrame, sampleRate) {
  const active = windows.filter((window) => window.centerFrame >= noteOnFrame && window.centerFrame < noteOffFrame);
  const peak = active.reduce((max, window) => Math.max(max, window.rms), 0);
  if (!peak) {
    return undefined;
  }
  const target = peak * 0.8;
  const hit = active.find((window) => window.rms >= target);
  return hit ? Math.max(0, ((hit.centerFrame - noteOnFrame) / sampleRate) * 1000) : undefined;
}

function releaseMs(windows, noteOffFrame, sampleRate) {
  const beforeOff = windows.filter((window) => window.centerFrame >= noteOffFrame - sampleRate && window.centerFrame < noteOffFrame);
  const reference = beforeOff.reduce((max, window) => Math.max(max, window.rms), 0);
  if (!reference) {
    return undefined;
  }
  const threshold = reference * 0.1;
  const after = windows.filter((window) => window.centerFrame >= noteOffFrame);
  const hit = after.find((window) => window.rms <= threshold);
  return hit ? Math.max(0, ((hit.centerFrame - noteOffFrame) / sampleRate) * 1000) : undefined;
}

function fft(real, imag) {
  const size = real.length;
  for (let index = 1, reverse = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reverse & bit; bit >>= 1) {
      reverse ^= bit;
    }
    reverse ^= bit;
    if (index < reverse) {
      [real[index], real[reverse]] = [real[reverse], real[index]];
      [imag[index], imag[reverse]] = [imag[reverse], imag[index]];
    }
  }

  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const wLengthReal = Math.cos(angle);
    const wLengthImag = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let wReal = 1;
      let wImag = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const even = start + offset;
        const odd = even + length / 2;
        const oddReal = real[odd] * wReal - imag[odd] * wImag;
        const oddImag = real[odd] * wImag + imag[odd] * wReal;
        real[odd] = real[even] - oddReal;
        imag[odd] = imag[even] - oddImag;
        real[even] += oddReal;
        imag[even] += oddImag;
        const nextReal = wReal * wLengthReal - wImag * wLengthImag;
        wImag = wReal * wLengthImag + wImag * wLengthReal;
        wReal = nextReal;
      }
    }
  }
}

function nearestHarmonic(frequency, fundamentalHz) {
  if (!fundamentalHz || frequency <= 0) {
    return undefined;
  }
  const harmonic = Math.max(1, Math.round(frequency / fundamentalHz));
  const harmonicHz = harmonic * fundamentalHz;
  return {
    harmonic,
    cents: 1200 * Math.log2(frequency / harmonicHz),
  };
}

function spectrum(samples, channels, sampleRate, startFrame, size = SPECTRUM_SIZE, fundamentalHz = 0) {
  const frameCount = Math.floor(samples.length / channels);
  const real = new Float64Array(size);
  const imag = new Float64Array(size);
  const clampedStart = Math.max(0, Math.min(frameCount - size, startFrame));
  for (let index = 0; index < size; index += 1) {
    const frame = clampedStart + index;
    const left = samples[frame * channels] ?? 0;
    const right = channels > 1 ? samples[frame * channels + 1] ?? left : left;
    const mono = (left + right) / 2;
    const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (size - 1));
    real[index] = mono * window;
  }
  fft(real, imag);

  const bins = [];
  let totalPower = 0;
  let weightedPower = 0;
  let lowPower = 0;
  let midPower = 0;
  let highPower = 0;
  for (let bin = 1; bin < size / 2; bin += 1) {
    const frequency = (bin * sampleRate) / size;
    const power = real[bin] * real[bin] + imag[bin] * imag[bin];
    bins.push({ frequency, power });
    totalPower += power;
    weightedPower += frequency * power;
    if (frequency < 250) {
      lowPower += power;
    } else if (frequency < 2000) {
      midPower += power;
    } else {
      highPower += power;
    }
  }

  let cumulative = 0;
  let rolloff85 = 0;
  for (const bin of bins) {
    cumulative += bin.power;
    if (cumulative >= totalPower * 0.85) {
      rolloff85 = bin.frequency;
      break;
    }
  }

  const strongestPower = bins.reduce((max, bin) => Math.max(max, bin.power), 0);
  const peakThreshold = Math.max(strongestPower * 0.001, totalPower * 0.0001);
  const peaks = [];
  for (let index = 1; index < bins.length - 1; index += 1) {
    const previous = bins[index - 1];
    const current = bins[index];
    const next = bins[index + 1];
    if (current.frequency < 20 || current.power < peakThreshold) {
      continue;
    }
    if (current.power >= previous.power && current.power >= next.power) {
      const harmonic = nearestHarmonic(current.frequency, fundamentalHz);
      peaks.push({
        frequency: current.frequency,
        relativeDb: strongestPower ? 10 * Math.log10(current.power / strongestPower) : 0,
        ...(harmonic ? { harmonic: harmonic.harmonic, cents: harmonic.cents } : {}),
        power: current.power,
      });
    }
  }
  peaks.sort((a, b) => b.power - a.power);
  const dominantPeaks = peaks.slice(0, 8).map(({ power: _power, ...peak }) => peak);
  const inharmonicPeaks = dominantPeaks.filter((peak) => peak.cents !== undefined && peak.relativeDb >= -36);
  const inharmonicityCents = inharmonicPeaks.length
    ? inharmonicPeaks.reduce((sum, peak) => sum + Math.abs(peak.cents), 0) / inharmonicPeaks.length
    : 0;

  return {
    startSeconds: clampedStart / sampleRate,
    totalPower,
    centroidHz: totalPower ? weightedPower / totalPower : 0,
    rolloff85Hz: rolloff85,
    lowRatio: totalPower ? lowPower / totalPower : 0,
    midRatio: totalPower ? midPower / totalPower : 0,
    highRatio: totalPower ? highPower / totalPower : 0,
    inharmonicityCents,
    dominantPeaks,
  };
}

function zeroCrossingRate(samples, channels, startFrame, frames) {
  let crossings = 0;
  let previous = 0;
  let initialized = false;
  const endFrame = Math.min(Math.floor(samples.length / channels), startFrame + frames);
  for (let frame = Math.max(0, startFrame); frame < endFrame; frame += 1) {
    const left = samples[frame * channels] ?? 0;
    const right = channels > 1 ? samples[frame * channels + 1] ?? left : left;
    const mono = (left + right) / 2;
    if (initialized && (mono >= 0) !== (previous >= 0)) {
      crossings += 1;
    }
    previous = mono;
    initialized = true;
  }
  return frames ? crossings / frames : 0;
}

function stereoFeatures(samples, channels) {
  if (channels < 2) {
    return { correlation: 1, sideToMidRatio: 0 };
  }
  let leftSquares = 0;
  let rightSquares = 0;
  let cross = 0;
  let midSquares = 0;
  let sideSquares = 0;
  for (let frame = 0; frame < samples.length / channels; frame += 1) {
    const left = samples[frame * channels];
    const right = samples[frame * channels + 1];
    leftSquares += left * left;
    rightSquares += right * right;
    cross += left * right;
    const mid = (left + right) / 2;
    const side = (left - right) / 2;
    midSquares += mid * mid;
    sideSquares += side * side;
  }
  return {
    correlation: leftSquares && rightSquares ? cross / Math.sqrt(leftSquares * rightSquares) : 0,
    sideToMidRatio: midSquares ? Math.sqrt(sideSquares / midSquares) : sideSquares ? Number.POSITIVE_INFINITY : 0,
  };
}

function dominantWindow(windows, startFrame, endFrame) {
  return windows
    .filter((window) => window.centerFrame >= startFrame && window.centerFrame < endFrame)
    .reduce((max, window) => (window.rms > (max?.rms ?? -1) ? window : max), undefined);
}

function diagnosticNotes(features) {
  const notes = [];
  if (features.spectrum.highRatio > 0.42) {
    notes.push("high-band energy is strong, so the tone can read as hard or metallic");
  }
  if (features.spectrum.inharmonicityCents > 65) {
    notes.push("dominant peaks are far from harmonic multiples of the played note");
  }
  if (features.crestFactor > 7.5) {
    notes.push("the transient is spiky compared with the body level");
  }
  if (features.releaseMs !== undefined && features.releaseMs > 900) {
    notes.push("the tail rings for a long time");
  }
  if (features.tailToSustainRatio > 0.75) {
    notes.push("tail energy is close to the held-note body level");
  }
  return notes;
}

function tagFeatures(features) {
  const tags = [];
  if (features.rms < 0.06) {
    tags.push("quiet");
  } else if (features.rms < 0.14) {
    tags.push("medium");
  } else {
    tags.push("loud");
  }

  if (features.spectrum.centroidHz < 800) {
    tags.push("dark");
  } else if (features.spectrum.centroidHz < 1800) {
    tags.push("warm");
  } else if (features.spectrum.centroidHz < 3500) {
    tags.push("bright");
  } else {
    tags.push("airy");
  }

  if (features.attackMs !== undefined && features.attackMs > 300) {
    tags.push("slow-attack");
  } else if (features.attackMs !== undefined && features.attackMs < 90) {
    tags.push("fast-attack");
  }

  if (features.releaseMs !== undefined && features.releaseMs > 800) {
    tags.push("long-release");
  } else if (features.releaseMs !== undefined && features.releaseMs < 200) {
    tags.push("short-release");
  }

  if (features.stereo.sideToMidRatio > 0.32) {
    tags.push("wide");
  } else if (features.stereo.sideToMidRatio < 0.1) {
    tags.push("narrow");
  }
  if (features.spectrum.highRatio > 0.42 && features.spectrum.inharmonicityCents > 65) {
    tags.push("metallic");
  }
  return tags;
}

export function analyzeRenderedAudio(rendered) {
  const { samples, sampleRate, channels, noteOnFrame, noteOffFrame, note } = rendered;
  const frameCount = Math.floor(samples.length / channels);
  let peak = 0;
  let sumSquares = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
    sumSquares += sample * sample;
  }
  const windows = envelope(samples, channels, sampleRate);
  const activeEndFrame = Math.min(frameCount, Math.max(noteOffFrame, noteOnFrame + sampleRate * 0.75));
  const loudestWindow = dominantWindow(windows, noteOnFrame, activeEndFrame);
  const spectrumCenterFrame = loudestWindow?.centerFrame ?? noteOnFrame + (noteOffFrame - noteOnFrame) * 0.5;
  const spectrumStart = Math.round(spectrumCenterFrame - SPECTRUM_SIZE / 2);
  const transientSpectrumStart = Math.round(noteOnFrame + sampleRate * 0.04 - SPECTRUM_SIZE / 2);
  const tailSpectrumStart = Math.round(noteOffFrame + sampleRate * 0.16 - SPECTRUM_SIZE / 2);
  const transientRms = frameRms(samples, channels, noteOnFrame, noteOnFrame + Math.round(sampleRate * 0.12));
  const sustainRms = frameRms(samples, channels, Math.max(noteOnFrame, noteOffFrame - sampleRate), noteOffFrame);
  const tailRms = frameRms(samples, channels, noteOffFrame, frameCount);
  const fundamentalHz = noteFrequency(note ?? DEFAULT_NOTE);
  const features = {
    peak,
    rms: samples.length ? Math.sqrt(sumSquares / samples.length) : 0,
    crestFactor: sumSquares ? peak / Math.sqrt(sumSquares / samples.length) : 0,
    transientRms,
    sustainRms,
    tailRms,
    tailToSustainRatio: sustainRms ? tailRms / sustainRms : 0,
    attackMs: attackMs(windows, noteOnFrame, noteOffFrame, sampleRate),
    releaseMs: releaseMs(windows, noteOffFrame, sampleRate),
    spectrum: spectrum(samples, channels, sampleRate, spectrumStart, SPECTRUM_SIZE, fundamentalHz),
    transientSpectrum: spectrum(samples, channels, sampleRate, transientSpectrumStart, SPECTRUM_SIZE, fundamentalHz),
    tailSpectrum: spectrum(samples, channels, sampleRate, tailSpectrumStart, SPECTRUM_SIZE, fundamentalHz),
    zeroCrossingRate: zeroCrossingRate(samples, channels, spectrumStart, SPECTRUM_SIZE),
    stereo: stereoFeatures(samples, channels),
  };
  return {
    ...features,
    tags: tagFeatures(features),
    diagnosis: diagnosticNotes(features),
  };
}

async function analyzeFile(file, probe) {
  const filePath = resolve(file);
  if (!SAMPLE_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    throw new Error(`${file} is not a .sunsynth file`);
  }
  const rendered = await renderSynth(filePath, probe);
  return {
    file: relative(process.cwd(), filePath),
    probe: probe.id,
    note: probe.note,
    velocity: probe.velocity,
    durationSeconds: probe.durationSeconds,
    noteOffSeconds: probe.noteOffSeconds,
    gateSeconds: probe.gateSeconds,
    probePattern: rendered.probePattern,
    features: analyzeRenderedAudio(rendered),
  };
}

function fixed(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function rounded(value) {
  return Number.isFinite(value) ? String(Math.round(value)) : "-";
}

function formatTable(results) {
  const rows = [
    [
      "File",
      "Probe",
      "Note",
      "Vel",
      "Gate",
      "Peak",
      "RMS",
      "Crest",
      "Centroid",
      "Rolloff",
      "High",
      "Inharm",
      "Stereo",
      "Attack",
      "Release",
      "Tags",
    ],
  ];
  for (const result of results) {
    const { features } = result;
    rows.push([
      basename(result.file),
      result.probe,
      noteLabel(result.note),
      String(result.velocity),
      `${fixed(result.gateSeconds, 1)}s`,
      fixed(features.peak),
      fixed(features.rms),
      fixed(features.crestFactor, 2),
      `${rounded(features.spectrum.centroidHz)}Hz`,
      `${rounded(features.spectrum.rolloff85Hz)}Hz`,
      `${rounded(features.spectrum.highRatio * 100)}%`,
      `${rounded(features.spectrum.inharmonicityCents)}c`,
      fixed(features.stereo.sideToMidRatio, 2),
      features.attackMs === undefined ? "-" : `${rounded(features.attackMs)}ms`,
      features.releaseMs === undefined ? "-" : `${rounded(features.releaseMs)}ms`,
      features.tags.join(","),
    ]);
  }
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows
    .map((row, rowIndex) => {
      const line = row.map((cell, column) => cell.padEnd(widths[column])).join("  ");
      if (rowIndex === 0) {
        return `${line}\n${widths.map((width) => "-".repeat(width)).join("  ")}`;
      }
      return line;
    })
    .join("\n");
}

function formatPeak(peak) {
  const harmonic = peak.harmonic === undefined ? "" : ` ~${peak.harmonic}x ${fixed(peak.cents, 0)}c`;
  return `${rounded(peak.frequency)}Hz ${fixed(peak.relativeDb, 1)}dB${harmonic}`;
}

function formatSpectrum(label, spectrumFeatures) {
  return `${label}: centroid=${rounded(spectrumFeatures.centroidHz)}Hz rolloff85=${rounded(spectrumFeatures.rolloff85Hz)}Hz high=${rounded(spectrumFeatures.highRatio * 100)}% inharmonicity=${rounded(spectrumFeatures.inharmonicityCents)}c measuredAt=${fixed(spectrumFeatures.startSeconds, 2)}s`;
}

function formatDetails(results) {
  return results
    .map((result) => {
      const { features } = result;
      const diagnosis = features.diagnosis.length ? features.diagnosis : ["no obvious spectral issue detected"];
      return [
        `${basename(result.file)} ${result.probe}`,
        `  probe pattern: index=${result.probePattern.patternIndex} noteOffLine=${result.probePattern.noteOffLine} lineFrames=${result.probePattern.lineFrames} noteOnFrame=${result.probePattern.noteOnFrame} noteOffFrame=${result.probePattern.noteOffFrame}`,
        `  level: peak=${fixed(features.peak)} rms=${fixed(features.rms)} crest=${fixed(features.crestFactor, 2)} transient=${fixed(features.transientRms)} sustain=${fixed(features.sustainRms)} tail=${fixed(features.tailRms)} tail/sustain=${fixed(features.tailToSustainRatio, 2)}`,
        `  ${formatSpectrum("transient spectrum", features.transientSpectrum)}`,
        `  ${formatSpectrum("body spectrum", features.spectrum)}`,
        `  ${formatSpectrum("tail spectrum", features.tailSpectrum)}`,
        `  peaks: ${features.spectrum.dominantPeaks.map(formatPeak).join("; ") || "-"}`,
        `  diagnosis: ${diagnosis.join("; ")}`,
      ].join("\n");
    })
    .join("\n\n");
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    usage();
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    usage();
    return;
  }
  if (!options.files.length) {
    usage();
    process.exitCode = 1;
    return;
  }

  const results = [];
  let failures = 0;
  for (const file of options.files) {
    for (const probe of options.probes) {
      try {
        results.push(await analyzeFile(file, probe));
      } catch (error) {
        failures += 1;
        console.error(`${file} ${probe.id}: ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  } else if (results.length) {
    console.log(formatTable(results));
    if (options.detail) {
      console.log(`\n${formatDetails(results)}`);
    }
  }
  if (failures > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  await main(process.argv.slice(2));
}

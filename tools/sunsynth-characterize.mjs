#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

const DEFAULT_SAMPLE_RATE = 44100;
const DEFAULT_CHANNELS = 2;
const DEFAULT_BLOCK_FRAMES = 128;
const DEFAULT_DURATION_SECONDS = 6;
const DEFAULT_NOTE_OFF_SECONDS = 3.2;
const DEFAULT_NOTE_SECONDS = 0.2;
const DEFAULT_NOTE = 48;
const DEFAULT_VELOCITY = 96;
const SPECTRUM_SIZE = 4096;
const SLOT = 0;
const NOTE_OFF = 128;
const ALL_NOTES_OFF = 129;
const SV_INIT_FLAG_NO_DEBUG_OUTPUT = 1 << 0;
const SV_INIT_FLAG_OFFLINE = 1 << 1;
const SV_INIT_FLAG_AUDIO_FLOAT32 = 1 << 3;
const SV_INIT_FLAG_ONE_THREAD = 1 << 4;
const SUNVOX_JS_PATH = "sunvox_lib/sunvox_lib/js/lib/sunvox.js";
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
  node tools/sunsynth-characterize.mjs [--json] [--note <note|midi>] [--velocity <1..129>] <input.sunsynth> [...]

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

async function loadSunVoxLib() {
  const sunvoxJsPath = resolve(SUNVOX_JS_PATH);
  const sunvoxJsDir = dirname(sunvoxJsPath);
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require: createRequire(pathToFileURL(sunvoxJsPath)),
    __filename: sunvoxJsPath,
    __dirname: sunvoxJsDir,
    clearTimeout,
    console,
    Date,
    performance,
    process,
    setTimeout,
    TextDecoder,
    TextEncoder,
    URL,
    WebAssembly,
  };
  context.globalThis = context;
  vm.runInNewContext(readFileSync(sunvoxJsPath, "utf8"), context, { filename: sunvoxJsPath });
  const SunVoxLib = module.exports.default ?? module.exports;
  return SunVoxLib({
    locateFile: (fileName) => resolve(sunvoxJsDir, fileName),
    print: () => {},
    printErr: () => {},
  });
}

function assertSunVoxOk(value, label) {
  if (value < 0) {
    throw new Error(`${label} failed: ${value}`);
  }
  return value;
}

function mallocCopy(module, bytes) {
  const pointer = module._malloc(bytes.length);
  if (!pointer) {
    throw new Error("SunVox malloc failed");
  }
  module.HEAPU8.set(bytes, pointer);
  return pointer;
}

function sendNote(module, moduleIndex, track, note, velocity) {
  const noteValue = Math.max(1, Math.min(127, Math.round(note) + 1));
  module._sv_send_event(SLOT, track, noteValue, velocity, moduleIndex + 1, 0, 0);
}

function sendNoteOff(module, moduleIndex, track) {
  module._sv_send_event(SLOT, track, NOTE_OFF, 0, moduleIndex + 1, 0, 0);
}

async function renderSynth(filePath, probe) {
  const module = await loadSunVoxLib();
  const initFlags =
    SV_INIT_FLAG_NO_DEBUG_OUTPUT | SV_INIT_FLAG_OFFLINE | SV_INIT_FLAG_AUDIO_FLOAT32 | SV_INIT_FLAG_ONE_THREAD;
  assertSunVoxOk(module._sv_init(0, DEFAULT_SAMPLE_RATE, DEFAULT_CHANNELS, initFlags), "sv_init");
  try {
    assertSunVoxOk(module._sv_open_slot(SLOT), "sv_open_slot");
    const bytes = await readFile(filePath);
    const dataPointer = mallocCopy(module, bytes);
    let moduleIndex;
    try {
      moduleIndex = assertSunVoxOk(
        module._sv_load_module_from_memory(SLOT, dataPointer, bytes.length, 256, 256, 0),
        "sv_load_module_from_memory",
      );
    } finally {
      module._free(dataPointer);
    }
    assertSunVoxOk(module._sv_connect_module(SLOT, moduleIndex, 0), "sv_connect_module");
    assertSunVoxOk(module._sv_volume(SLOT, 256), "sv_volume");
    assertSunVoxOk(module._sv_play(SLOT), "sv_play");

    const totalFrames = Math.round(probe.durationSeconds * DEFAULT_SAMPLE_RATE);
    const outputPointer = module._malloc(DEFAULT_BLOCK_FRAMES * DEFAULT_CHANNELS * 4);
    if (!outputPointer) {
      throw new Error("SunVox audio output malloc failed");
    }
    const samples = new Float32Array(totalFrames * DEFAULT_CHANNELS);
    const events = [
      { frame: Math.round(DEFAULT_NOTE_SECONDS * DEFAULT_SAMPLE_RATE), type: "note" },
      { frame: Math.round(probe.noteOffSeconds * DEFAULT_SAMPLE_RATE), type: "off" },
      { frame: Math.round((probe.durationSeconds - 0.5) * DEFAULT_SAMPLE_RATE), type: "allOff" },
    ];
    let eventIndex = 0;
    let writeFrame = 0;
    try {
      while (writeFrame < totalFrames) {
        const frames = Math.min(DEFAULT_BLOCK_FRAMES, totalFrames - writeFrame);
        while (eventIndex < events.length && events[eventIndex].frame <= writeFrame) {
          const event = events[eventIndex];
          if (event.type === "note") {
            sendNote(module, moduleIndex, 0, probe.note, probe.velocity);
          } else if (event.type === "off") {
            sendNoteOff(module, moduleIndex, 0);
          } else {
            module._sv_send_event(SLOT, 0, ALL_NOTES_OFF, 0, 0, 0, 0);
          }
          eventIndex += 1;
        }
        assertSunVoxOk(module._sv_audio_callback(outputPointer, frames, 0, writeFrame / DEFAULT_SAMPLE_RATE), "sv_audio_callback");
        samples.set(
          module.HEAPF32.subarray(outputPointer >> 2, (outputPointer >> 2) + frames * DEFAULT_CHANNELS),
          writeFrame * DEFAULT_CHANNELS,
        );
        writeFrame += frames;
      }
    } finally {
      module._free(outputPointer);
    }
    return {
      samples,
      sampleRate: DEFAULT_SAMPLE_RATE,
      channels: DEFAULT_CHANNELS,
      noteOnFrame: Math.round(DEFAULT_NOTE_SECONDS * DEFAULT_SAMPLE_RATE),
      noteOffFrame: Math.round(probe.noteOffSeconds * DEFAULT_SAMPLE_RATE),
    };
  } finally {
    module._sv_close_slot(SLOT);
    module._sv_deinit();
  }
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

function spectrum(samples, channels, sampleRate, startFrame, size = SPECTRUM_SIZE) {
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

  return {
    centroidHz: totalPower ? weightedPower / totalPower : 0,
    rolloff85Hz: rolloff85,
    lowRatio: totalPower ? lowPower / totalPower : 0,
    midRatio: totalPower ? midPower / totalPower : 0,
    highRatio: totalPower ? highPower / totalPower : 0,
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
  return tags;
}

export function analyzeRenderedAudio(rendered) {
  const { samples, sampleRate, channels, noteOnFrame, noteOffFrame } = rendered;
  const frameCount = Math.floor(samples.length / channels);
  let peak = 0;
  let sumSquares = 0;
  for (const sample of samples) {
    peak = Math.max(peak, Math.abs(sample));
    sumSquares += sample * sample;
  }
  const windows = envelope(samples, channels, sampleRate);
  const spectrumStart = Math.round(noteOnFrame + (noteOffFrame - noteOnFrame) * 0.58);
  const features = {
    peak,
    rms: samples.length ? Math.sqrt(sumSquares / samples.length) : 0,
    crestFactor: sumSquares ? peak / Math.sqrt(sumSquares / samples.length) : 0,
    sustainRms: frameRms(samples, channels, Math.max(noteOnFrame, noteOffFrame - sampleRate), noteOffFrame),
    tailRms: frameRms(samples, channels, noteOffFrame, frameCount),
    attackMs: attackMs(windows, noteOnFrame, noteOffFrame, sampleRate),
    releaseMs: releaseMs(windows, noteOffFrame, sampleRate),
    spectrum: spectrum(samples, channels, sampleRate, spectrumStart),
    zeroCrossingRate: zeroCrossingRate(samples, channels, spectrumStart, SPECTRUM_SIZE),
    stereo: stereoFeatures(samples, channels),
  };
  return {
    ...features,
    tags: tagFeatures(features),
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
  }
  if (failures > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  await main(process.argv.slice(2));
}

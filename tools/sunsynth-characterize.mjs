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
  SunVoxNoteCommands,
  assertSunVoxOk,
  createNoteProbePattern,
  loadSynthModuleFromBuffer,
  renderSlotAudio,
  sunVoxNoteValue,
  withSunVoxSlot,
} from "./sunvox-node.mjs";

const DEFAULT_DURATION_SECONDS = 6;
const DEFAULT_NOTE_OFF_SECONDS = 3.2;
const DEFAULT_NOTE_SECONDS = 0.2;
const DEFAULT_NOTE = 48;
const DEFAULT_VELOCITY = 96;
const DEFAULT_MASTER_VOLUME = 256;
const PROBE_TRACK = 0;
const PATTERN_RENDER_METHOD = "pattern-playback";
const DIRECT_EVENT_RENDER_METHOD = "direct-event";
const RENDER_METHOD_ALIASES = new Map([
  ["pattern", PATTERN_RENDER_METHOD],
  ["pattern-playback", PATTERN_RENDER_METHOD],
  ["event", DIRECT_EVENT_RENDER_METHOD],
  ["direct-event", DIRECT_EVENT_RENDER_METHOD],
]);
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
  node tools/sunsynth-characterize.mjs [--json] [--detail] [--render-method <pattern|event|both>] [--note <note|midi>] [--velocity <1..129>] [--note-sweep <notes>] [--velocity-sweep <values>] [--gate-sweep <seconds>] <input.sunsynth> [...]

Examples:
  node tools/sunsynth-characterize.mjs instruments/*.sunsynth
  node tools/sunsynth-characterize.mjs --json --note C3 var/glass-chord-pad.sunsynth
  node tools/sunsynth-characterize.mjs --note-sweep C2,C3,C4 --velocity-sweep 64,96 --gate-sweep 0.25,2 generated/instruments/Scratch\\ FMX\\ Tines.sunsynth
  node tools/sunsynth-characterize.mjs --render-method both --probe C2:72:2.0 --probe C4:112:1.5 var/glass-chord-pad.sunsynth`);
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

function formatSeconds(value) {
  return Number(value).toFixed(6).replace(/\.?0+$/u, "");
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
    id: `${noteLabel(normalized.note)}:${normalized.velocity}:${formatSeconds(normalized.gateSeconds)}s`,
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

function parseCommaSeparated(value, parser, label) {
  const items = value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
  if (!items.length) {
    throw new Error(`${label} requires at least one value`);
  }
  return items.map((item) => parser(item));
}

function parseRenderMethods(value) {
  if (value === "both") {
    return [PATTERN_RENDER_METHOD, DIRECT_EVENT_RENDER_METHOD];
  }
  const renderMethod = RENDER_METHOD_ALIASES.get(value);
  if (!renderMethod) {
    throw new Error(`Invalid --render-method value: ${value}`);
  }
  return [renderMethod];
}

function parseArgs(argv) {
  const options = {
    json: false,
    detail: false,
    renderMethods: [PATTERN_RENDER_METHOD],
    note: DEFAULT_NOTE,
    velocity: DEFAULT_VELOCITY,
    durationSeconds: DEFAULT_DURATION_SECONDS,
    noteOffSeconds: DEFAULT_NOTE_OFF_SECONDS,
    noteOffExplicit: false,
    noteSweep: undefined,
    velocitySweep: undefined,
    gateSweep: undefined,
    explicitProbes: false,
    probes: [],
    files: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--detail") {
      options.detail = true;
    } else if (arg === "--render-method") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--render-method requires a value");
      }
      options.renderMethods = parseRenderMethods(argv[index]);
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
    } else if (arg === "--note-sweep") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--note-sweep requires a value");
      }
      options.noteSweep = parseCommaSeparated(argv[index], parseNote, "--note-sweep");
    } else if (arg === "--velocity-sweep") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--velocity-sweep requires a value");
      }
      options.velocitySweep = parseCommaSeparated(
        argv[index],
        (value) => Math.max(1, Math.min(129, Math.round(parsePositiveNumber(value, "--velocity-sweep")))),
        "--velocity-sweep",
      );
    } else if (arg === "--gate-sweep") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--gate-sweep requires a value");
      }
      options.gateSweep = parseCommaSeparated(
        argv[index],
        (value) => parsePositiveNumber(value, "--gate-sweep"),
        "--gate-sweep",
      );
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
      options.noteOffExplicit = true;
    } else if (arg === "--probe") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--probe requires a value");
      }
      options.probes.push(parseProbe(argv[index]));
      options.explicitProbes = true;
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
  if (options.gateSweep && options.noteOffExplicit) {
    throw new Error("--gate-sweep cannot be combined with --note-off");
  }
  if (!options.probes.length) {
    const notes = options.noteSweep ?? [options.note];
    const velocities = options.velocitySweep ?? [options.velocity];
    const gates = options.gateSweep ?? [options.noteOffSeconds - DEFAULT_NOTE_SECONDS];
    for (const note of notes) {
      for (const velocity of velocities) {
        for (const gateSeconds of gates) {
          if (DEFAULT_NOTE_SECONDS + gateSeconds >= options.durationSeconds) {
            throw new Error(`gate ${formatSeconds(gateSeconds)}s must fit before --duration`);
          }
          const probe = normalizeProbe(
            {
              note,
              velocity,
              gateSeconds,
            },
            "default probe",
          );
          probe.noteOffSeconds = DEFAULT_NOTE_SECONDS + gateSeconds;
          probe.durationSeconds = options.durationSeconds;
          options.probes.push(probe);
        }
      }
    }
  }
  return options;
}

function uniqueNumbers(values) {
  return [...new Set(values)].sort((a, b) => a - b);
}

function buildSweepMetadata(options) {
  const notes = uniqueNumbers(options.probes.map((probe) => probe.note));
  const velocities = uniqueNumbers(options.probes.map((probe) => probe.velocity));
  const gateSeconds = uniqueNumbers(options.probes.map((probe) => probe.gateSeconds));
  return {
    mode: options.explicitProbes ? "explicit-probes" : "cross-product",
    notes,
    noteLabels: notes.map(noteLabel),
    velocities,
    gateSeconds,
    renderMethods: options.renderMethods,
    probeCount: options.probes.length,
    resultCount: options.probes.length * options.renderMethods.length,
  };
}

function renderPatternProbe(module, { slot, moduleIndex, sampleRate, channels, probe }) {
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
    renderMethod: PATTERN_RENDER_METHOD,
    note: probe.note,
    noteOnFrame: pattern.noteOnFrame,
    noteOffFrame: pattern.noteOffFrame,
    moduleNumber: moduleIndex + 1,
    track: PROBE_TRACK,
    probePattern: pattern,
  };
}

function renderSlotAudioAtFrame(module, { slot, sampleRate, channels, durationSeconds, startFrame, baseTicks }) {
  const ticksPerSecond = module._sv_get_ticks_per_second();
  return renderSlotAudio(module, {
    slot,
    sampleRate,
    channels,
    durationSeconds,
    blockFrames: DEFAULT_BLOCK_FRAMES,
    outTime: (frame) => baseTicks + Math.floor(((startFrame + frame) * ticksPerSecond) / sampleRate),
  });
}

function concatRenderedAudio(segments, channels, sampleRate) {
  const totalLength = segments.reduce((sum, segment) => sum + segment.samples.length, 0);
  const samples = new Float32Array(totalLength);
  let offset = 0;
  for (const segment of segments) {
    samples.set(segment.samples, offset);
    offset += segment.samples.length;
  }
  return { samples, channels, sampleRate };
}

function renderDirectEventProbe(module, { slot, moduleIndex, sampleRate, channels, probe }) {
  const noteValue = sunVoxNoteValue(probe.note);
  const moduleNumber = moduleIndex + 1;
  const gateFrames = Math.round(probe.gateSeconds * sampleRate);
  const ticksPerSecond = module._sv_get_ticks_per_second();
  const gateTicks = Math.floor(probe.gateSeconds * ticksPerSecond);
  const releaseSeconds = Math.max(0, probe.durationSeconds - probe.gateSeconds);
  const baseTicks = module._sv_get_ticks();
  const noteOnTicks = baseTicks >>> 0;
  const noteOffTicks = (baseTicks + gateTicks) >>> 0;
  assertSunVoxOk(module._sv_play(slot), "sv_play");
  assertSunVoxOk(module._sv_set_event_t(slot, 1, baseTicks), "sv_set_event_t note on");
  assertSunVoxOk(module._sv_send_event(slot, PROBE_TRACK, noteValue, probe.velocity, moduleNumber, 0, 0), "sv_send_event note on");
  const gate = renderSlotAudioAtFrame(module, {
    slot,
    sampleRate,
    channels,
    durationSeconds: probe.gateSeconds,
    startFrame: 0,
    baseTicks,
  });
  assertSunVoxOk(module._sv_set_event_t(slot, 1, baseTicks + gateTicks), "sv_set_event_t note off");
  assertSunVoxOk(
    module._sv_send_event(slot, PROBE_TRACK, SunVoxNoteCommands.noteOff, 0, moduleNumber, 0, 0),
    "sv_send_event note off",
  );
  const release = renderSlotAudioAtFrame(module, {
    slot,
    sampleRate,
    channels,
    durationSeconds: releaseSeconds,
    startFrame: gateFrames,
    baseTicks,
  });
  assertSunVoxOk(module._sv_set_event_t(slot, 0, 0), "sv_set_event_t reset");
  assertSunVoxOk(
    module._sv_send_event(slot, PROBE_TRACK, SunVoxNoteCommands.allNotesOff, 0, 0, 0, 0),
    "sv_send_event all notes off",
  );
  assertSunVoxOk(module._sv_stop(slot), "sv_stop");
  const rendered = concatRenderedAudio([gate, release], channels, sampleRate);
  return {
    ...rendered,
    renderMethod: DIRECT_EVENT_RENDER_METHOD,
    note: probe.note,
    noteOnFrame: 0,
    noteOffFrame: gateFrames,
    moduleNumber,
    track: PROBE_TRACK,
    eventTimeline: {
      noteOn: {
        ticks: noteOnTicks,
        frame: 0,
        track: PROBE_TRACK,
        note: noteValue,
        velocity: probe.velocity,
        module: moduleNumber,
        controller: 0,
        value: 0,
      },
      noteOff: {
        ticks: noteOffTicks,
        frame: gateFrames,
        track: PROBE_TRACK,
        note: SunVoxNoteCommands.noteOff,
        velocity: 0,
        module: moduleNumber,
        controller: 0,
        value: 0,
      },
      ticksPerSecond,
      gateTicks,
      gateFrames,
      releaseSeconds,
    },
  };
}

async function renderSynth(filePath, probe, renderMethod) {
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
      assertSunVoxOk(module._sv_volume(slot, DEFAULT_MASTER_VOLUME), "sv_volume");
      if (renderMethod === PATTERN_RENDER_METHOD) {
        return renderPatternProbe(module, { slot, moduleIndex, sampleRate, channels, probe });
      }
      if (renderMethod === DIRECT_EVENT_RENDER_METHOD) {
        return renderDirectEventProbe(module, { slot, moduleIndex, sampleRate, channels, probe });
      }
      throw new Error(`Unsupported render method: ${renderMethod}`);
    },
  );
}

function buildMeasurement(filePath, probe, rendered) {
  const { sampleRate, channels, samples } = rendered;
  const renderedFrameCount = Math.floor(samples.length / channels);
  const noteOnFrame = rendered.noteOnFrame;
  const noteOffFrame = rendered.noteOffFrame;
  const actualGateSeconds = Math.max(0, (noteOffFrame - noteOnFrame) / sampleRate);
  const noteOnEvent = rendered.probePattern?.events[0] ?? rendered.eventTimeline?.noteOn;
  const noteOffEvent = rendered.probePattern?.events[1] ?? rendered.eventTimeline?.noteOff;
  const noteOn = {
    frame: noteOnFrame,
    seconds: noteOnFrame / sampleRate,
  };
  const noteOff = {
    frame: noteOffFrame,
    seconds: noteOffFrame / sampleRate,
  };
  if (rendered.probePattern) {
    noteOn.line = noteOnEvent?.line ?? 0;
    noteOff.line = noteOffEvent?.line ?? rendered.probePattern.noteOffLine;
  }
  if (rendered.eventTimeline) {
    noteOn.ticks = rendered.eventTimeline.noteOn.ticks;
    noteOff.ticks = rendered.eventTimeline.noteOff.ticks;
  }
  return {
    sourceFile: relative(process.cwd(), filePath),
    renderMethod: rendered.renderMethod,
    input: {
      id: probe.id,
      note: probe.note,
      noteLabel: noteLabel(probe.note),
      noteHz: noteFrequency(probe.note),
      velocity: probe.velocity,
      requestedGateSeconds: probe.gateSeconds,
      requestedDurationSeconds: probe.durationSeconds,
    },
    playback: {
      sampleRate,
      channels,
      masterVolume: DEFAULT_MASTER_VOLUME,
      track: rendered.track,
      moduleNumber: rendered.moduleNumber ?? noteOnEvent?.module,
      durationSeconds: renderedFrameCount / sampleRate,
      lineFrames: rendered.probePattern?.lineFrames,
      timingSource:
        rendered.renderMethod === PATTERN_RENDER_METHOD
          ? "sv_get_time_map frames rendered through sv_audio_callback system ticks"
          : "sv_set_event_t ticks rendered through sv_audio_callback system ticks",
      noteOn,
      noteOff,
      actualGateSeconds,
    },
  };
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

function decayMs(windows, noteOnFrame, noteOffFrame, sampleRate) {
  const active = windows.filter((window) => window.centerFrame >= noteOnFrame && window.centerFrame < noteOffFrame);
  const peakWindow = active.reduce((max, window) => (window.rms > (max?.rms ?? -1) ? window : max), undefined);
  if (!peakWindow?.rms) {
    return undefined;
  }
  const threshold = peakWindow.rms * 0.5;
  const hit = active.find((window) => window.centerFrame > peakWindow.centerFrame && window.rms <= threshold);
  return hit ? Math.max(0, ((hit.centerFrame - peakWindow.centerFrame) / sampleRate) * 1000) : undefined;
}

function releaseAnalysis(windows, noteOffFrame, sampleRate, peakRms) {
  const beforeOff = windows.filter((window) => window.centerFrame >= noteOffFrame - sampleRate && window.centerFrame < noteOffFrame);
  const referenceRms = beforeOff.reduce((max, window) => Math.max(max, window.rms), 0);
  const thresholdRms = referenceRms * 0.1;
  if (!referenceRms) {
    return { status: "not-applicable", referenceRms, thresholdRms };
  }
  if (peakRms && referenceRms < peakRms * 0.08) {
    return { status: "too-quiet-before-note-off", referenceRms, thresholdRms };
  }
  const after = windows.filter((window) => window.centerFrame >= noteOffFrame);
  const hit = after.find((window) => window.rms <= thresholdRms);
  if (!hit) {
    return { status: "not-applicable", referenceRms, thresholdRms };
  }
  return {
    status: "measured",
    ms: Math.max(0, ((hit.centerFrame - noteOffFrame) / sampleRate) * 1000),
    referenceRms,
    thresholdRms,
  };
}

function tailDurationMs(windows, noteOnFrame, sampleRate, peakRms) {
  if (!peakRms) {
    return undefined;
  }
  const threshold = Math.max(peakRms * 0.01, 1e-6);
  const audible = windows.filter((window) => window.centerFrame >= noteOnFrame && window.rms > threshold);
  const last = audible.at(-1);
  return last ? Math.max(0, ((last.endFrame - noteOnFrame) / sampleRate) * 1000) : undefined;
}

function noteOffSensitivity(windows, noteOffFrame, sampleRate) {
  const before = windows.filter(
    (window) => window.centerFrame >= noteOffFrame - sampleRate * 0.12 && window.centerFrame < noteOffFrame,
  );
  const after = windows.filter(
    (window) => window.centerFrame >= noteOffFrame && window.centerFrame < noteOffFrame + sampleRate * 0.12,
  );
  const meanRms = (items) => (items.length ? items.reduce((sum, window) => sum + window.rms, 0) / items.length : 0);
  const beforeRms = meanRms(before);
  const afterRms = meanRms(after);
  const ratio = beforeRms ? afterRms / beforeRms : undefined;
  const deltaDb = beforeRms && afterRms ? 20 * Math.log10(afterRms / beforeRms) : undefined;
  return {
    beforeRms,
    afterRms,
    ...(ratio === undefined ? {} : { ratio }),
    ...(deltaDb === undefined ? {} : { deltaDb }),
    changed: deltaDb === undefined ? false : Math.abs(deltaDb) >= 3,
  };
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
  let weightedVariance = 0;
  let logPowerSum = 0;
  let flatnessBins = 0;
  let lowPower = 0;
  let midPower = 0;
  let highPower = 0;
  for (let bin = 1; bin < size / 2; bin += 1) {
    const frequency = (bin * sampleRate) / size;
    const power = real[bin] * real[bin] + imag[bin] * imag[bin];
    bins.push({ frequency, power });
    totalPower += power;
    weightedPower += frequency * power;
    if (power > 0) {
      logPowerSum += Math.log(power);
      flatnessBins += 1;
    }
    if (frequency < 250) {
      lowPower += power;
    } else if (frequency < 2000) {
      midPower += power;
    } else {
      highPower += power;
    }
  }

  const centroidHz = totalPower ? weightedPower / totalPower : 0;
  for (const bin of bins) {
    weightedVariance += (bin.frequency - centroidHz) ** 2 * bin.power;
  }
  const arithmeticMeanPower = flatnessBins ? totalPower / flatnessBins : 0;
  const geometricMeanPower = flatnessBins ? Math.exp(logPowerSum / flatnessBins) : 0;

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
    centroidHz,
    bandwidthHz: totalPower ? Math.sqrt(weightedVariance / totalPower) : 0,
    rolloff85Hz: rolloff85,
    flatness: arithmeticMeanPower ? geometricMeanPower / arithmeticMeanPower : 0,
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
  if (features.spectrum.transient.highRatio > 0.42) {
    notes.push("high-band energy is strong during the transient");
  }
  if (features.spectrum.body.inharmonicityCents > 65) {
    notes.push("dominant peaks are far from harmonic multiples of the played note");
  }
  if (features.level.crestFactor > 7.5) {
    notes.push("the transient is spiky compared with the body level");
  }
  if (features.envelope.release.status === "too-quiet-before-note-off") {
    notes.push("release not measured because the signal was already quiet before note-off");
  } else if (features.envelope.release.status === "measured" && features.envelope.release.ms > 900) {
    notes.push("the tail rings for a long time");
  }
  if (features.level.tailToBodyRatio > 0.75) {
    notes.push("tail energy is close to the body level");
  }
  return notes;
}

function tagFeatures(features) {
  const tags = [];
  if (features.level.rms < 0.06) {
    tags.push("quiet");
  } else if (features.level.rms < 0.14) {
    tags.push("medium");
  } else {
    tags.push("loud");
  }

  if (features.spectrum.body.centroidHz < 800) {
    tags.push("dark");
  } else if (features.spectrum.body.centroidHz < 1800) {
    tags.push("warm");
  } else if (features.spectrum.body.centroidHz < 3500) {
    tags.push("bright");
  } else {
    tags.push("airy");
  }

  if (features.envelope.attackMs !== undefined && features.envelope.attackMs > 300) {
    tags.push("slow-attack");
  } else if (features.envelope.attackMs !== undefined && features.envelope.attackMs < 90) {
    tags.push("fast-attack");
  }

  if (features.envelope.release.status === "measured" && features.envelope.release.ms > 800) {
    tags.push("long-release");
  } else if (features.envelope.release.status === "measured" && features.envelope.release.ms < 200) {
    tags.push("short-release");
  }

  if (features.stereo.sideToMidRatio > 0.32) {
    tags.push("wide");
  } else if (features.stereo.sideToMidRatio < 0.1) {
    tags.push("narrow");
  }
  if (features.spectrum.transient.highRatio > 0.42 && features.spectrum.body.inharmonicityCents > 65) {
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
  const bodyRms = frameRms(samples, channels, Math.max(noteOnFrame, noteOffFrame - sampleRate), noteOffFrame);
  const tailRms = frameRms(samples, channels, noteOffFrame, frameCount);
  const fundamentalHz = noteFrequency(note ?? DEFAULT_NOTE);
  const rms = samples.length ? Math.sqrt(sumSquares / samples.length) : 0;
  const peakRms = windows.reduce((max, window) => Math.max(max, window.rms), 0);
  const features = {
    level: {
      peak,
      rms,
      crestFactor: rms ? peak / rms : 0,
      transientRms,
      bodyRms,
      tailRms,
      tailToBodyRatio: bodyRms ? tailRms / bodyRms : 0,
    },
    envelope: {
      attackMs: attackMs(windows, noteOnFrame, noteOffFrame, sampleRate),
      decayMs: decayMs(windows, noteOnFrame, noteOffFrame, sampleRate),
      release: releaseAnalysis(windows, noteOffFrame, sampleRate, peakRms),
      tailDurationMs: tailDurationMs(windows, noteOnFrame, sampleRate, peakRms),
      noteOffSensitivity: noteOffSensitivity(windows, noteOffFrame, sampleRate),
    },
    spectrum: {
      body: spectrum(samples, channels, sampleRate, spectrumStart, SPECTRUM_SIZE, fundamentalHz),
      transient: spectrum(samples, channels, sampleRate, transientSpectrumStart, SPECTRUM_SIZE, fundamentalHz),
      tail: spectrum(samples, channels, sampleRate, tailSpectrumStart, SPECTRUM_SIZE, fundamentalHz),
      zeroCrossingRate: zeroCrossingRate(samples, channels, spectrumStart, SPECTRUM_SIZE),
    },
    stereo: stereoFeatures(samples, channels),
  };
  return {
    ...features,
    tags: tagFeatures(features),
    diagnosis: diagnosticNotes(features),
  };
}

async function analyzeFile(file, probe, renderMethod) {
  const filePath = resolve(file);
  if (!SAMPLE_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    throw new Error(`${file} is not a .sunsynth file`);
  }
  const rendered = await renderSynth(filePath, probe, renderMethod);
  const result = {
    measurement: buildMeasurement(filePath, probe, rendered),
    features: analyzeRenderedAudio(rendered),
  };
  if (rendered.probePattern) {
    result.probePattern = rendered.probePattern;
  }
  if (rendered.eventTimeline) {
    result.eventTimeline = rendered.eventTimeline;
  }
  return result;
}

function compareNumber(pattern, directEvent) {
  const delta = directEvent - pattern;
  const comparison = {
    pattern,
    directEvent,
    delta,
  };
  if (pattern !== 0) {
    comparison.ratio = directEvent / pattern;
  }
  return comparison;
}

function measuredReleaseMs(result) {
  const release = result.features.envelope.release;
  return release.status === "measured" ? release.ms : undefined;
}

function tagComparison(patternTags, directEventTags) {
  return {
    pattern: patternTags,
    directEvent: directEventTags,
    added: directEventTags.filter((tag) => !patternTags.includes(tag)),
    removed: patternTags.filter((tag) => !directEventTags.includes(tag)),
  };
}

function comparisonKey(result) {
  return `${result.measurement.sourceFile}\0${result.measurement.input.id}`;
}

function buildComparisons(results) {
  const groups = new Map();
  for (const result of results) {
    const key = comparisonKey(result);
    const group = groups.get(key) ?? {};
    group[result.measurement.renderMethod] = result;
    groups.set(key, group);
  }
  const comparisons = [];
  for (const group of groups.values()) {
    const pattern = group[PATTERN_RENDER_METHOD];
    const directEvent = group[DIRECT_EVENT_RENDER_METHOD];
    if (!pattern || !directEvent) {
      continue;
    }
    comparisons.push({
      sourceFile: pattern.measurement.sourceFile,
      input: pattern.measurement.input,
      methods: {
        baseline: PATTERN_RENDER_METHOD,
        candidate: DIRECT_EVENT_RENDER_METHOD,
      },
      playback: {
        actualGateSeconds: compareNumber(
          pattern.measurement.playback.actualGateSeconds,
          directEvent.measurement.playback.actualGateSeconds,
        ),
        noteOffFrame: compareNumber(pattern.measurement.playback.noteOff.frame, directEvent.measurement.playback.noteOff.frame),
      },
      level: {
        peak: compareNumber(pattern.features.level.peak, directEvent.features.level.peak),
        rms: compareNumber(pattern.features.level.rms, directEvent.features.level.rms),
        bodyRms: compareNumber(pattern.features.level.bodyRms, directEvent.features.level.bodyRms),
        tailRms: compareNumber(pattern.features.level.tailRms, directEvent.features.level.tailRms),
      },
      envelope: {
        attackMs: compareNumber(pattern.features.envelope.attackMs ?? 0, directEvent.features.envelope.attackMs ?? 0),
        decayMs: compareNumber(pattern.features.envelope.decayMs ?? 0, directEvent.features.envelope.decayMs ?? 0),
        release: {
          patternStatus: pattern.features.envelope.release.status,
          directEventStatus: directEvent.features.envelope.release.status,
          ms: compareNumber(measuredReleaseMs(pattern) ?? 0, measuredReleaseMs(directEvent) ?? 0),
        },
      },
      spectrum: {
        bodyCentroidHz: compareNumber(
          pattern.features.spectrum.body.centroidHz,
          directEvent.features.spectrum.body.centroidHz,
        ),
        bodyRolloff85Hz: compareNumber(
          pattern.features.spectrum.body.rolloff85Hz,
          directEvent.features.spectrum.body.rolloff85Hz,
        ),
        bodyInharmonicityCents: compareNumber(
          pattern.features.spectrum.body.inharmonicityCents,
          directEvent.features.spectrum.body.inharmonicityCents,
        ),
      },
      stereo: {
        sideToMidRatio: compareNumber(pattern.features.stereo.sideToMidRatio, directEvent.features.stereo.sideToMidRatio),
      },
      tags: tagComparison(pattern.features.tags, directEvent.features.tags),
    });
  }
  return comparisons;
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
      "NoteHz",
      "Vel",
      "Gate",
      "Method",
      "Peak",
      "RMS",
      "Crest",
      "Centroid",
      "Bandwidth",
      "Rolloff",
      "Flat",
      "High",
      "Inharm",
      "Stereo",
      "Attack",
      "Decay",
      "Release",
      "Tags",
    ],
  ];
  for (const result of results) {
    const { features, measurement } = result;
    rows.push([
      basename(measurement.sourceFile),
      measurement.input.id,
      measurement.input.noteLabel,
      `${fixed(measurement.input.noteHz, 2)}Hz`,
      String(measurement.input.velocity),
      `${formatSeconds(measurement.playback.actualGateSeconds)}s`,
      measurement.renderMethod,
      fixed(features.level.peak),
      fixed(features.level.rms),
      fixed(features.level.crestFactor, 2),
      `${rounded(features.spectrum.body.centroidHz)}Hz`,
      `${rounded(features.spectrum.body.bandwidthHz)}Hz`,
      `${rounded(features.spectrum.body.rolloff85Hz)}Hz`,
      fixed(features.spectrum.body.flatness, 4),
      `${rounded(features.spectrum.body.highRatio * 100)}%`,
      `${rounded(features.spectrum.body.inharmonicityCents)}c`,
      fixed(features.stereo.sideToMidRatio, 2),
      features.envelope.attackMs === undefined ? "-" : `${rounded(features.envelope.attackMs)}ms`,
      features.envelope.decayMs === undefined ? "-" : `${rounded(features.envelope.decayMs)}ms`,
      features.envelope.release.status === "measured"
        ? `${rounded(features.envelope.release.ms)}ms`
        : features.envelope.release.status,
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
  return `${label}: centroid=${rounded(spectrumFeatures.centroidHz)}Hz bandwidth=${rounded(spectrumFeatures.bandwidthHz)}Hz rolloff85=${rounded(spectrumFeatures.rolloff85Hz)}Hz flatness=${fixed(spectrumFeatures.flatness, 4)} high=${rounded(spectrumFeatures.highRatio * 100)}% inharmonicity=${rounded(spectrumFeatures.inharmonicityCents)}c measuredAt=${fixed(spectrumFeatures.startSeconds, 2)}s`;
}

function formatDetails(results) {
  return results
    .map((result) => {
      const { features, measurement } = result;
      const diagnosis = features.diagnosis.length ? features.diagnosis : ["no obvious spectral issue detected"];
      const probeLine = result.probePattern
        ? `  probe pattern: index=${result.probePattern.patternIndex} noteOffLine=${result.probePattern.noteOffLine} lineFrames=${result.probePattern.lineFrames} noteOnFrame=${result.probePattern.noteOnFrame} noteOffFrame=${result.probePattern.noteOffFrame}`
        : `  event timeline: noteOnTicks=${result.eventTimeline?.noteOn.ticks ?? "-"} noteOffTicks=${result.eventTimeline?.noteOff.ticks ?? "-"} gateTicks=${result.eventTimeline?.gateTicks ?? "-"} noteOnFrame=${measurement.playback.noteOn.frame} noteOffFrame=${measurement.playback.noteOff.frame}`;
      return [
        `${basename(measurement.sourceFile)} ${measurement.input.id}`,
        `  input: note=${measurement.input.noteLabel} noteHz=${fixed(measurement.input.noteHz, 2)} velocity=${measurement.input.velocity} requestedGate=${formatSeconds(measurement.input.requestedGateSeconds)}s requestedDuration=${formatSeconds(measurement.input.requestedDurationSeconds)}s`,
        `  measurement: method=${measurement.renderMethod} sampleRate=${measurement.playback.sampleRate}Hz channels=${measurement.playback.channels} masterVolume=${measurement.playback.masterVolume} track=${measurement.playback.track} actualGate=${formatSeconds(measurement.playback.actualGateSeconds)}s`,
        probeLine,
        `  level: peak=${fixed(features.level.peak)} rms=${fixed(features.level.rms)} crest=${fixed(features.level.crestFactor, 2)} transient=${fixed(features.level.transientRms)} body=${fixed(features.level.bodyRms)} tail=${fixed(features.level.tailRms)} tail/body=${fixed(features.level.tailToBodyRatio, 2)}`,
        `  envelope: attack=${features.envelope.attackMs === undefined ? "-" : `${rounded(features.envelope.attackMs)}ms`} decay=${features.envelope.decayMs === undefined ? "-" : `${rounded(features.envelope.decayMs)}ms`} release=${features.envelope.release.status}${features.envelope.release.ms === undefined ? "" : ` ${rounded(features.envelope.release.ms)}ms`} tailDuration=${features.envelope.tailDurationMs === undefined ? "-" : `${rounded(features.envelope.tailDurationMs)}ms`} noteOffDelta=${features.envelope.noteOffSensitivity.deltaDb === undefined ? "-" : `${fixed(features.envelope.noteOffSensitivity.deltaDb, 1)}dB`}`,
        `  ${formatSpectrum("transient spectrum", features.spectrum.transient)}`,
        `  ${formatSpectrum("body spectrum", features.spectrum.body)}`,
        `  ${formatSpectrum("tail spectrum", features.spectrum.tail)}`,
        `  peaks: ${features.spectrum.body.dominantPeaks.map(formatPeak).join("; ") || "-"}`,
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
      for (const renderMethod of options.renderMethods) {
        try {
          results.push(await analyzeFile(file, probe, renderMethod));
        } catch (error) {
          failures += 1;
          console.error(`${file} ${probe.id} ${renderMethod}: ${error instanceof Error ? error.message : error}`);
        }
      }
    }
  }

  if (options.json) {
    const report = { sweep: buildSweepMetadata(options), results };
    const comparisons = buildComparisons(results);
    if (comparisons.length) {
      report.comparisons = comparisons;
    }
    console.log(JSON.stringify(report, null, 2));
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

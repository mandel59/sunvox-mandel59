#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseNote } from "./sunsynth-characterize.mjs";
import {
  DEFAULT_BLOCK_FRAMES,
  DEFAULT_CHANNELS,
  DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
  DEFAULT_SAMPLE_RATE,
  DEFAULT_SLOT as SLOT,
  SunVoxNoteCommands,
  assertSunVoxOk,
  createNoteProbePattern,
  loadProjectFromBuffer,
  loadSynthModuleFromBuffer,
  readCString,
  readMagic,
  renderSlotAudio,
  sunVoxNoteValue,
  withSunVoxSlot,
} from "./sunvox-node.mjs";

const DEFAULT_DURATION_SECONDS = 2;
const DEFAULT_GATE_SECONDS = 0.25;
const DEFAULT_NOTE = 60;
const DEFAULT_VELOCITY = 112;
const DEFAULT_PASSES = 2;
const SILENCE_EPSILON = 1e-7;
const SUPPORTED_EXTENSIONS = new Set([".sunvox", ".sunsynth"]);
const SYNTH_RENDER_MODES = new Set(["event", "pattern", "both"]);
const NOTE_LABELS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

function usage() {
  console.error(`Usage:
  node tools/sunvox-render-debug.mjs [--json] [--mode event|pattern|both] [--note <note|midi>] [--velocity <1..129>] [--event-velocity <1..129>] [--gate <seconds>] [--duration <seconds>] [--passes <count>] <file.sunvox|file.sunsynth> [...]

Examples:
  node tools/sunvox-render-debug.mjs music/2022-04-16.sunvox
  node tools/sunvox-render-debug.mjs --mode both --note C4 --velocity 112 --passes 3 generated/instruments/Scratch\\ FMX\\ Tines.sunsynth`);
}

function parsePositiveNumber(value, label) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive number`);
  }
  return parsed;
}

function parsePositiveInteger(value, label) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`${label} must be a positive integer`);
  }
  return parsed;
}

function parseIntegerRange(value, label, min, max) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    throw new Error(`${label} must be an integer from ${min} to ${max}`);
  }
  return parsed;
}

function parseArgs(argv) {
  const options = {
    json: false,
    note: DEFAULT_NOTE,
    velocity: DEFAULT_VELOCITY,
    gateSeconds: DEFAULT_GATE_SECONDS,
    durationSeconds: DEFAULT_DURATION_SECONDS,
    passes: DEFAULT_PASSES,
    mode: "both",
    files: [],
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--mode") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--mode requires a value");
      }
      if (!SYNTH_RENDER_MODES.has(argv[index])) {
        throw new Error(`--mode must be one of ${Array.from(SYNTH_RENDER_MODES).join(", ")}`);
      }
      options.mode = argv[index];
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
    } else if (arg === "--event-velocity") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--event-velocity requires a value");
      }
      options.eventVelocity = parseIntegerRange(argv[index], "--event-velocity", 1, 129);
    } else if (arg === "--gate") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--gate requires a value");
      }
      options.gateSeconds = parsePositiveNumber(argv[index], "--gate");
    } else if (arg === "--duration") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--duration requires a value");
      }
      options.durationSeconds = parsePositiveNumber(argv[index], "--duration");
    } else if (arg === "--passes") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--passes requires a value");
      }
      options.passes = parsePositiveInteger(argv[index], "--passes");
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.files.push(arg);
    }
  }
  if (options.gateSeconds >= options.durationSeconds) {
    throw new Error("--gate must be shorter than --duration");
  }
  return options;
}

function noteLabel(note) {
  const midiNote = Math.round(note);
  const octave = Math.floor(midiNote / 12) - 1;
  const pitchClass = ((midiNote % 12) + 12) % 12;
  return `${NOTE_LABELS[pitchClass]}${octave}`;
}

function fixed(value, digits = 4) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

export function normalizeEventVelocity(velocity) {
  return Math.max(1, Math.min(129, Math.round(Number(velocity))));
}

function inspectLoadedModules(module, slot = SLOT) {
  const moduleCount = module._sv_get_number_of_modules(slot);
  const modules = [];
  for (let index = 0; index < moduleCount; index += 1) {
    const flags = module._sv_get_module_flags(slot, index);
    modules.push({
      index,
      type: readCString(module, module._sv_get_module_type(slot, index)),
      name: readCString(module, module._sv_get_module_name(slot, index)),
      flags,
    });
  }
  return modules;
}

export function summarizeAudio(samples, channels, epsilon = SILENCE_EPSILON) {
  let peak = 0;
  let sumSquares = 0;
  let nonZeroSamples = 0;
  let firstNonZeroFrame;
  let lastNonZeroFrame;
  const frameCount = Math.floor(samples.length / channels);
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const value = samples[sampleIndex];
    const absolute = Math.abs(value);
    peak = Math.max(peak, absolute);
    sumSquares += value * value;
    if (absolute > epsilon) {
      nonZeroSamples += 1;
      const frame = Math.floor(sampleIndex / channels);
      firstNonZeroFrame ??= frame;
      lastNonZeroFrame = frame;
    }
  }
  return {
    peak,
    rms: samples.length ? Math.sqrt(sumSquares / samples.length) : 0,
    nonZeroSamples,
    nonZeroFrames:
      firstNonZeroFrame === undefined || lastNonZeroFrame === undefined ? 0 : lastNonZeroFrame - firstNonZeroFrame + 1,
    firstNonZeroFrame,
    lastNonZeroFrame,
    leadingSilenceFrames: firstNonZeroFrame ?? frameCount,
  };
}

function renderProject(module, { slot, sampleRate, channels, durationSeconds }) {
  assertSunVoxOk(module._sv_volume(slot, 256), "sv_volume");
  assertSunVoxOk(module._sv_play_from_beginning(slot), "sv_play_from_beginning");
  const rendered = renderSlotAudio(module, {
    slot,
    sampleRate,
    channels,
    durationSeconds,
    blockFrames: DEFAULT_BLOCK_FRAMES,
  });
  assertSunVoxOk(module._sv_stop(slot), "sv_stop");
  return {
    mode: "project-playback",
    pass: 1,
    stats: summarizeAudio(rendered.samples, channels),
  };
}

function renderSynthPatternPass(module, { slot, sampleRate, channels, durationSeconds, pass }) {
  assertSunVoxOk(module._sv_rewind(slot, 0), "sv_rewind");
  assertSunVoxOk(module._sv_play_from_beginning(slot), "sv_play_from_beginning");
  const rendered = renderSlotAudio(module, {
    slot,
    sampleRate,
    channels,
    durationSeconds,
    blockFrames: DEFAULT_BLOCK_FRAMES,
  });
  assertSunVoxOk(module._sv_stop(slot), "sv_stop");
  return {
    mode: "synth-pattern-probe",
    pass,
    stats: summarizeAudio(rendered.samples, channels),
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

function renderSynthEventPass(module, { slot, moduleIndex, sampleRate, channels, note, velocity, gateSeconds, durationSeconds, pass }) {
  const noteValue = sunVoxNoteValue(note);
  const track = 0;
  const gateFrames = Math.round(gateSeconds * sampleRate);
  const gateTicks = Math.floor(gateSeconds * module._sv_get_ticks_per_second());
  const releaseSeconds = Math.max(0, durationSeconds - gateSeconds);
  const baseTicks = module._sv_get_ticks();
  assertSunVoxOk(module._sv_play(slot), "sv_play");
  assertSunVoxOk(module._sv_set_event_t(slot, 1, baseTicks), "sv_set_event_t note on");
  assertSunVoxOk(module._sv_send_event(slot, track, noteValue, velocity, moduleIndex + 1, 0, 0), "sv_send_event note on");
  const gate = renderSlotAudioAtFrame(module, {
    slot,
    sampleRate,
    channels,
    durationSeconds: gateSeconds,
    startFrame: 0,
    baseTicks,
  });
  assertSunVoxOk(module._sv_set_event_t(slot, 1, baseTicks + gateTicks), "sv_set_event_t note off");
  assertSunVoxOk(
    module._sv_send_event(slot, track, SunVoxNoteCommands.noteOff, 0, moduleIndex + 1, 0, 0),
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
  assertSunVoxOk(module._sv_send_event(slot, 0, SunVoxNoteCommands.allNotesOff, 0, 0, 0, 0), "sv_send_event all notes off");
  assertSunVoxOk(module._sv_stop(slot), "sv_stop");
  const rendered = concatRenderedAudio([gate, release], channels, sampleRate);
  return {
    mode: "synth-event-probe",
    pass,
    stats: summarizeAudio(rendered.samples, channels),
  };
}

function synthRenderModes(mode) {
  return mode === "both" ? ["event", "pattern"] : [mode];
}

async function debugFile(file, options) {
  const filePath = resolve(file);
  if (!SUPPORTED_EXTENSIONS.has(extname(filePath).toLowerCase())) {
    throw new Error(`${file} is not a .sunvox or .sunsynth file`);
  }
  const bytes = await readFile(filePath);
  const magic = readMagic(bytes);
  const probe = {
    note: options.note,
    noteLabel: noteLabel(options.note),
    velocity: options.velocity,
    eventVelocity: options.eventVelocity ?? normalizeEventVelocity(options.velocity),
    gateSeconds: options.gateSeconds,
    durationSeconds: options.durationSeconds,
  };

  return withSunVoxSlot(
    {
      sampleRate: DEFAULT_SAMPLE_RATE,
      channels: DEFAULT_CHANNELS,
      flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
      slot: SLOT,
    },
    async ({ module, slot, engineVersion, sampleRate, channels, flags }) => {
      let loadApi;
      let loadResult;
      let moduleIndex;
      let probePattern;
      let passes;
      if (magic === "SVOX") {
        loadApi = "sv_load_from_memory";
        loadResult = loadProjectFromBuffer(module, bytes, { slot });
      } else if (magic === "SSYN") {
        loadApi = "sv_load_module_from_memory";
        moduleIndex = loadSynthModuleFromBuffer(module, bytes, { slot });
        loadResult = moduleIndex;
        assertSunVoxOk(module._sv_volume(slot, 256), "sv_volume");
      } else {
        throw new Error(`Unsupported SunVox container magic: ${magic || "<empty>"}`);
      }
      const modules = inspectLoadedModules(module, slot);
      if (magic === "SVOX") {
        passes = [renderProject(module, { slot, sampleRate, channels, durationSeconds: options.durationSeconds })];
      } else {
        passes = [];
        for (const mode of synthRenderModes(options.mode)) {
          if (mode === "event") {
            passes.push(
              ...Array.from({ length: options.passes }, (_, index) =>
                renderSynthEventPass(module, {
                  slot,
                  moduleIndex,
                  sampleRate,
                  channels,
                  note: probe.note,
                  velocity: probe.eventVelocity,
                  gateSeconds: probe.gateSeconds,
                  durationSeconds: options.durationSeconds,
                  pass: index + 1,
                }),
              ),
            );
          } else {
            probePattern = createNoteProbePattern(module, {
              slot,
              moduleIndex,
              note: probe.note,
              velocity: probe.velocity,
              gateSeconds: probe.gateSeconds,
              sampleRate,
              name: "sunvox-render-debug",
            });
            passes.push(
              ...Array.from({ length: options.passes }, (_, index) =>
                renderSynthPatternPass(module, {
                  slot,
                  sampleRate,
                  channels,
                  durationSeconds: options.durationSeconds,
                  pass: index + 1,
                }),
              ),
            );
          }
        }
      }
      return {
        file: relative(process.cwd(), filePath),
        magic,
        engineVersion,
        init: { sampleRate, channels, flags },
        load: { api: loadApi, result: loadResult },
        ...(moduleIndex !== undefined ? { moduleIndex } : {}),
        modules,
        probe,
        ...(probePattern ? { probePattern } : {}),
        passes,
      };
    },
  );
}

function formatResultRows(results) {
  const rows = [["File", "Mode", "Pass", "Probe", "Load", "Modules", "Peak", "RMS", "NonZero", "LeadSilent"]];
  for (const result of results) {
    for (const pass of result.passes) {
      const eventSuffix =
        pass.mode === "synth-event-probe" && result.probe.eventVelocity !== result.probe.velocity
          ? `/e${result.probe.eventVelocity}`
          : "";
      const probe = result.magic === "SSYN" ? `${result.probe.noteLabel}:${result.probe.velocity}${eventSuffix}` : "-";
      rows.push([
        basename(result.file),
        pass.mode,
        String(pass.pass),
        probe,
        result.load.api,
        String(result.modules.length),
        fixed(pass.stats.peak),
        fixed(pass.stats.rms),
        String(pass.stats.nonZeroFrames),
        String(pass.stats.leadingSilenceFrames),
      ]);
    }
  }
  const widths = rows[0].map((_, column) => Math.max(...rows.map((row) => row[column].length)));
  return rows
    .map((row, rowIndex) => {
      const line = row.map((cell, column) => cell.padEnd(widths[column])).join("  ");
      return rowIndex === 0 ? `${line}\n${widths.map((width) => "-".repeat(width)).join("  ")}` : line;
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
    try {
      results.push(await debugFile(file, options));
    } catch (error) {
      failures += 1;
      console.error(`${file}: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (options.json) {
    console.log(JSON.stringify(results, null, 2));
  } else if (results.length) {
    console.log(formatResultRows(results));
  }
  if (failures > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  await main(process.argv.slice(2));
}

#!/usr/bin/env node
// @ts-check
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildContainer, formatValidationIssue, parseContainer, validateContainer } from "../../../tools/sunvox-codec.mjs";
import { deterministicIconBase64, readSunsynthForMusic } from "../../../tools/sunvox-music-recipe-helpers.mjs";
import {
  DEFAULT_CHANNELS,
  DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
  DEFAULT_SAMPLE_RATE,
  DEFAULT_SLOT,
  assertSunVoxOk,
  loadSynthModuleFromBuffer,
  mallocString,
  readCString,
  loadProjectFromBuffer,
  renderSlotAudio,
  setPatternEvent,
  sunVoxNoteValue,
  withSlotLock,
  withSunVoxSlot,
} from "../../../tools/sunvox-node.mjs";

const OUTPUT_DIR = "generated/music";
const SUMMARY_DIR = "var/music-recipe";
const PROJECT_PATH = `${OUTPUT_DIR}/wa-bgm-sketch.sunvox`;
const SUMMARY_PATH = `${SUMMARY_DIR}/wa-bgm-sketch.summary.json`;
const DETAIL_SUMMARY_PATH = `${SUMMARY_DIR}/wa-bgm-sketch.detail.summary.json`;
const BPM = 92;
const TPL = 6;
const NOTE_COMMANDS = {
  noteOff: 128,
  allNotesOff: 129,
};

const INSTRUMENTS = [
  {
    key: "koto",
    name: "Wa Koto Pluck",
    file: "generated/instruments/Wa Koto Pluck.sunsynth",
    color: "#d7b35f",
    position: { x: 160, y: 256, z: 0 },
    volume: 220,
  },
  {
    key: "shamisen",
    name: "Wa Shamisen Twang",
    file: "generated/instruments/Wa Shamisen Twang.sunsynth",
    color: "#b86c45",
    position: { x: 160, y: 448, z: 0 },
    volume: 212,
  },
  {
    key: "shakuhachi",
    name: "Wa Shakuhachi Breath",
    file: "generated/instruments/Wa Shakuhachi Breath.sunsynth",
    color: "#75a59a",
    position: { x: 160, y: 640, z: 0 },
    volume: 198,
  },
  {
    key: "taiko",
    name: "Wa Taiko Ensemble",
    file: "generated/instruments/Wa Taiko Ensemble.sunsynth",
    color: "#8f3a2f",
    position: { x: 160, y: 832, z: 0 },
    musicRootVolume: 246,
    volume: 232,
  },
];

function rgbToSunVoxColor(value) {
  const match = /^#?([0-9a-f]{6})$/iu.exec(value);
  if (!match) {
    throw new Error(`Invalid RGB color: ${value}`);
  }
  const hex = match[1];
  const r = Number.parseInt(hex.slice(0, 2), 16);
  const g = Number.parseInt(hex.slice(2, 4), 16);
  const b = Number.parseInt(hex.slice(4, 6), 16);
  return r | (g << 8) | (b << 16);
}

function applyDeterministicPatternIcons(document) {
  for (const [index, pattern] of (document.patterns ?? []).entries()) {
    pattern.iconBase64 = deterministicIconBase64(60 + index, index);
  }
}

function projectDocumentFromBuffer(buffer) {
  const document = parseContainer(buffer);
  document.project.bpm = BPM;
  document.project.speed = TPL;
  applyDeterministicPatternIcons(document);
  return document;
}

function noteValue(value) {
  if (typeof value === "number") {
    return value;
  }
  if (NOTE_COMMANDS[value] !== undefined) {
    return NOTE_COMMANDS[value];
  }
  const match = /^([A-G])(#?)(-?\d+)$/u.exec(value);
  if (!match) {
    throw new Error(`Invalid note: ${value}`);
  }
  const pitchClasses = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const pitchClass = pitchClasses.indexOf(`${match[1]}${match[2]}`);
  return sunVoxNoteValue(Number(match[3]) * 12 + pitchClass);
}

function setCString(module, value, callback) {
  const pointer = mallocString(module, value);
  try {
    return callback(pointer);
  } finally {
    module._free(pointer);
  }
}

function setSongName(module, slot, name) {
  return setCString(module, name, (pointer) => assertSunVoxOk(module._sv_set_song_name(slot, pointer), "sv_set_song_name"));
}

function newModule(module, slot, type, name, position) {
  return withSlotLock(module, slot, () =>
    setCString(module, type, (typePointer) =>
      setCString(module, name, (namePointer) =>
        assertSunVoxOk(
          module._sv_new_module(slot, typePointer, namePointer, position.x, position.y, position.z ?? 0),
          `sv_new_module ${name}`,
        ),
      ),
    ),
  );
}

function connect(module, slot, source, destination) {
  return withSlotLock(module, slot, () =>
    assertSunVoxOk(module._sv_connect_module(slot, source, destination), `sv_connect_module ${source}->${destination}`),
  );
}

function setModuleControllers(module, slot, moduleIndex, controllers) {
  for (const [controller, value] of Object.entries(controllers)) {
    assertSunVoxOk(
      module._sv_set_module_ctl_value(slot, moduleIndex, Number(controller), value, 0),
      `sv_set_module_ctl_value #${moduleIndex}.${controller}`,
    );
  }
}

function setProjectTempo(module, slot, { bpm, tpl }) {
  assertSunVoxOk(module._sv_set_event_t(slot, 1, 0), "sv_set_event_t tempo");
  try {
    assertSunVoxOk(module._sv_send_event(slot, 0, 0, 0, 0, 0x0f, tpl), "sv_send_event set TPL");
    assertSunVoxOk(module._sv_send_event(slot, 0, 0, 0, 0, 0x1f, bpm), "sv_send_event set BPM");
  } finally {
    assertSunVoxOk(module._sv_set_event_t(slot, 0, 0), "sv_set_event_t reset");
  }
}

function saveSlotToMemory(module, slot) {
  const sizePointer = module._malloc(16);
  if (!sizePointer) {
    throw new Error("malloc failed for SunVox save size pointer");
  }
  let savedPointer;
  try {
    savedPointer = module._sv_save_to_memory(slot, sizePointer);
    const size = module.HEAP32[sizePointer >> 2];
    if (!savedPointer || size <= 0) {
      throw new Error(`sv_save_to_memory failed with pointer ${savedPointer} and size ${size}`);
    }
    return Buffer.from(module.HEAPU8.subarray(savedPointer, savedPointer + size));
  } finally {
    if (savedPointer) {
      module._free(savedPointer);
    }
    module._free(sizePointer);
  }
}

function audioStats(samples, channels, sampleRate, durationSeconds) {
  let peak = 0;
  let sumSquares = 0;
  let activeSamples = 0;
  for (const sample of samples) {
    const absolute = Math.abs(sample);
    peak = Math.max(peak, absolute);
    sumSquares += sample * sample;
    if (absolute > 1e-7) {
      activeSamples += 1;
    }
  }
  return {
    durationSeconds,
    sampleRate,
    channels,
    peak,
    rms: samples.length ? Math.sqrt(sumSquares / samples.length) : 0,
    activeSamples,
  };
}

function note(events, { line, track, value, module, velocity = 112, gate }) {
  events.push({ line, track, note: value, velocity, module });
  if (gate !== undefined) {
    events.push({ line: line + gate, track, note: "noteOff", module });
  }
}

function addKotoLoop(events, module) {
  const motif = ["D5", "G5", "A5", "C6", "A5", "G5", "D#5", "D5"];
  for (let step = 0; step < 32; step += 1) {
    const line = step * 4;
    note(events, {
      line,
      track: step % 2,
      value: motif[step % motif.length],
      module,
      velocity: step % 4 === 0 ? 116 : 96,
    });
  }

  const pedal = [
    [0, "D4"],
    [16, "G4"],
    [32, "A4"],
    [48, "C5"],
    [64, "A4"],
    [80, "G4"],
    [96, "D#4"],
    [112, "D4"],
  ];
  for (const [line, value] of pedal) {
    note(events, { line, track: 2, value, module, velocity: 82 });
  }
}

function addShamisenAnswer(events, module) {
  const answers = [
    [6, "G4"],
    [10, "A4"],
    [14, "D5"],
    [38, "C5"],
    [42, "A4"],
    [46, "G4"],
    [70, "A4"],
    [74, "C5"],
    [78, "D5"],
    [102, "D#5"],
    [106, "D5"],
    [110, "A4"],
  ];
  for (const [line, value] of answers) {
    note(events, { line, track: 3, value, module, velocity: line % 16 === 14 ? 118 : 104 });
  }
}

function addShakuhachiLine(events, module) {
  for (const phrase of [
    { line: 0, value: "D4", gate: 22, velocity: 86 },
    { line: 32, value: "G4", gate: 18, velocity: 92 },
    { line: 58, value: "A4", gate: 16, velocity: 88 },
    { line: 88, value: "C5", gate: 20, velocity: 94 },
    { line: 116, value: "A4", gate: 10, velocity: 80 },
  ]) {
    note(events, { ...phrase, track: 4, module });
  }
}

function addTaikoPulse(events, module) {
  for (const line of [0, 24, 32, 56, 64, 88, 96, 120]) {
    note(events, { line, track: 5, value: "D2", module, velocity: line % 32 === 0 ? 122 : 106 });
  }
  for (const line of [14, 30, 46, 62, 76, 94, 110, 126]) {
    note(events, { line, track: 6, value: "A3", module, velocity: line % 32 === 30 ? 112 : 92 });
  }
}

function buildLoopPattern(moduleIndexes) {
  const events = [];
  addKotoLoop(events, moduleIndexes.koto);
  addShamisenAnswer(events, moduleIndexes.shamisen);
  addShakuhachiLine(events, moduleIndexes.shakuhachi);
  addTaikoPulse(events, moduleIndexes.taiko);
  return {
    name: "Wa Loop - in-sen call response",
    position: { x: 0, y: 0, z: 0 },
    lines: 128,
    tracks: 7,
    foreground: "#332818",
    background: "#ead19a",
    events,
  };
}

function buildStingerPattern(moduleIndexes) {
  const events = [];
  for (const [line, value, velocity] of [
    [0, "D5", 122],
    [2, "D#5", 82],
    [4, "G5", 112],
    [8, "A5", 118],
    [12, "C6", 116],
    [16, "A5", 106],
    [20, "G5", 100],
    [24, "D5", 124],
  ]) {
    note(events, { line, track: 0, value, module: moduleIndexes.koto, velocity });
  }
  for (const [line, value] of [
    [3, "D4"],
    [7, "G4"],
    [11, "A4"],
    [15, "D5"],
    [23, "C5"],
    [27, "D5"],
  ]) {
    note(events, { line, track: 1, value, module: moduleIndexes.shamisen, velocity: 112 });
  }
  note(events, { line: 0, track: 2, value: "D4", module: moduleIndexes.shakuhachi, velocity: 90, gate: 28 });
  for (const line of [0, 8, 16, 24, 28]) {
    note(events, { line, track: 3, value: "D2", module: moduleIndexes.taiko, velocity: line === 28 ? 126 : 112 });
  }
  for (const line of [6, 14, 22, 30]) {
    note(events, { line, track: 4, value: "A3", module: moduleIndexes.taiko, velocity: 96 });
  }
  return {
    name: "Wa Stinger - taiko close",
    position: { x: 0, y: 160, z: 0 },
    lines: 32,
    tracks: 5,
    foreground: "#f4ead1",
    background: "#77392f",
    events,
  };
}

function createPatternWithEvents(module, slot, pattern) {
  const patternIndex = setCString(module, pattern.name, (namePointer) =>
    withSlotLock(module, slot, () =>
      assertSunVoxOk(
        module._sv_new_pattern(
          slot,
          -1,
          pattern.position.x,
          pattern.position.y,
          pattern.tracks,
          pattern.lines,
          pattern.iconSeed ?? 0,
          namePointer,
        ),
        `sv_new_pattern ${pattern.name}`,
      ),
    ),
  );
  for (const event of pattern.events) {
    setPatternEvent(module, {
      slot,
      patternIndex,
      track: event.track,
      line: event.line,
      note: noteValue(event.note),
      velocity: event.velocity ?? 0,
      moduleNumber: event.module + 1,
      controller: 0,
      value: 0,
    });
  }
  return patternIndex;
}

function removeInitialPatterns(module, slot) {
  for (let index = module._sv_get_number_of_patterns(slot) - 1; index >= 0; index -= 1) {
    const hasPattern =
      module._sv_get_pattern_tracks(slot, index) > 0 ||
      module._sv_get_pattern_lines(slot, index) > 0 ||
      Boolean(readCString(module, module._sv_get_pattern_name(slot, index)));
    if (hasPattern) {
      withSlotLock(module, slot, () =>
        assertSunVoxOk(module._sv_remove_pattern(slot, index), `sv_remove_pattern ${index}`),
      );
    }
  }
}

async function buildRuntimeProject() {
  const instrumentBytes = await Promise.all(
    INSTRUMENTS.map((instrument) => readSunsynthForMusic(instrument.file, { rootVolume: instrument.musicRootVolume })),
  );
  return withSunVoxSlot(
    {
      sampleRate: DEFAULT_SAMPLE_RATE,
      channels: DEFAULT_CHANNELS,
      flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
      slot: DEFAULT_SLOT,
    },
    async ({ module, slot, sampleRate, channels }) => {
      setSongName(module, slot, "Issue 32 Wa BGM Sketch");
      removeInitialPatterns(module, slot);
      const moduleIndexes = {};
      for (const [index, instrument] of INSTRUMENTS.entries()) {
        const moduleIndex = loadSynthModuleFromBuffer(module, instrumentBytes[index], {
          slot,
          x: instrument.position.x,
          y: instrument.position.y,
          z: instrument.position.z,
          connectToOutput: false,
        });
        moduleIndexes[instrument.key] = moduleIndex;
        assertSunVoxOk(module._sv_set_module_color(slot, moduleIndex, rgbToSunVoxColor(instrument.color)), "sv_set_module_color");
        assertSunVoxOk(module._sv_set_module_ctl_value(slot, moduleIndex, 0, instrument.volume, 0), "set instrument volume");
      }

      const echoIndex = newModule(module, slot, "Echo", "Wa Shared Echo", { x: 496, y: 344, z: 0 });
      assertSunVoxOk(module._sv_set_module_color(slot, echoIndex, rgbToSunVoxColor("#c3a66b")), "echo color");
      setModuleControllers(module, slot, echoIndex, {
        0: 0,
        1: 78,
        2: 92,
        3: 3,
        4: 1,
        5: 6,
        6: 22000,
        7: 1,
        8: 5600,
      });

      const reverbIndex = newModule(module, slot, "Reverb", "Wa Room", { x: 496, y: 672, z: 0 });
      assertSunVoxOk(module._sv_set_module_color(slot, reverbIndex, rgbToSunVoxColor("#8fb9ad")), "reverb color");
      setModuleControllers(module, slot, reverbIndex, {
        0: 0,
        1: 92,
        2: 122,
        3: 160,
        4: 220,
        6: 0,
        8: 22,
        9: 59,
      });

      const busIndex = newModule(module, slot, "Compressor", "Wa Bus", { x: 792, y: 512, z: 0 });
      assertSunVoxOk(module._sv_set_module_color(slot, busIndex, rgbToSunVoxColor("#d8d8d8")), "bus color");
      setModuleControllers(module, slot, busIndex, {
        0: 178,
        1: 246,
        2: 86,
        3: 2,
        4: 220,
        5: 0,
      });

      connect(module, slot, moduleIndexes.koto, echoIndex);
      connect(module, slot, moduleIndexes.shamisen, echoIndex);
      connect(module, slot, moduleIndexes.koto, reverbIndex);
      connect(module, slot, moduleIndexes.shakuhachi, reverbIndex);
      connect(module, slot, moduleIndexes.taiko, reverbIndex);
      connect(module, slot, moduleIndexes.koto, busIndex);
      connect(module, slot, moduleIndexes.shamisen, busIndex);
      connect(module, slot, moduleIndexes.shakuhachi, busIndex);
      connect(module, slot, moduleIndexes.taiko, busIndex);
      connect(module, slot, echoIndex, busIndex);
      connect(module, slot, reverbIndex, busIndex);
      connect(module, slot, busIndex, 0);

      const patterns = [buildLoopPattern(moduleIndexes), buildStingerPattern(moduleIndexes)];
      for (const pattern of patterns) {
        createPatternWithEvents(module, slot, pattern);
      }

      setProjectTempo(module, slot, { bpm: BPM, tpl: TPL });
      assertSunVoxOk(module._sv_volume(slot, 256), "sv_volume");
      assertSunVoxOk(module._sv_play_from_beginning(slot), "sv_play_from_beginning");
      const rendered = renderSlotAudio(module, {
        slot,
        sampleRate,
        channels,
        durationSeconds: 12,
      });
      assertSunVoxOk(module._sv_stop(slot), "sv_stop");
      const buffer = saveSlotToMemory(module, slot);
      const modules = Array.from({ length: module._sv_get_number_of_modules(slot) }, (_, index) => ({
        index,
        type: readCString(module, module._sv_get_module_type(slot, index)),
        name: readCString(module, module._sv_get_module_name(slot, index)),
      }));
      const runtimePatterns = Array.from({ length: module._sv_get_number_of_patterns(slot) }, (_, index) => ({
        index,
        name: readCString(module, module._sv_get_pattern_name(slot, index)),
        tracks: module._sv_get_pattern_tracks(slot, index),
        lines: module._sv_get_pattern_lines(slot, index),
      })).filter((pattern) => pattern.tracks > 0 || pattern.lines > 0 || pattern.name);
      return {
        buffer,
        render: audioStats(rendered.samples, channels, sampleRate, 12),
        runtime: {
          modules,
          patterns: runtimePatterns,
          bpm: module._sv_get_song_bpm(slot),
          tpl: module._sv_get_song_tpl(slot),
        },
      };
    },
  );
}

async function renderSavedProjectStats(buffer, durationSeconds = 12) {
  return withSunVoxSlot(
    {
      sampleRate: DEFAULT_SAMPLE_RATE,
      channels: DEFAULT_CHANNELS,
      flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
      slot: DEFAULT_SLOT,
    },
    async ({ module, slot, sampleRate, channels }) => {
      loadProjectFromBuffer(module, buffer, { slot });
      assertSunVoxOk(module._sv_volume(slot, 256), "sv_volume");
      assertSunVoxOk(module._sv_play_from_beginning(slot), "sv_play_from_beginning");
      const rendered = renderSlotAudio(module, {
        slot,
        sampleRate,
        channels,
        durationSeconds,
      });
      assertSunVoxOk(module._sv_stop(slot), "sv_stop");
      return audioStats(rendered.samples, channels, sampleRate, durationSeconds);
    },
  );
}

export async function buildWaBgmDocument() {
  const built = await buildRuntimeProject();
  return projectDocumentFromBuffer(built.buffer);
}

/** @satisfies {import("../../../tools/sunvox-music-recipe.d.ts").SunVoxMusicRecipe} */
export const recipe = {
  schemaVersion: 1,
  tags: ["research:japanese-bgm", "research:generated-music"],
  issue: 38,
  outputs: {
    waBgmSketch: {
      file: PROJECT_PATH,
      title: "Wa BGM Sketch",
      summaryFile: SUMMARY_PATH,
      buildDocument: buildWaBgmDocument,
    },
  },
};

export default recipe;

export async function runJapaneseBgmExperiment() {
  const built = await buildRuntimeProject();
  const document = projectDocumentFromBuffer(built.buffer);
  const validation = validateContainer(document);
  if (!validation.ok) {
    throw new Error(validation.issues.map(formatValidationIssue).join("\n"));
  }
  const buffer = buildContainer(document);
  await mkdir(dirname(PROJECT_PATH), { recursive: true });
  await writeFile(PROJECT_PATH, buffer);
  const render = await renderSavedProjectStats(buffer);
  const summary = {
    tag: "research:japanese-bgm",
    issue: 32,
    workaroundForIssue: 33,
    generatedAt: new Date().toISOString(),
    commands: [
      "npm run sunvox:edit-recipe -- generated/recipes/sunvox-edit/wa-instruments.mjs",
      "npm run sunvox:music-recipe -- generated/recipes/music/wa-bgm-sketch.mjs",
      "npm run sunvox:outline -- --events 12 generated/music/wa-bgm-sketch.sunvox",
      "npm run sunvox:render-debug -- --duration 12 generated/music/wa-bgm-sketch.sunvox",
    ],
    outputs: {
      project: PROJECT_PATH,
      summary: DETAIL_SUMMARY_PATH,
      instruments: INSTRUMENTS.map((instrument) => instrument.file),
    },
    palette: {
      instruments: INSTRUMENTS.map(({ key, name, file }) => ({ key, name, file })),
      scale: "D in-sen / hirajoshi-adjacent: D, D#, G, A, C",
      effects: ["per-instrument body filters", "shared echo", "shared room reverb", "bus compressor"],
      requestedBpm: BPM,
      requestedTpl: TPL,
      runtimeBpm: built.runtime.bpm,
      runtimeTpl: built.runtime.tpl,
    },
    ideas: [
      "Koto uses an FMX pluck plus a short violet-noise nail click.",
      "Shamisen uses a square/saw pair through light saturation for bachi attack.",
      "Shakuhachi uses hsin tone, pink breath noise, Vocal filter, and slow vibrato.",
      "Taiko layers Kicker body, skin noise, rim click, saturation, and a short room.",
      "The loop leaves visible gaps for ma instead of filling every subdivision.",
      "The stinger reuses the same scale and closes with denser taiko hits.",
    ],
    validation: {
      ok: validation.ok,
      issues: validation.issues.map(formatValidationIssue),
    },
    runtime: built.runtime,
    render,
  };
  await mkdir(dirname(DETAIL_SUMMARY_PATH), { recursive: true });
  await writeFile(DETAIL_SUMMARY_PATH, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  return summary;
}

async function main() {
  const summary = await runJapaneseBgmExperiment();
  console.log(JSON.stringify(summary, null, 2));
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  await main();
}

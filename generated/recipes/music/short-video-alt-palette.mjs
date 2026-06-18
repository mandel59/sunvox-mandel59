import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  DEFAULT_BLOCK_FRAMES,
  DEFAULT_CHANNELS,
  DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
  DEFAULT_SAMPLE_RATE,
  SunVoxNoteCommands,
  assertSunVoxOk,
  createPattern,
  loadProjectFromBuffer,
  loadSynthModuleFromBuffer,
  mallocString,
  renderSlotAudio,
  setPatternEvent,
  sunVoxNoteValue,
  withSlotLock,
  withSunVoxSlot,
} from "../../../tools/sunvox-node.mjs";
import { SUNVOX_DB, buildContainer, parseContainer } from "../../../tools/sunvox-codec.mjs";
import {
  deterministicIconBase64,
  readSunsynthForMusic,
  summarizeMomentaryLufs,
} from "../../../tools/sunvox-music-recipe-helpers.mjs";

const OUTPUT_DIR = "generated/music";
const SUMMARY_DIR = "var/music-recipe";
const OUTPUT_INDEX_PATH = join(SUMMARY_DIR, "short-video-alt-palette.summary.json");
const CHANNELS = DEFAULT_CHANNELS;
const SAMPLE_RATE = DEFAULT_SAMPLE_RATE;
const LINES = 128;
const TRACKS = 14;
const RENDER_SECONDS = 16;
const VELOCITY = 104;
const OUTPUT_MODULE = 0;

const sourceModules = [
  {
    id: "subKick",
    moduleName: "Alt Kicker Sub",
    type: "Kicker",
    create: true,
    controllers: {
      volume: 34,
      waveform: 2,
      panning: 128,
      attack: 0,
      release: 28,
      boost: 250,
      acceleration: 300,
      polyphony: 1,
      noClick: 0,
    },
  },
  {
    id: "drums",
    moduleName: "Alt DrumSynth Bits",
    type: "DrumSynth",
    create: true,
    controllers: {
      volume: 190,
      panning: 128,
      polyphony: 8,
      bassVolume: 72,
      bassPower: 180,
      bassTone: 54,
      bassLength: 46,
      hihatVolume: 260,
      hihatLength: 34,
      snareVolume: 180,
      snareTone: 164,
      snareLength: 42,
      bassPan: 128,
      hihatPan: 176,
      snarePan: 106,
    },
  },
  {
    id: "bass",
    moduleName: "Scratch FMX Bass",
    type: "FMX",
    path: "generated/instruments/Scratch FMX Bass.sunsynth",
    controllers: { volume: 24000, panning: 128 },
  },
  {
    id: "analog",
    moduleName: "Scratch Analog",
    type: "MetaModule",
    path: "generated/instruments/Scratch Analog.sunsynth",
    musicRootVolume: 256,
    controllers: { volume: 540 },
  },
  {
    id: "bell",
    moduleName: "Scratch FMX Bell",
    type: "FMX",
    path: "generated/instruments/Scratch FMX Bell.sunsynth",
    controllers: { volume: 17200, panning: 166 },
  },
  {
    id: "supersaw",
    moduleName: "SuperSaw",
    type: "MetaModule",
    path: "instruments/mandel59 SuperSaw.sunsynth",
    controllers: { volume: 620 },
  },
  {
    id: "shepard",
    moduleName: "Shepard tone",
    type: "MetaModule",
    path: "instruments/mandel59 shepard.sunsynth",
    controllers: { volume: 280 },
  },
  {
    id: "noise",
    moduleName: "Alt Violet Noise",
    type: "Analog generator",
    create: true,
    controllers: {
      volume: 80,
      waveform: 14,
      panning: 92,
      attack: 0,
      release: 74,
      sustain: 0,
      expEnvelope: 1,
      dutyCycle: 512,
      osc2Pitch: 1000,
      filter: 3,
      filterFreq: 7600,
      filterResonance: 420,
      filterExpFreq: 1,
      filterAttack: 4,
      filterRelease: 96,
      filterEnvelope: 1,
      polyphony: 4,
      mode: 0,
      noise: 184,
      osc2Volume: 0,
      osc2Mode: 0,
      osc2Phase: 0,
    },
  },
];

const effectModules = [
  {
    id: "kickDrive",
    type: "Distortion",
    name: "Alt Kick Soft Drive",
    controllers: { volume: 110, type: 8, power: 32, bitDepth: 16, freq: 44100, noise: 0 },
  },
  {
    id: "kickTrim",
    type: "Amplifier",
    name: "Alt Kick Mono Trim",
    controllers: { volume: 176, balance: 128, stereoWidth: 64, fineVolume: 32768 },
  },
  {
    id: "drumHp",
    type: "Filter Pro",
    name: "Alt Drum Crisp HP",
    controllers: {
      volume: 32768,
      type: 1,
      freq: 1450,
      freqFinetune: 1000,
      freqScale: 100,
      expFreq: 1,
      q: 7800,
      gain: 16384,
      rolloff: 1,
      response: 180,
      mode: 0,
      mix: 32768,
      lfoFreq: 8,
      lfoAmp: 0,
      lfoWaveform: 0,
      setLfoPhase: 0,
      lfoFreqUnit: 0,
    },
  },
  {
    id: "drumCrush",
    type: "Distortion",
    name: "Alt Drum Bit Edge",
    controllers: { volume: 180, type: 0, power: 22, bitDepth: 11, freq: 18000, noise: 2 },
  },
  {
    id: "bassDrive",
    type: "Distortion",
    name: "Alt Bass Saturation",
    controllers: { volume: 182, type: 10, power: 48, bitDepth: 16, freq: 44100, noise: 0 },
  },
  {
    id: "bassFilter",
    type: "Filter Pro",
    name: "Alt Bass Moving LP",
    controllers: {
      volume: 32768,
      type: 0,
      freq: 4800,
      freqFinetune: 1000,
      freqScale: 100,
      expFreq: 1,
      q: 13200,
      gain: 16384,
      rolloff: 2,
      response: 210,
      mode: 0,
      mix: 32768,
      lfoFreq: 16,
      lfoAmp: 1800,
      lfoWaveform: 1,
      setLfoPhase: 0,
      lfoFreqUnit: 4,
    },
  },
  {
    id: "bassTrim",
    type: "Amplifier",
    name: "Alt Bass Center Trim",
    controllers: { volume: 260, balance: 128, stereoWidth: 76, fineVolume: 32768 },
  },
  {
    id: "leadEcho",
    type: "Echo",
    name: "Alt Lead Line Echo",
    controllers: {
      dry: 256,
      wet: 46,
      feedback: 108,
      delay: 3,
      rightChannelOffset: 1,
      delayUnit: 4,
      rightChannelOffsetValue: 17600,
      filter: 1,
      filterFreq: 6200,
    },
  },
  {
    id: "bellEcho",
    type: "Echo",
    name: "Alt Bell Ping Echo",
    controllers: {
      dry: 256,
      wet: 58,
      feedback: 92,
      delay: 6,
      rightChannelOffset: 1,
      delayUnit: 4,
      rightChannelOffsetValue: 18400,
      filter: 0,
      filterFreq: 8600,
    },
  },
  {
    id: "padFilter",
    type: "Filter Pro",
    name: "Alt Pad LFO Filter",
    controllers: {
      volume: 32768,
      type: 0,
      freq: 7200,
      freqFinetune: 1000,
      freqScale: 100,
      expFreq: 1,
      q: 7200,
      gain: 16384,
      rolloff: 1,
      response: 260,
      mode: 0,
      mix: 32768,
      lfoFreq: 32,
      lfoAmp: 2400,
      lfoWaveform: 2,
      setLfoPhase: 0,
      lfoFreqUnit: 4,
    },
  },
  {
    id: "formantBus",
    type: "Vocal filter",
    name: "Alt Formant Color Bus",
    controllers: {
      volume: 300,
      formantWidth: 88,
      intensity: 58,
      formants: 3,
      vowelPosition: 118,
      voiceType: 1,
      channels: 0,
      randomFrequency: 12,
      randomSeed: 17,
      vowel1: 0,
      vowel2: 3,
      vowel3: 4,
      vowel4: 1,
      vowel5: 2,
    },
  },
  {
    id: "musicBus",
    type: "Amplifier",
    name: "Alt Music Wide Bus",
    controllers: { volume: 330, balance: 128, stereoWidth: 256, fineVolume: 32768 },
  },
  {
    id: "musicEcho",
    type: "Echo",
    name: "Alt Music Tape Echo",
    controllers: {
      dry: 256,
      wet: 42,
      feedback: 84,
      delay: 5,
      rightChannelOffset: 1,
      delayUnit: 4,
      rightChannelOffsetValue: 19600,
      filter: 1,
      filterFreq: 5200,
    },
  },
  {
    id: "masterGlue",
    type: "Compressor",
    name: "Alt Master Fast Glue",
    controllers: { volume: 360, threshold: 318, slope: 92, attack: 4, release: 250, mode: 0, sideChainInput: 0 },
  },
];

const mixConnections = [
  ["subKick", "kickDrive"],
  ["kickDrive", "kickTrim"],
  ["kickTrim", "masterGlue"],
  ["drums", "drumHp"],
  ["drumHp", "drumCrush"],
  ["drumCrush", "masterGlue"],
  ["bass", "bassDrive"],
  ["bassDrive", "bassFilter"],
  ["bassFilter", "bassTrim"],
  ["bassTrim", "masterGlue"],
  ["analog", "leadEcho"],
  ["leadEcho", "formantBus"],
  ["shepard", "formantBus"],
  ["formantBus", "musicBus"],
  ["bell", "bellEcho"],
  ["bellEcho", "musicBus"],
  ["supersaw", "padFilter"],
  ["padFilter", "musicBus"],
  ["noise", "musicBus"],
  ["musicBus", "musicEcho"],
  ["musicEcho", "masterGlue"],
  ["masterGlue", "output"],
];

const themes = Object.freeze([
  {
    id: "alt-shepard-chip-bumper",
    title: "Alt Shepard Chip Bumper",
    songName: "Short BGM Alt Palette - Shepard Chip Bumper",
    patternName: "15s alt shepard chip bumper",
    bpm: 132,
    iconSeed: 40,
    concept: "chip-like bumper using Kicker, DrumSynth, Shepard tone, SuperSaw, Analog, and filtered Echo",
    arrangement: [
      "Kicker and DrumSynth replace the earlier sampled kick layer",
      "Shepard tone answers the first second instead of glass bell identity",
      "Scratch Analog carries a narrow chip lead through Echo and a light formant color bus",
      "SuperSaw is gated into short chords instead of a sustained layered pad",
      "FMX Bass runs through Distortion and a moving Filter Pro insert",
      "No Reverb or Delay module is used; space is Echo plus Filter Pro LFO movement",
    ],
    buildArrangement: addShepardChipBumper,
  },
  {
    id: "alt-filter-bass-run",
    title: "Alt Filter Bass Run",
    songName: "Short BGM Alt Palette - Filter Bass Run",
    patternName: "15s alt filter bass run",
    bpm: 140,
    iconSeed: 41,
    concept: "high-energy edit cue centered on an FMX bass run and automated filter/formant movement",
    arrangement: [
      "Four-on-the-floor Kicker with DrumSynth hats and snaps",
      "FMX Bass receives extra Distortion and pattern-driven Filter Pro frequency changes",
      "Scratch Analog lead uses Echo instead of the earlier FMX pluck/tines pair",
      "Shepard and SuperSaw appear as transition color rather than main bed",
      "Vocal filter is used as a synthetic formant effect, not as a vocal sample",
      "The loop resolves with a bass pickup back to the opening note",
    ],
    sourceControllers: {
      subKick: { volume: 32 },
      drums: { volume: 210 },
      bass: { volume: 26000 },
      analog: { volume: 560 },
      bell: { volume: 19000 },
      supersaw: { volume: 500 },
      shepard: { volume: 220 },
      noise: { volume: 70 },
    },
    effectControllers: {
      bassDrive: { power: 62, volume: 190 },
      bassFilter: { freq: 3600, q: 15000, lfoAmp: 2600 },
      leadEcho: { wet: 36, feedback: 84 },
      formantBus: { intensity: 70, vowelPosition: 92 },
      musicEcho: { wet: 34, feedback: 74 },
      masterGlue: { threshold: 306, slope: 84 },
    },
    buildArrangement: addFilterBassRun,
  },
  {
    id: "alt-soft-formant-bed",
    title: "Alt Soft Formant Bed",
    songName: "Short BGM Alt Palette - Soft Formant Bed",
    patternName: "15s alt soft formant bed",
    bpm: 112,
    iconSeed: 42,
    concept: "calmer tutorial bed with sparse synthetic percussion, Shepard tone, SuperSaw, and gentle formant color",
    arrangement: [
      "Kicker is sparse and DrumSynth is mostly hats, leaving room for narration",
      "Shepard tone and SuperSaw form the identity bed instead of layered pad and organ",
      "FMX Bell is a sparse marker rather than the main hook",
      "Scratch Analog supplies small texture notes through Echo",
      "The formant bus is softened and widened so it reads as color, not a vocal line",
      "Filtered violet noise only appears at the final turn for loop motion",
    ],
    sourceControllers: {
      subKick: { volume: 18 },
      drums: { volume: 130 },
      bass: { volume: 19000 },
      analog: { volume: 440 },
      bell: { volume: 14000 },
      supersaw: { volume: 900 },
      shepard: { volume: 420 },
      noise: { volume: 50 },
    },
    effectControllers: {
      bassDrive: { power: 24, volume: 116 },
      bassFilter: { freq: 5400, q: 9800, lfoAmp: 900 },
      leadEcho: { wet: 62, feedback: 118 },
      bellEcho: { wet: 68, feedback: 112 },
      padFilter: { freq: 6400, lfoAmp: 1200 },
      formantBus: { intensity: 32, formantWidth: 120, vowelPosition: 148, volume: 200 },
      musicEcho: { wet: 54, feedback: 96 },
      masterGlue: { volume: 512, threshold: 336, slope: 104 },
    },
    buildArrangement: addSoftFormantBed,
  },
]);

const layoutColumns = Object.freeze({
  source: 0,
  insert: 1,
  insert2: 2,
  bus: 3,
  echo: 4,
  master: 5,
  output: 6,
});

const layoutSettings = Object.freeze({
  left: 224,
  columnGap: 230,
  top: 192,
  rowGap: 96,
});

const sourceLanes = Object.freeze(["subKick", "drums", "bass", "analog", "bell", "supersaw", "shepard", "noise"]);

const effectLayout = Object.freeze({
  kickDrive: { column: "insert", source: "subKick" },
  kickTrim: { column: "insert2", source: "subKick" },
  drumHp: { column: "insert", source: "drums" },
  drumCrush: { column: "insert2", source: "drums" },
  bassDrive: { column: "insert", source: "bass" },
  bassFilter: { column: "insert2", source: "bass" },
  bassTrim: { column: "bus", source: "bass" },
  leadEcho: { column: "insert", source: "analog" },
  bellEcho: { column: "insert", source: "bell" },
  padFilter: { column: "insert", source: "supersaw" },
  formantBus: { column: "insert2", sources: ["analog", "shepard"] },
  musicBus: { column: "bus", sources: ["analog", "bell", "supersaw", "shepard", "noise"] },
  musicEcho: { column: "echo", sources: ["analog", "bell", "supersaw", "shepard", "noise"] },
  masterGlue: { column: "master", sources: ["subKick", "drums", "bass", "analog", "bell", "supersaw", "shepard", "noise"] },
});

const NOTE = Object.freeze({
  c1: 24,
  d1: 26,
  eb1: 27,
  f1: 29,
  g1: 31,
  bb1: 34,
  c2: 36,
  d2: 38,
  eb2: 39,
  f2: 41,
  g2: 43,
  bb2: 46,
  c3: 48,
  d3: 50,
  eb3: 51,
  f3: 53,
  g3: 55,
  bb3: 58,
  c4: 60,
  d4: 62,
  eb4: 63,
  f4: 65,
  g4: 67,
  bb4: 70,
  c5: 72,
  d5: 74,
  eb5: 75,
  f5: 77,
  g5: 79,
  bb5: 82,
  c6: 84,
});

function outputPathForTheme(theme) {
  return join(OUTPUT_DIR, `${theme.id}.sunvox`);
}

function summaryPathForTheme(theme) {
  return join(SUMMARY_DIR, `${theme.id}.summary.json`);
}

function controllerIndex(type, name) {
  const index = SUNVOX_DB.modules[type]?.controllers?.find((controller) => controller.name === name)?.index;
  if (!Number.isInteger(index)) {
    throw new Error(`Missing controller ${type}.${name}`);
  }
  return index;
}

function specsForTheme(specs, overrides = {}) {
  return specs.map((spec) => ({
    ...spec,
    controllers: {
      ...spec.controllers,
      ...overrides[spec.id],
    },
  }));
}

function sourceVolumeMap(sources) {
  return Object.fromEntries(sources.map((source) => [source.id, source.controllers.volume]));
}

function setSongName(module, slot, name) {
  const pointer = mallocString(module, name);
  try {
    assertSunVoxOk(module._sv_set_song_name(slot, pointer), "sv_set_song_name");
  } finally {
    module._free(pointer);
  }
}

function saveSlotToMemory(module, slot) {
  const sizePointer = module._malloc(16);
  if (!sizePointer) {
    throw new Error("sv_save_to_memory size malloc failed");
  }
  try {
    const dataPointer = module._sv_save_to_memory(slot, sizePointer);
    const size = module.getValue(sizePointer, "i32");
    if (!dataPointer || !size) {
      throw new Error(`sv_save_to_memory returned pointer=${dataPointer} size=${size}`);
    }
    try {
      return Buffer.from(module.HEAPU8.subarray(dataPointer, dataPointer + size));
    } finally {
      module._free(dataPointer);
    }
  } finally {
    module._free(sizePointer);
  }
}

function createModule(module, slot, { type, name, x, y, z = 0 }) {
  const typePointer = mallocString(module, type);
  const namePointer = mallocString(module, name);
  try {
    return withSlotLock(module, slot, () =>
      assertSunVoxOk(module._sv_new_module(slot, typePointer, namePointer, x, y, z), `sv_new_module ${name}`),
    );
  } finally {
    module._free(namePointer);
    module._free(typePointer);
  }
}

function connectModules(module, slot, source, destination, label) {
  return withSlotLock(module, slot, () =>
    assertSunVoxOk(module._sv_connect_module(slot, source, destination), `sv_connect_module ${label}`),
  );
}

function setModuleControllers(module, slot, moduleIndex, type, controllers) {
  for (const [name, value] of Object.entries(controllers)) {
    assertSunVoxOk(
      module._sv_set_module_ctl_value(slot, moduleIndex, controllerIndex(type, name), value, 0),
      `${type}.${name} controller`,
    );
  }
}

function layoutColumn(name) {
  return layoutSettings.left + layoutColumns[name] * layoutSettings.columnGap;
}

function sourceLaneY(sourceId) {
  const index = sourceLanes.indexOf(sourceId);
  if (index < 0) {
    throw new Error(`Missing layout lane for source ${sourceId}`);
  }
  return layoutSettings.top + index * layoutSettings.rowGap;
}

function averageY(sourceIds) {
  return Math.round(sourceIds.reduce((sum, sourceId) => sum + sourceLaneY(sourceId), 0) / sourceIds.length);
}

function withZ(position) {
  return { x: position.x, y: position.y, z: position.z ?? 0 };
}

function applyDeterministicPatternIcons(document, theme) {
  if (document.patterns[0]) {
    document.patterns[0].iconBase64 = deterministicIconBase64(theme.iconSeed, 0);
  }
  const themePattern = document.patterns.find((pattern) => pattern.name === theme.patternName);
  if (themePattern) {
    themePattern.iconBase64 = deterministicIconBase64(theme.iconSeed, 1);
  }
}

function computeNodeLayout() {
  const sources = Object.fromEntries(
    sourceModules.map((source) => [
      source.id,
      { x: layoutColumn("source"), y: sourceLaneY(source.id), z: 0 },
    ]),
  );

  const effects = {};
  for (const [effectId, placement] of Object.entries(effectLayout)) {
    const y = placement.source ? sourceLaneY(placement.source) : averageY(placement.sources);
    effects[effectId] = { x: layoutColumn(placement.column), y, z: 0 };
  }

  return {
    columns: layoutColumns,
    settings: layoutSettings,
    sources,
    effects,
    output: { x: layoutColumn("output"), y: effects.masterGlue.y, z: 0 },
  };
}

function applySavedLayout(document, layout, sources, effects) {
  const outputModule = document.modules[OUTPUT_MODULE];
  if (!outputModule) {
    throw new Error("Missing output module for layout");
  }
  outputModule.position = withZ(layout.output);

  for (const source of sources) {
    const savedModule = document.modules.find((entry) => entry.name === source.moduleName);
    if (!savedModule) {
      throw new Error(`Could not find source module for layout ${source.id}`);
    }
    savedModule.position = withZ(layout.sources[source.id]);
  }

  for (const effect of effects) {
    const savedModule = document.modules.find((entry) => entry.name === effect.name);
    if (!savedModule) {
      throw new Error(`Could not find effect module for layout ${effect.id}`);
    }
    savedModule.position = withZ(layout.effects[effect.id]);
  }
}

function applySavedControllers(document, sources, effects) {
  for (const spec of [...sources, ...effects]) {
    const savedModule = document.modules.find((entry) => entry.name === (spec.moduleName ?? spec.name));
    if (!savedModule?.controllers || Array.isArray(savedModule.controllers)) {
      throw new Error(`Could not find controllers for ${spec.id}`);
    }
    Object.assign(savedModule.controllers, spec.controllers);
  }
}

function note(module, slot, patternIndex, { line, track, midi, instrument, velocity = VELOCITY, length = 4 }) {
  if (line < 0 || line >= LINES) {
    return;
  }
  setPatternEvent(module, {
    slot,
    patternIndex,
    line,
    track,
    note: sunVoxNoteValue(midi),
    velocity,
    moduleNumber: instrument + 1,
  });
  if (length > 0 && line + length < LINES) {
    setPatternEvent(module, {
      slot,
      patternIndex,
      line: line + length,
      track,
      note: SunVoxNoteCommands.noteOff,
      moduleNumber: instrument + 1,
    });
  }
}

function controllerEvent(module, slot, patternIndex, { line, track, moduleIndex, type, controller, value }) {
  setPatternEvent(module, {
    slot,
    patternIndex,
    line,
    track,
    moduleNumber: moduleIndex + 1,
    controller: (controllerIndex(type, controller) + 1) << 8,
    value,
  });
}

function chord(module, slot, patternIndex, { line, startTrack, notes, instrument, velocity = VELOCITY, length = 8 }) {
  notes.forEach((midi, offset) => {
    note(module, slot, patternIndex, {
      line,
      track: startTrack + offset,
      midi,
      instrument,
      velocity,
      length,
    });
  });
}

function addKickerBackbeat(module, slot, patternIndex, source, { fourOnFloor = false, soft = false } = {}) {
  for (let bar = 0; bar < 8; bar += 1) {
    const start = bar * 16;
    const hits = fourOnFloor ? [0, 4, 8, 12] : [0, 8];
    for (const offset of hits) {
      note(module, slot, patternIndex, {
        line: start + offset,
        track: 0,
        midi: NOTE.c2,
        instrument: source.subKick,
        velocity: soft ? 84 : offset === 0 ? 118 : 104,
        length: 1,
      });
    }
    if (!soft && (bar === 3 || bar === 7)) {
      note(module, slot, patternIndex, {
        line: start + 15,
        track: 0,
        midi: NOTE.c2,
        instrument: source.subKick,
        velocity: 72,
        length: 1,
      });
    }
  }
}

function addDrumGrid(module, slot, patternIndex, source, { dense = false, soft = false } = {}) {
  for (let bar = 0; bar < 8; bar += 1) {
    const start = bar * 16;
    const hatOffsets = dense ? [2, 6, 10, 14] : [6, 14];
    for (const offset of hatOffsets) {
      note(module, slot, patternIndex, {
        line: start + offset,
        track: 1,
        midi: NOTE.d3,
        instrument: source.drums,
        velocity: soft ? 42 : offset === 14 ? 66 : 54,
        length: 1,
      });
    }
    for (const offset of dense ? [4, 12] : [12]) {
      note(module, slot, patternIndex, {
        line: start + offset,
        track: 1,
        midi: NOTE.eb3,
        instrument: source.drums,
        velocity: soft ? 48 : 76,
        length: 1,
      });
    }
  }
}

function addShepardChipBumper({ module, slot, patternIndex, sources, effects }) {
  addKickerBackbeat(module, slot, patternIndex, sources);
  addDrumGrid(module, slot, patternIndex, sources);

  const roots = [NOTE.c2, NOTE.bb1, NOTE.eb2, NOTE.f2, NOTE.c2, NOTE.bb1, NOTE.g1, NOTE.f2];
  for (let bar = 0; bar < roots.length; bar += 1) {
    const start = bar * 16;
    const root = roots[bar];
    for (const [offset, midi, velocity, length] of [
      [0, root, 94, 3],
      [5, root + 12, 68, 1],
      [8, root + 7, 76, 2],
      [12, root, 72, 2],
    ]) {
      note(module, slot, patternIndex, { line: start + offset, track: 2, midi, instrument: sources.bass, velocity, length });
    }
  }

  const chords = [
    [NOTE.c4, NOTE.eb4, NOTE.g4],
    [NOTE.bb3, NOTE.d4, NOTE.f4],
    [NOTE.eb4, NOTE.g4, NOTE.bb4],
    [NOTE.f4, NOTE.g4, NOTE.c5],
  ];
  for (let bar = 0; bar < 8; bar += 1) {
    chord(module, slot, patternIndex, {
      line: bar * 16 + (bar % 2 === 0 ? 0 : 4),
      startTrack: 3,
      notes: chords[bar % chords.length],
      instrument: sources.supersaw,
      velocity: bar >= 4 ? 54 : 46,
      length: 6,
    });
  }

  const lead = [
    [0, NOTE.c5, 112],
    [3, NOTE.g4, 80],
    [6, NOTE.bb4, 86],
    [10, NOTE.c5, 78],
    [16, NOTE.f4, 76],
    [19, NOTE.g4, 82],
    [22, NOTE.bb4, 74],
    [28, NOTE.c5, 94],
  ];
  for (let repeat = 0; repeat < 4; repeat += 1) {
    for (const [line, midi, velocity] of lead) {
      note(module, slot, patternIndex, {
        line: repeat * 32 + line,
        track: 6,
        midi,
        instrument: sources.analog,
        velocity: repeat === 0 && line === 0 ? 122 : velocity,
        length: 2,
      });
    }
  }

  for (const [line, midi, velocity] of [
    [0, NOTE.g5, 96],
    [32, NOTE.c6, 72],
    [64, NOTE.bb5, 78],
    [96, NOTE.g5, 74],
    [124, NOTE.c6, 108],
  ]) {
    note(module, slot, patternIndex, { line, track: 7, midi, instrument: sources.bell, velocity, length: 3 });
  }

  for (const [line, midi, velocity, length] of [
    [4, NOTE.c4, 58, 12],
    [36, NOTE.g4, 52, 10],
    [68, NOTE.eb4, 56, 12],
    [100, NOTE.f4, 60, 12],
    [120, NOTE.c5, 66, 6],
  ]) {
    note(module, slot, patternIndex, { line, track: 8, midi, instrument: sources.shepard, velocity, length });
  }

  for (const line of [60, 92, 116, 124]) {
    note(module, slot, patternIndex, {
      line,
      track: 9,
      midi: NOTE.g4,
      instrument: sources.noise,
      velocity: line >= 116 ? 64 : 48,
      length: line >= 124 ? 2 : 4,
    });
  }

  for (const [line, value] of [
    [0, 4200],
    [32, 5600],
    [64, 3600],
    [96, 6400],
    [120, 8200],
  ]) {
    controllerEvent(module, slot, patternIndex, {
      line,
      track: 13,
      moduleIndex: effects.bassFilter,
      type: "Filter Pro",
      controller: "freq",
      value,
    });
  }
}

function addFilterBassRun({ module, slot, patternIndex, sources, effects }) {
  addKickerBackbeat(module, slot, patternIndex, sources, { fourOnFloor: true });
  addDrumGrid(module, slot, patternIndex, sources, { dense: true });

  const roots = [NOTE.c2, NOTE.c2, NOTE.bb1, NOTE.bb1, NOTE.eb2, NOTE.eb2, NOTE.f2, NOTE.g1];
  const offsets = [0, 3, 6, 8, 10, 13, 15];
  for (let bar = 0; bar < roots.length; bar += 1) {
    const root = roots[bar];
    const start = bar * 16;
    offsets.forEach((offset, index) => {
      const midi = index % 4 === 1 ? root + 7 : index % 4 === 2 ? root + 12 : root;
      note(module, slot, patternIndex, {
        line: start + offset,
        track: 2,
        midi,
        instrument: sources.bass,
        velocity: offset === 0 ? 98 : 72,
        length: offset === 15 ? 1 : 2,
      });
    });
  }

  const leadNotes = [NOTE.c5, NOTE.d5, NOTE.eb5, NOTE.g5, NOTE.bb5, NOTE.g5, NOTE.eb5, NOTE.d5];
  for (let bar = 0; bar < 8; bar += 1) {
    const start = bar * 16;
    for (let step = 0; step < 8; step += 1) {
      note(module, slot, patternIndex, {
        line: start + step * 2 + (bar % 2),
        track: 6,
        midi: leadNotes[(step + bar) % leadNotes.length],
        instrument: sources.analog,
        velocity: bar >= 4 ? 62 : 54,
        length: 1,
      });
    }
  }

  for (let bar = 0; bar < 8; bar += 1) {
    const start = bar * 16;
    if (bar % 2 === 0) {
      chord(module, slot, patternIndex, {
        line: start + 1,
        startTrack: 3,
        notes: [NOTE.c4 + (bar % 4) * 2, NOTE.g4, NOTE.c5],
        instrument: sources.supersaw,
        velocity: 44,
        length: 5,
      });
    }
    note(module, slot, patternIndex, {
      line: start + 12,
      track: 8,
      midi: bar >= 6 ? NOTE.c5 : NOTE.g4,
      instrument: sources.shepard,
      velocity: bar >= 6 ? 58 : 44,
      length: 4,
    });
  }

  for (const [line, midi, velocity] of [
    [0, NOTE.c6, 92],
    [14, NOTE.g5, 60],
    [30, NOTE.bb5, 58],
    [62, NOTE.d6, 64],
    [94, NOTE.g5, 62],
    [112, NOTE.c6, 74],
    [124, NOTE.eb6, 96],
  ]) {
    note(module, slot, patternIndex, { line, track: 7, midi, instrument: sources.bell, velocity, length: 2 });
  }

  for (const line of [28, 60, 88, 116, 122]) {
    note(module, slot, patternIndex, {
      line,
      track: 9,
      midi: NOTE.c5,
      instrument: sources.noise,
      velocity: line >= 116 ? 58 : 42,
      length: 3,
    });
  }

  for (const [line, value] of [
    [0, 2600],
    [16, 4200],
    [32, 3100],
    [48, 5600],
    [64, 3400],
    [80, 6200],
    [96, 4400],
    [112, 9200],
  ]) {
    controllerEvent(module, slot, patternIndex, {
      line,
      track: 13,
      moduleIndex: effects.bassFilter,
      type: "Filter Pro",
      controller: "freq",
      value,
    });
  }
  for (const [line, value] of [
    [0, 64],
    [32, 116],
    [64, 78],
    [96, 152],
  ]) {
    controllerEvent(module, slot, patternIndex, {
      line,
      track: 12,
      moduleIndex: effects.formantBus,
      type: "Vocal filter",
      controller: "vowelPosition",
      value,
    });
  }
}

function addSoftFormantBed({ module, slot, patternIndex, sources, effects }) {
  addKickerBackbeat(module, slot, patternIndex, sources, { soft: true });
  addDrumGrid(module, slot, patternIndex, sources, { soft: true });

  const bassNotes = [
    [0, NOTE.c2],
    [16, NOTE.bb1],
    [32, NOTE.eb2],
    [48, NOTE.f2],
    [64, NOTE.c2],
    [80, NOTE.bb1],
    [96, NOTE.g1],
    [112, NOTE.f2],
  ];
  for (const [line, midi] of bassNotes) {
    note(module, slot, patternIndex, {
      line: line + 2,
      track: 2,
      midi,
      instrument: sources.bass,
      velocity: 66,
      length: 10,
    });
  }

  const chords = [
    [NOTE.c4, NOTE.eb4, NOTE.g4],
    [NOTE.bb3, NOTE.d4, NOTE.f4],
    [NOTE.eb4, NOTE.g4, NOTE.bb4],
    [NOTE.f4, NOTE.g4, NOTE.c5],
  ];
  for (let chordIndex = 0; chordIndex < 4; chordIndex += 1) {
    chord(module, slot, patternIndex, {
      line: chordIndex * 32,
      startTrack: 3,
      notes: chords[chordIndex],
      instrument: sources.supersaw,
      velocity: chordIndex >= 2 ? 50 : 44,
      length: 24,
    });
  }

  for (const [line, midi, velocity, length] of [
    [0, NOTE.c4, 52, 18],
    [24, NOTE.g4, 42, 12],
    [48, NOTE.eb4, 48, 16],
    [72, NOTE.bb4, 44, 14],
    [96, NOTE.f4, 50, 16],
    [120, NOTE.c5, 58, 6],
  ]) {
    note(module, slot, patternIndex, { line, track: 8, midi, instrument: sources.shepard, velocity, length });
  }

  for (const [line, midi, velocity] of [
    [8, NOTE.g5, 64],
    [38, NOTE.c6, 56],
    [70, NOTE.bb5, 58],
    [102, NOTE.g5, 54],
    [124, NOTE.c6, 74],
  ]) {
    note(module, slot, patternIndex, { line, track: 7, midi, instrument: sources.bell, velocity, length: 4 });
  }

  const texture = [
    [18, NOTE.c5],
    [22, NOTE.g4],
    [50, NOTE.bb4],
    [54, NOTE.f4],
    [82, NOTE.eb5],
    [86, NOTE.g4],
    [114, NOTE.f5],
    [118, NOTE.c5],
  ];
  for (const [line, midi] of texture) {
    note(module, slot, patternIndex, { line, track: 6, midi, instrument: sources.analog, velocity: 48, length: 2 });
  }

  for (const line of [108, 116, 124]) {
    note(module, slot, patternIndex, {
      line,
      track: 9,
      midi: NOTE.g4,
      instrument: sources.noise,
      velocity: line >= 124 ? 50 : 34,
      length: 4,
    });
  }

  for (const [line, value] of [
    [0, 132],
    [32, 156],
    [64, 112],
    [96, 176],
    [120, 148],
  ]) {
    controllerEvent(module, slot, patternIndex, {
      line,
      track: 13,
      moduleIndex: effects.formantBus,
      type: "Vocal filter",
      controller: "vowelPosition",
      value,
    });
  }
}

function addMixGraph(module, slot, loadedSources, effects, layout) {
  const effectIndexes = {};
  for (const spec of effects) {
    const position = layout.effects[spec.id];
    if (!position) {
      throw new Error(`Missing effect layout for ${spec.id}`);
    }
    const moduleIndex = createModule(module, slot, { type: spec.type, name: spec.name, ...position });
    setModuleControllers(module, slot, moduleIndex, spec.type, spec.controllers);
    effectIndexes[spec.id] = moduleIndex;
  }

  const moduleIndexesById = { ...loadedSources, ...effectIndexes, output: OUTPUT_MODULE };
  for (const [sourceId, destinationId] of mixConnections) {
    const source = moduleIndexesById[sourceId];
    const destination = moduleIndexesById[destinationId];
    if (source === undefined || destination === undefined) {
      throw new Error(`Missing mix connection endpoint: ${sourceId} -> ${destinationId}`);
    }
    connectModules(module, slot, source, destination, `${sourceId} -> ${destinationId}`);
  }

  return {
    indexes: effectIndexes,
    modules: effects.map((spec) => ({
      id: spec.id,
      index: effectIndexes[spec.id],
      type: spec.type,
      name: spec.name,
      controllers: spec.controllers,
      position: layout.effects[spec.id],
    })),
    output: {
      id: "output",
      index: OUTPUT_MODULE,
      name: "Output",
      position: layout.output,
    },
    connections: mixConnections.map(([source, destination]) => ({ source, destination })),
    layout: {
      columns: layout.columns,
      settings: layout.settings,
    },
  };
}

function summarizeAudio(samples, channels, sampleRate = SAMPLE_RATE) {
  let peak = 0;
  let sumSquares = 0;
  let clippedSamples = 0;
  let activeSamples = 0;
  for (const sample of samples) {
    const absolute = Math.abs(sample);
    peak = Math.max(peak, absolute);
    sumSquares += sample * sample;
    if (absolute >= 1) {
      clippedSamples += 1;
    }
    if (absolute > 1e-5) {
      activeSamples += 1;
    }
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  const loudness = summarizeMomentaryLufs(samples, channels, sampleRate);
  const stereo = summarizeStereo(samples, channels);
  return {
    channels,
    frames: samples.length / channels,
    peak,
    rms,
    momentaryLufs: loudness.momentaryLufs,
    momentaryPower: loudness.momentaryPower,
    shortLufs: loudness.shortLufs,
    shortPower: loudness.shortPower,
    activeLufs: loudness.activeLufs,
    activePower: loudness.activePower,
    activeTopLufs: loudness.activeTopLufs,
    activeTopPower: loudness.activeTopPower,
    activeWindowCount: loudness.activeWindowCount,
    activeTopWindowCount: loudness.activeTopWindowCount,
    activeThreshold: loudness.activeThreshold,
    clippedSamples,
    activeRatio: activeSamples / samples.length,
    ...(stereo ? { stereo } : {}),
  };
}

function summarizeStereo(samples, channels) {
  if (channels !== 2) {
    return undefined;
  }
  let leftSquares = 0;
  let rightSquares = 0;
  let midSquares = 0;
  let sideSquares = 0;
  let cross = 0;
  const frames = samples.length / channels;
  for (let index = 0; index < samples.length; index += 2) {
    const left = samples[index];
    const right = samples[index + 1];
    const mid = (left + right) * 0.5;
    const side = (left - right) * 0.5;
    leftSquares += left * left;
    rightSquares += right * right;
    midSquares += mid * mid;
    sideSquares += side * side;
    cross += left * right;
  }
  const leftRms = Math.sqrt(leftSquares / frames);
  const rightRms = Math.sqrt(rightSquares / frames);
  const midRms = Math.sqrt(midSquares / frames);
  const sideRms = Math.sqrt(sideSquares / frames);
  const correlationDenominator = Math.sqrt(leftSquares * rightSquares);
  return {
    leftRms,
    rightRms,
    midRms,
    sideRms,
    sideToMidRms: midRms > 0 ? sideRms / midRms : 0,
    correlation: correlationDenominator > 0 ? cross / correlationDenominator : 0,
  };
}

function setRuntimeSourceVolumes(module, slot, moduleIndexesById, volumesById) {
  for (const source of sourceModules) {
    const moduleIndex = moduleIndexesById[source.id];
    if (moduleIndex === undefined) {
      throw new Error(`Missing runtime module index for ${source.id}`);
    }
    assertSunVoxOk(
      module._sv_set_module_ctl_value(slot, moduleIndex, controllerIndex(source.type, "volume"), volumesById[source.id] ?? 0, 0),
      `${source.id} runtime volume`,
    );
  }
}

function renderProjectPass(
  module,
  { slot, sampleRate, channels, projectBytes, moduleIndexesById, volumesById, renderSeconds = RENDER_SECONDS },
) {
  loadProjectFromBuffer(module, projectBytes, { slot });
  setRuntimeSourceVolumes(module, slot, moduleIndexesById, volumesById);
  assertSunVoxOk(module._sv_volume(slot, 256), "sv_volume");
  assertSunVoxOk(module._sv_play_from_beginning(slot), "sv_play_from_beginning");
  const rendered = renderSlotAudio(module, {
    slot,
    sampleRate,
    channels,
    durationSeconds: renderSeconds,
    blockFrames: DEFAULT_BLOCK_FRAMES,
  });
  assertSunVoxOk(module._sv_stop(slot), "sv_stop");
  return summarizeAudio(rendered.samples, channels, sampleRate);
}

function analyzePartBalance(mix, partSummaries) {
  const partLevel = (part) => {
    const audio = part.audio ?? part;
    const active = audio.activePower || 0;
    const activeTop = audio.activeTopPower || 0;
    const short = audio.shortPower || 0;
    return active * 0.55 + activeTop * 0.25 + short * 0.2;
  };
  const maxPartLevel = Math.max(...partSummaries.map((part) => partLevel(part)), 0);
  const mixLevel = partLevel(mix);
  return {
    maxPartRms: maxPartLevel,
    maxPartLevel,
    mixActiveLufs: mix.activeLufs,
    maxPartMomentaryLufs: partSummaries.reduce(
      (max, part) => Math.max(max, part.audio.momentaryLufs),
      Number.NEGATIVE_INFINITY,
    ),
    parts: partSummaries.map((part) => {
      const level = partLevel(part);
      const rmsRelativeToMaxPart = maxPartLevel > 0 ? level / maxPartLevel : 0;
      const rmsRelativeToMix = mixLevel > 0 ? level / mixLevel : 0;
      const status =
        rmsRelativeToMaxPart < 0.28 ? "quiet" : rmsRelativeToMaxPart > 0.9 ? "dominant" : "present";
      return {
        id: part.id,
        status,
        rmsRelativeToMaxPart,
        rmsRelativeToMix,
        peak: part.audio.peak,
        rms: part.audio.rms,
        activeLufs: part.audio.activeLufs,
        activeTopLufs: part.audio.activeTopLufs,
        momentaryLufs: part.audio.momentaryLufs,
        shortLufs: part.audio.shortLufs,
      };
    }),
  };
}

async function loadSourceModules(module, slot, sources, layout) {
  const loaded = {};
  for (const source of sources) {
    const position = layout.sources[source.id];
    if (!position) {
      throw new Error(`Missing source layout for ${source.id}`);
    }
    if (source.create) {
      const moduleIndex = createModule(module, slot, { type: source.type, name: source.moduleName, ...position });
      setModuleControllers(module, slot, moduleIndex, source.type, source.controllers);
      loaded[source.id] = moduleIndex;
      continue;
    }
    const bytes = await readSunsynthForMusic(source.path, { rootVolume: source.musicRootVolume });
    const moduleIndex = loadSynthModuleFromBuffer(module, bytes, {
      slot,
      ...position,
      connectToOutput: false,
    });
    setModuleControllers(module, slot, moduleIndex, source.type, source.controllers);
    loaded[source.id] = moduleIndex;
  }
  return loaded;
}

async function buildThemeProject(theme) {
  const sources = specsForTheme(sourceModules, theme.sourceControllers);
  const effects = specsForTheme(effectModules, theme.effectControllers);
  const volumes = sourceVolumeMap(sources);

  return withSunVoxSlot(
    { flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS, sampleRate: SAMPLE_RATE, channels: CHANNELS },
    async ({ module, slot }) => {
      setSongName(module, slot, theme.songName);

      const nodeLayout = computeNodeLayout();
      const loadedSources = await loadSourceModules(module, slot, sources, nodeLayout);
      const mixGraph = addMixGraph(module, slot, loadedSources, effects, nodeLayout);

      const patternIndex = createPattern(module, {
        slot,
        tracks: TRACKS,
        lines: LINES,
        name: theme.patternName,
        iconSeed: theme.iconSeed,
      });
      theme.buildArrangement({
        module,
        slot,
        patternIndex,
        sources: loadedSources,
        effects: mixGraph.indexes,
      });

      const document = parseContainer(saveSlotToMemory(module, slot));
      document.project.bpm = theme.bpm;
      document.project.globalVolume = theme.globalVolume ?? 256;
      applyDeterministicPatternIcons(document, theme);
      applySavedLayout(document, nodeLayout, sources, effects);
      applySavedControllers(document, sources, effects);

      return { document, mixGraph, sources, effects, volumes };
    },
  );
}

async function buildThemeDocument(theme) {
  return (await buildThemeProject(theme)).document;
}

/** @satisfies {import("../../../tools/sunvox-music-recipe.d.ts").SunVoxMusicRecipe} */
export const recipe = {
  schemaVersion: 1,
  tags: ["research:short-video-bgm", "research:alternate-palette", "research:generated-music"],
  issue: 38,
  outputs: Object.fromEntries(
    themes.map((theme) => [
      theme.id,
      {
        file: outputPathForTheme(theme),
        title: theme.title,
        summaryFile: summaryPathForTheme(theme),
        buildDocument: () => buildThemeDocument(theme),
      },
    ]),
  ),
};

export default recipe;

async function generateTheme(theme) {
  const outputPath = outputPathForTheme(theme);
  const summaryPath = summaryPathForTheme(theme);
  const sources = specsForTheme(sourceModules, theme.sourceControllers);
  const effects = specsForTheme(effectModules, theme.effectControllers);
  const volumes = sourceVolumeMap(sources);

  const summary = await withSunVoxSlot(
    { flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS, sampleRate: SAMPLE_RATE, channels: CHANNELS },
    async ({ module, slot, sampleRate, channels }) => {
      setSongName(module, slot, theme.songName);

      const nodeLayout = computeNodeLayout();
      const loadedSources = await loadSourceModules(module, slot, sources, nodeLayout);
      const mixGraph = addMixGraph(module, slot, loadedSources, effects, nodeLayout);

      const patternIndex = createPattern(module, {
        slot,
        tracks: TRACKS,
        lines: LINES,
        name: theme.patternName,
        iconSeed: theme.iconSeed,
      });
      theme.buildArrangement({
        module,
        slot,
        patternIndex,
        sources: loadedSources,
        effects: mixGraph.indexes,
      });

      const document = parseContainer(saveSlotToMemory(module, slot));
      document.project.bpm = theme.bpm;
      document.project.globalVolume = theme.globalVolume ?? 256;
      applyDeterministicPatternIcons(document, theme);
      applySavedLayout(document, nodeLayout, sources, effects);
      applySavedControllers(document, sources, effects);

      const projectBytes = buildContainer(document);
      await writeFile(outputPath, projectBytes);

      const parsed = parseContainer(projectBytes);
      const moduleIndexesById = {};
      for (const source of sources) {
        const moduleIndex = parsed.modules.findIndex((entry) => entry.name === source.moduleName);
        if (moduleIndex < 0) {
          throw new Error(`Missing saved source module for ${source.id}: ${source.moduleName}`);
        }
        moduleIndexesById[source.id] = moduleIndex;
      }

      const mixAudio = renderProjectPass(module, {
        slot,
        sampleRate,
        channels,
        projectBytes,
        moduleIndexesById,
        volumesById: volumes,
      });
      const partSummaries = sources.map((source) => ({
        id: source.id,
        moduleName: source.moduleName,
        type: source.type,
        volume: volumes[source.id],
        audio: renderProjectPass(module, {
          slot,
          sampleRate,
          channels,
          projectBytes,
          moduleIndexesById,
          volumesById: Object.fromEntries(
            sources.map((candidate) => [candidate.id, candidate.id === source.id ? volumes[source.id] : 0]),
          ),
        }),
      }));
      const generatedPattern = parsed.patterns.find((pattern) => pattern.name === theme.patternName);
      return {
        id: theme.id,
        title: theme.title,
        concept: theme.concept,
        outputPath,
        summaryPath,
        generatedBytes: projectBytes.length,
        renderSeconds: RENDER_SECONDS,
        song: {
          name: parsed.project.name,
          bpm: parsed.project.bpm,
          speed: parsed.project.speed,
          patterns: parsed.patterns.length,
          modules: parsed.modules
            .map((entry, index) => ({ index, name: entry.name, type: entry.type, controllers: entry.controllers }))
            .filter((entry) => entry.type),
        },
        pattern: {
          name: generatedPattern?.name,
          lines: LINES,
          tracks: TRACKS,
          nonEmptyEvents: generatedPattern?.events?.length ?? 0,
        },
        arrangement: theme.arrangement,
        audio: mixAudio,
        parts: partSummaries,
        balance: analyzePartBalance(mixAudio, partSummaries),
        mix: mixGraph,
      };
    },
  );

  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`);
  return summary;
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await mkdir(SUMMARY_DIR, { recursive: true });

  const summaries = [];
  for (const theme of themes) {
    summaries.push(await generateTheme(theme));
  }

  const indexSummary = {
    outputDir: OUTPUT_DIR,
    renderSeconds: RENDER_SECONDS,
    themes: summaries.map((summary) => ({
      id: summary.id,
      title: summary.title,
      concept: summary.concept,
      outputPath: summary.outputPath,
      summaryPath: summary.summaryPath,
      bpm: summary.song.bpm,
      nonEmptyEvents: summary.pattern.nonEmptyEvents,
      peak: summary.audio.peak,
      rms: summary.audio.rms,
      momentaryLufs: summary.audio.momentaryLufs,
      shortLufs: summary.audio.shortLufs,
      activeLufs: summary.audio.activeLufs,
      clippedSamples: summary.audio.clippedSamples,
      sideToMidRms: summary.audio.stereo?.sideToMidRms,
      correlation: summary.audio.stereo?.correlation,
      quietParts: summary.balance.parts.filter((part) => part.status === "quiet").map((part) => part.id),
    })),
  };
  await writeFile(OUTPUT_INDEX_PATH, `${JSON.stringify(indexSummary, null, 2)}\n`);
  console.log(JSON.stringify(indexSummary, null, 2));
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  await main();
}

import { mkdir, readFile, writeFile } from "node:fs/promises";
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
  summarizeMomentaryLufs,
} from "../../../tools/sunvox-music-recipe-helpers.mjs";

const OUTPUT_DIR = "generated/music";
const SUMMARY_DIR = "var/music-recipe";
const OUTPUT_INDEX_PATH = join(SUMMARY_DIR, "short-video-poly-vocoder.summary.json");
const CHANNELS = DEFAULT_CHANNELS;
const SAMPLE_RATE = DEFAULT_SAMPLE_RATE;
const LINES = 128;
const TRACKS = 16;
const RENDER_SECONDS = 16;
const VELOCITY = 104;
const OUTPUT_MODULE = 0;

const sourceModules = [
  {
    id: "kick",
    moduleName: "Poly Kicker Low",
    type: "Kicker",
    create: true,
    controllers: {
      volume: 28,
      waveform: 2,
      panning: 128,
      attack: 0,
      release: 24,
      boost: 260,
      acceleration: 318,
      polyphony: 1,
      noClick: 0,
    },
  },
  {
    id: "drums",
    moduleName: "Poly DrumSynth Ticks",
    type: "DrumSynth",
    create: true,
    controllers: {
      volume: 210,
      panning: 128,
      polyphony: 8,
      bassVolume: 64,
      bassPower: 164,
      bassTone: 48,
      bassLength: 36,
      hihatVolume: 286,
      hihatLength: 26,
      snareVolume: 148,
      snareTone: 184,
      snareLength: 34,
      bassPan: 128,
      hihatPan: 174,
      snarePan: 92,
    },
  },
  {
    id: "bass",
    moduleName: "Scratch FMX Bass",
    type: "FMX",
    path: "generated/instruments/Scratch FMX Bass.sunsynth",
    controllers: { volume: 22000, panning: 128 },
  },
  {
    id: "carrier",
    moduleName: "Poly Robot Carrier",
    type: "Generator",
    create: true,
    controllers: {
      volume: 136,
      waveform: 2,
      panning: 128,
      attack: 0,
      release: 54,
      polyphony: 8,
      mode: 0,
      sustain: 1,
      freqModulationByInput: 0,
      dutyCycle: 364,
    },
  },
  {
    id: "vowelNoise",
    moduleName: "Poly Vowel Noise",
    type: "Analog generator",
    create: true,
    controllers: {
      volume: 118,
      waveform: 11,
      panning: 128,
      attack: 0,
      release: 38,
      sustain: 0,
      expEnvelope: 1,
      dutyCycle: 512,
      osc2Pitch: 1000,
      filter: 3,
      filterFreq: 7200,
      filterResonance: 760,
      filterExpFreq: 1,
      filterAttack: 0,
      filterRelease: 80,
      filterEnvelope: 1,
      polyphony: 8,
      mode: 0,
      noise: 220,
      osc2Volume: 0,
      osc2Mode: 0,
      osc2Phase: 0,
    },
  },
  {
    id: "spectraVoice",
    moduleName: "Poly Spectra Choir",
    type: "SpectraVoice",
    create: true,
    controllers: {
      volume: 62,
      panning: 146,
      attack: 8,
      release: 260,
      polyphony: 8,
      mode: 1,
      sustain: 1,
      spectrumResolution: 2,
      harmonic: 0,
      hFreq: 880,
      hVolume: 255,
      hWidth: 18,
      hType: 14,
    },
  },
  {
    id: "bell",
    moduleName: "Scratch FMX Tines",
    type: "FMX",
    path: "generated/instruments/Scratch FMX Tines.sunsynth",
    controllers: { volume: 9000, panning: 168 },
  },
  {
    id: "shepard",
    moduleName: "Shepard tone",
    type: "MetaModule",
    path: "instruments/mandel59 shepard.sunsynth",
    controllers: { volume: 220 },
  },
  {
    id: "noisePing",
    moduleName: "Poly Blue Noise Ping",
    type: "Analog generator",
    create: true,
    controllers: {
      volume: 58,
      waveform: 13,
      panning: 84,
      attack: 0,
      release: 28,
      sustain: 0,
      expEnvelope: 1,
      dutyCycle: 512,
      osc2Pitch: 1000,
      filter: 7,
      filterFreq: 9400,
      filterResonance: 360,
      filterExpFreq: 1,
      filterAttack: 0,
      filterRelease: 64,
      filterEnvelope: 1,
      polyphony: 8,
      mode: 0,
      noise: 180,
      osc2Volume: 0,
      osc2Mode: 0,
      osc2Phase: 0,
    },
  },
];

const effectModules = [
  {
    id: "kickTrim",
    type: "Amplifier",
    name: "Poly Kick Mono Trim",
    controllers: { volume: 182, balance: 128, stereoWidth: 54, fineVolume: 32768 },
  },
  {
    id: "drumComb",
    type: "Flanger",
    name: "Poly Drum Comb",
    controllers: {
      dry: 256,
      wet: 58,
      feedback: 92,
      delay: 88,
      response: 7,
      lfoFreq: 5,
      lfoAmp: 22,
      lfoWaveform: 0,
      setLfoPhase: 0,
      lfoFreqUnit: 4,
    },
  },
  {
    id: "drumTrim",
    type: "Amplifier",
    name: "Poly Drum Side Trim",
    controllers: { volume: 216, balance: 144, stereoWidth: 178, fineVolume: 32768 },
  },
  {
    id: "bassDrive",
    type: "Distortion",
    name: "Poly Bass Edge",
    controllers: { volume: 164, type: 8, power: 38, bitDepth: 16, freq: 44100, noise: 0 },
  },
  {
    id: "bassGateFilter",
    type: "Filter Pro",
    name: "Poly Bass Gate Filter",
    controllers: {
      volume: 32768,
      type: 0,
      freq: 3900,
      freqFinetune: 1000,
      freqScale: 100,
      expFreq: 1,
      q: 14600,
      gain: 16384,
      rolloff: 2,
      response: 180,
      mode: 0,
      mix: 32768,
      lfoFreq: 7,
      lfoAmp: 2100,
      lfoWaveform: 2,
      setLfoPhase: 0,
      lfoFreqUnit: 4,
    },
  },
  {
    id: "bassTrim",
    type: "Amplifier",
    name: "Poly Bass Center",
    controllers: { volume: 238, balance: 128, stereoWidth: 76, fineVolume: 32768 },
  },
  {
    id: "carrierVibrato",
    type: "Vibrato",
    name: "Poly Carrier Jitter",
    controllers: {
      volume: 232,
      amplitude: 7,
      freq: 3,
      channels: 0,
      setPhase: 0,
      frequencyUnit: 4,
      exponentialAmplitude: 0,
    },
  },
  {
    id: "vowelFilter",
    type: "Vocal filter",
    name: "Poly Vowel Noise Filter",
    controllers: {
      volume: 270,
      formantWidth: 84,
      intensity: 138,
      formants: 5,
      vowelPosition: 0,
      voiceType: 2,
      channels: 0,
      randomFrequency: 28,
      randomSeed: 23,
      vowel1: 0,
      vowel2: 4,
      vowel3: 2,
      vowel4: 1,
      vowel5: 3,
    },
  },
  {
    id: "robotMod",
    type: "Modulator",
    name: "Poly Robot Modulator",
    controllers: { volume: 256, modulationType: 0, channels: 0, maxPmDelayLen: 0 },
  },
  {
    id: "robotVocal",
    type: "Vocal filter",
    name: "Poly Robot Mouth",
    controllers: {
      volume: 280,
      formantWidth: 102,
      intensity: 74,
      formants: 4,
      vowelPosition: 104,
      voiceType: 1,
      channels: 0,
      randomFrequency: 12,
      randomSeed: 31,
      vowel1: 4,
      vowel2: 0,
      vowel3: 3,
      vowel4: 1,
      vowel5: 2,
    },
  },
  {
    id: "robotPitch",
    type: "Pitch shifter",
    name: "Poly Robot Octave Shadow",
    controllers: {
      volume: 168,
      pitch: 480,
      pitchScale: 100,
      feedback: 18,
      grainSize: 48,
      mode: 2,
      bypassIfPitch0: 2,
    },
  },
  {
    id: "bellEcho",
    type: "Echo",
    name: "Poly Bell Uneven Echo",
    controllers: {
      dry: 256,
      wet: 62,
      feedback: 82,
      delay: 5,
      rightChannelOffset: 1,
      delayUnit: 4,
      rightChannelOffsetValue: 20100,
      filter: 1,
      filterFreq: 7200,
    },
  },
  {
    id: "shepardFilter",
    type: "Filter Pro",
    name: "Poly Shepard Band Orbit",
    controllers: {
      volume: 32768,
      type: 2,
      freq: 5200,
      freqFinetune: 1000,
      freqScale: 100,
      expFreq: 1,
      q: 9800,
      gain: 16384,
      rolloff: 1,
      response: 260,
      mode: 0,
      mix: 22000,
      lfoFreq: 11,
      lfoAmp: 3600,
      lfoWaveform: 1,
      setLfoPhase: 0,
      lfoFreqUnit: 4,
    },
  },
  {
    id: "musicBus",
    type: "Amplifier",
    name: "Poly Music Wide Bus",
    controllers: { volume: 186, balance: 128, stereoWidth: 210, fineVolume: 32768 },
  },
  {
    id: "musicEcho",
    type: "Echo",
    name: "Poly Cross-Rhythm Echo",
    controllers: {
      dry: 256,
      wet: 34,
      feedback: 64,
      delay: 7,
      rightChannelOffset: 1,
      delayUnit: 4,
      rightChannelOffsetValue: 17800,
      filter: 1,
      filterFreq: 5600,
    },
  },
  {
    id: "masterGlue",
    type: "Compressor",
    name: "Poly Master Glue",
    controllers: { volume: 420, threshold: 322, slope: 94, attack: 5, release: 260, mode: 1, sideChainInput: 0 },
  },
];

const mixConnections = [
  ["kick", "kickTrim"],
  ["kickTrim", "masterGlue"],
  ["drums", "drumComb"],
  ["drumComb", "drumTrim"],
  ["drumTrim", "masterGlue"],
  ["bass", "bassDrive"],
  ["bassDrive", "bassGateFilter"],
  ["bassGateFilter", "bassTrim"],
  ["bassTrim", "masterGlue"],
  ["carrier", "carrierVibrato"],
  ["carrierVibrato", "robotMod"],
  ["vowelNoise", "vowelFilter"],
  ["vowelFilter", "robotMod"],
  ["robotMod", "robotVocal"],
  ["robotVocal", "robotPitch"],
  ["robotPitch", "musicBus"],
  ["spectraVoice", "musicBus"],
  ["bell", "bellEcho"],
  ["bellEcho", "musicBus"],
  ["shepard", "shepardFilter"],
  ["shepardFilter", "musicBus"],
  ["noisePing", "musicBus"],
  ["musicBus", "musicEcho"],
  ["musicEcho", "masterGlue"],
  ["masterGlue", "output"],
];

const themes = Object.freeze([
  {
    id: "poly-vocoder-syllable-grid",
    title: "Poly Vocoder Syllable Grid",
    songName: "Short BGM Poly Vocoder - Syllable Grid",
    patternName: "15s poly vocoder syllable grid",
    bpm: 128,
    iconSeed: 50,
    concept: "robot syllables over 5-against-4 hats and a 7-step vowel cycle",
    arrangement: [
      "Kicker anchors the edit grid while DrumSynth hats run five pulses per two bars",
      "FMX bass cycles in a 3-bar phrase against the 4-bar loop",
      "Generator carrier and filtered noise feed Modulator for a vocoder-like robot mouth",
      "Vocal filter vowel position changes every 7 syllables",
      "SpectraVoice adds a synthetic choir pad behind the robot texture",
      "Bell pings use uneven echo to underline the cross-rhythm",
    ],
    buildArrangement: addSyllableGrid,
  },
  {
    id: "poly-odd-robot-break",
    title: "Poly Odd Robot Break",
    songName: "Short BGM Poly Vocoder - Odd Robot Break",
    patternName: "15s poly odd robot break",
    bpm: 138,
    iconSeed: 51,
    concept: "dense break cue with 3-3-2 accents, 5-step bass gating, and robot call-response",
    arrangement: [
      "Kick stays mostly four-on-the-floor but snare/tick accents follow 3-3-2",
      "Bass filter opens on a five-step cycle independent of the bar grid",
      "Robot carrier syllables answer SpectraVoice stabs",
      "Pitch shifter creates a lower octave shadow on the modulated robot bus",
      "Shepard tone runs a 17-line phase ladder as a transition cue",
      "Noise pings and bell hits mark section turns without becoming the main hook",
    ],
    sourceControllers: {
      kick: { volume: 30 },
      drums: { volume: 236 },
      bass: { volume: 24000 },
      carrier: { volume: 152, dutyCycle: 300 },
      vowelNoise: { volume: 132 },
      spectraVoice: { volume: 70, release: 180 },
      bell: { volume: 8400 },
      shepard: { volume: 180 },
      noisePing: { volume: 70 },
    },
    effectControllers: {
      bassDrive: { power: 54, volume: 174 },
      bassGateFilter: { freq: 3100, q: 16200, lfoAmp: 2800 },
      robotVocal: { intensity: 92, formantWidth: 86 },
      robotPitch: { volume: 188, pitch: 430, feedback: 24 },
      musicEcho: { wet: 40, delay: 5, feedback: 70 },
      masterGlue: { threshold: 316, slope: 88 },
    },
    buildArrangement: addOddRobotBreak,
  },
  {
    id: "poly-soft-vocoder-kaleidoscope",
    title: "Poly Soft Vocoder Kaleidoscope",
    songName: "Short BGM Poly Vocoder - Soft Kaleidoscope",
    patternName: "15s poly soft vocoder kaleidoscope",
    bpm: 112,
    iconSeed: 52,
    concept: "calmer bed with slow 3-over-4 tines, soft robot vowels, and spectral pad motion",
    arrangement: [
      "Sparse kick leaves narration space while hats sketch a soft five-pulse cycle",
      "Robot carrier is lower and longer, acting as texture rather than lead",
      "SpectraVoice and Shepard tone create a synthetic pad bed",
      "Tines trace a 3-over-4 figure across the loop",
      "Vowel filter automation moves slowly through a-u-i-e colors",
      "Final noise bloom is a loop reset marker rather than a fill",
    ],
    sourceControllers: {
      kick: { volume: 16 },
      drums: { volume: 118 },
      bass: { volume: 15000 },
      carrier: { volume: 96, release: 110 },
      vowelNoise: { volume: 82 },
      spectraVoice: { volume: 72, attack: 22, release: 360 },
      bell: { volume: 7200 },
      shepard: { volume: 220 },
      noisePing: { volume: 42 },
    },
    effectControllers: {
      drumComb: { wet: 38, feedback: 72 },
      bassDrive: { power: 22, volume: 130 },
      bassGateFilter: { freq: 5200, q: 10000, lfoAmp: 1100 },
      carrierVibrato: { amplitude: 4, volume: 214 },
      vowelFilter: { intensity: 112, formantWidth: 112, volume: 230 },
      robotVocal: { intensity: 48, formantWidth: 130, volume: 244 },
      robotPitch: { volume: 120, pitch: 540, feedback: 8 },
      shepardFilter: { mix: 18000, lfoAmp: 2200 },
      musicEcho: { wet: 42, feedback: 78, delay: 8 },
      masterGlue: { volume: 512, threshold: 348, slope: 112 },
    },
    buildArrangement: addSoftKaleidoscope,
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
  columnGap: 232,
  top: 184,
  rowGap: 86,
});

const sourceLanes = Object.freeze([
  "kick",
  "drums",
  "bass",
  "carrier",
  "vowelNoise",
  "spectraVoice",
  "bell",
  "shepard",
  "noisePing",
]);

const effectLayout = Object.freeze({
  kickTrim: { column: "insert", source: "kick" },
  drumComb: { column: "insert", source: "drums" },
  drumTrim: { column: "insert2", source: "drums" },
  bassDrive: { column: "insert", source: "bass" },
  bassGateFilter: { column: "insert2", source: "bass" },
  bassTrim: { column: "bus", source: "bass" },
  carrierVibrato: { column: "insert", source: "carrier" },
  vowelFilter: { column: "insert", source: "vowelNoise" },
  robotMod: { column: "insert2", sources: ["carrier", "vowelNoise"] },
  robotVocal: { column: "bus", sources: ["carrier", "vowelNoise"] },
  robotPitch: { column: "echo", sources: ["carrier", "vowelNoise"] },
  bellEcho: { column: "insert", source: "bell" },
  shepardFilter: { column: "insert", source: "shepard" },
  musicBus: { column: "bus", sources: ["carrier", "vowelNoise", "spectraVoice", "bell", "shepard", "noisePing"] },
  musicEcho: { column: "echo", sources: ["spectraVoice", "bell", "shepard", "noisePing"] },
  masterGlue: { column: "master", sources: sourceLanes },
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
  d6: 86,
  eb6: 87,
  f6: 89,
  g6: 91,
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
    sourceModules.map((source) => [source.id, { x: layoutColumn("source"), y: sourceLaneY(source.id), z: 0 }]),
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
    note(module, slot, patternIndex, { line, track: startTrack + offset, midi, instrument, velocity, length });
  });
}

function pulses({ start = 0, span, count, rotate = 0 }) {
  return Array.from({ length: count }, (_, index) => start + Math.round(((index + rotate) * span) / count) % span)
    .filter((line, index, lines) => lines.indexOf(line) === index)
    .sort((a, b) => a - b);
}

function addKickGrid(module, slot, patternIndex, source, { fourOnFloor = false, sparse = false } = {}) {
  for (let bar = 0; bar < 8; bar += 1) {
    const start = bar * 16;
    const offsets = sparse ? [0] : fourOnFloor ? [0, 4, 8, 12] : [0, 8];
    for (const offset of offsets) {
      note(module, slot, patternIndex, {
        line: start + offset,
        track: 0,
        midi: NOTE.c2,
        instrument: source.kick,
        velocity: sparse ? 76 : offset === 0 ? 116 : 98,
        length: 1,
      });
    }
    if (!sparse && (bar === 3 || bar === 7)) {
      note(module, slot, patternIndex, {
        line: start + 15,
        track: 0,
        midi: NOTE.c2,
        instrument: source.kick,
        velocity: 66,
        length: 1,
      });
    }
  }
}

function addFivePulseHats(module, slot, patternIndex, source, { soft = false, rotate = 0 } = {}) {
  for (let section = 0; section < 4; section += 1) {
    for (const line of pulses({ start: section * 32, span: 32, count: 5, rotate })) {
      note(module, slot, patternIndex, {
        line,
        track: 1,
        midi: NOTE.d3,
        instrument: source.drums,
        velocity: soft ? 40 : line % 32 === 0 ? 68 : 54,
        length: 1,
      });
    }
  }
}

function addSyllableGrid({ module, slot, patternIndex, sources, effects }) {
  addKickGrid(module, slot, patternIndex, sources);
  addFivePulseHats(module, slot, patternIndex, sources);

  const bassCycle = [
    [0, NOTE.c2],
    [6, NOTE.g1],
    [12, NOTE.bb1],
    [20, NOTE.c2],
    [28, NOTE.eb2],
    [36, NOTE.bb1],
    [44, NOTE.f2],
    [52, NOTE.g1],
    [60, NOTE.c2],
  ];
  for (let offset = 0; offset < 128; offset += 48) {
    for (const [line, midi] of bassCycle) {
      note(module, slot, patternIndex, {
        line: offset + line,
        track: 2,
        midi,
        instrument: sources.bass,
        velocity: line % 16 === 0 ? 92 : 72,
        length: 3,
      });
    }
  }

  const vowelValues = [0, 48, 104, 152, 208, 256, 120];
  const syllableLines = pulses({ span: 128, count: 21 });
  syllableLines.forEach((line, index) => {
    const midi = [NOTE.c4, NOTE.g3, NOTE.bb3, NOTE.eb4, NOTE.f4, NOTE.d4, NOTE.g4][index % 7];
    note(module, slot, patternIndex, {
      line,
      track: 6,
      midi,
      instrument: sources.carrier,
      velocity: index % 7 === 0 ? 104 : 78,
      length: 2,
    });
    note(module, slot, patternIndex, {
      line,
      track: 7,
      midi: NOTE.c5,
      instrument: sources.vowelNoise,
      velocity: index % 7 === 0 ? 96 : 70,
      length: 1,
    });
    controllerEvent(module, slot, patternIndex, {
      line,
      track: 15,
      moduleIndex: effects.vowelFilter,
      type: "Vocal filter",
      controller: "vowelPosition",
      value: vowelValues[index % vowelValues.length],
    });
  });

  for (const [line, notes] of [
    [0, [NOTE.c4, NOTE.eb4, NOTE.g4]],
    [32, [NOTE.bb3, NOTE.d4, NOTE.f4]],
    [64, [NOTE.eb4, NOTE.g4, NOTE.bb4]],
    [96, [NOTE.f4, NOTE.g4, NOTE.c5]],
  ]) {
    chord(module, slot, patternIndex, {
      line,
      startTrack: 3,
      notes,
      instrument: sources.spectraVoice,
      velocity: 54,
      length: 26,
    });
  }

  for (const line of pulses({ span: 128, count: 12, rotate: 1 })) {
    note(module, slot, patternIndex, {
      line,
      track: 9,
      midi: [NOTE.c6, NOTE.g5, NOTE.bb5, NOTE.d6][line % 4],
      instrument: sources.bell,
      velocity: line < 8 ? 100 : 58,
      length: 2,
    });
  }

  for (const [line, midi] of [
    [14, NOTE.c4],
    [47, NOTE.g4],
    [80, NOTE.eb4],
    [113, NOTE.f4],
    [126, NOTE.c5],
  ]) {
    note(module, slot, patternIndex, { line, track: 10, midi, instrument: sources.shepard, velocity: 52, length: 8 });
  }
}

function addOddRobotBreak({ module, slot, patternIndex, sources, effects }) {
  addKickGrid(module, slot, patternIndex, sources, { fourOnFloor: true });
  for (let bar = 0; bar < 8; bar += 1) {
    const start = bar * 16;
    for (const offset of [3, 6, 8, 11, 14]) {
      note(module, slot, patternIndex, {
        line: start + offset,
        track: 1,
        midi: offset === 8 ? NOTE.eb3 : NOTE.d3,
        instrument: sources.drums,
        velocity: offset === 8 ? 84 : 58,
        length: 1,
      });
    }
  }

  const roots = [NOTE.c2, NOTE.bb1, NOTE.c2, NOTE.eb2, NOTE.g1];
  for (let group = 0; group < 5; group += 1) {
    for (const line of pulses({ start: group * 24, span: 24, count: 5, rotate: group % 2 })) {
      const root = roots[group % roots.length];
      note(module, slot, patternIndex, {
        line,
        track: 2,
        midi: line % 3 === 0 ? root : root + 7,
        instrument: sources.bass,
        velocity: line % 24 === 0 ? 102 : 76,
        length: 2,
      });
    }
  }

  const robotLines = pulses({ span: 96, count: 16 }).concat([104, 110, 116, 121, 126]);
  robotLines.forEach((line, index) => {
    note(module, slot, patternIndex, {
      line,
      track: 6,
      midi: [NOTE.c4, NOTE.eb4, NOTE.g4, NOTE.bb3][index % 4],
      instrument: sources.carrier,
      velocity: index % 4 === 0 ? 108 : 84,
      length: index >= 16 ? 1 : 2,
    });
    note(module, slot, patternIndex, {
      line,
      track: 7,
      midi: NOTE.c5,
      instrument: sources.vowelNoise,
      velocity: index % 4 === 0 ? 104 : 72,
      length: 1,
    });
  });

  for (const [line, notes] of [
    [12, [NOTE.c4, NOTE.g4]],
    [36, [NOTE.bb3, NOTE.f4]],
    [60, [NOTE.eb4, NOTE.bb4]],
    [84, [NOTE.g3, NOTE.d4]],
    [108, [NOTE.f4, NOTE.c5]],
  ]) {
    chord(module, slot, patternIndex, {
      line,
      startTrack: 3,
      notes,
      instrument: sources.spectraVoice,
      velocity: 62,
      length: 8,
    });
  }

  for (let line = 0; line < 128; line += 17) {
    note(module, slot, patternIndex, {
      line,
      track: 10,
      midi: NOTE.c4 + Math.floor(line / 17),
      instrument: sources.shepard,
      velocity: line >= 102 ? 62 : 48,
      length: 6,
    });
  }

  for (const line of [0, 23, 47, 71, 95, 119, 126]) {
    note(module, slot, patternIndex, {
      line,
      track: 9,
      midi: line >= 119 ? NOTE.c6 : NOTE.g5,
      instrument: sources.bell,
      velocity: line === 0 ? 104 : 66,
      length: 2,
    });
    note(module, slot, patternIndex, {
      line: line + 1,
      track: 11,
      midi: NOTE.c5,
      instrument: sources.noisePing,
      velocity: 54,
      length: 1,
    });
  }

  for (const [line, value] of [
    [0, 2400],
    [24, 5600],
    [48, 3200],
    [72, 6800],
    [96, 4200],
    [112, 9400],
  ]) {
    controllerEvent(module, slot, patternIndex, {
      line,
      track: 14,
      moduleIndex: effects.bassGateFilter,
      type: "Filter Pro",
      controller: "freq",
      value,
    });
  }
  for (const [line, value] of [
    [0, 24],
    [32, 116],
    [64, 196],
    [96, 72],
    [120, 240],
  ]) {
    controllerEvent(module, slot, patternIndex, {
      line,
      track: 15,
      moduleIndex: effects.robotVocal,
      type: "Vocal filter",
      controller: "vowelPosition",
      value,
    });
  }
}

function addSoftKaleidoscope({ module, slot, patternIndex, sources, effects }) {
  addKickGrid(module, slot, patternIndex, sources, { sparse: true });
  addFivePulseHats(module, slot, patternIndex, sources, { soft: true, rotate: 1 });

  for (const [line, midi] of [
    [2, NOTE.c2],
    [34, NOTE.bb1],
    [66, NOTE.eb2],
    [98, NOTE.f2],
  ]) {
    note(module, slot, patternIndex, { line, track: 2, midi, instrument: sources.bass, velocity: 58, length: 12 });
  }

  const robotLines = [0, 18, 36, 54, 72, 90, 108, 122];
  robotLines.forEach((line, index) => {
    note(module, slot, patternIndex, {
      line,
      track: 6,
      midi: [NOTE.c3, NOTE.g3, NOTE.bb3, NOTE.eb4][index % 4],
      instrument: sources.carrier,
      velocity: 62,
      length: line >= 108 ? 6 : 9,
    });
    note(module, slot, patternIndex, {
      line: line + 1,
      track: 7,
      midi: NOTE.c5,
      instrument: sources.vowelNoise,
      velocity: 48,
      length: 3,
    });
  });

  for (const [line, notes] of [
    [0, [NOTE.c4, NOTE.eb4, NOTE.g4]],
    [32, [NOTE.bb3, NOTE.d4, NOTE.f4]],
    [64, [NOTE.eb4, NOTE.g4, NOTE.bb4]],
    [96, [NOTE.f4, NOTE.g4, NOTE.c5]],
  ]) {
    chord(module, slot, patternIndex, {
      line,
      startTrack: 3,
      notes,
      instrument: sources.spectraVoice,
      velocity: 52,
      length: 28,
    });
  }

  for (const [line, midi] of [
    [0, NOTE.c4],
    [27, NOTE.g4],
    [54, NOTE.eb4],
    [81, NOTE.bb4],
    [108, NOTE.f4],
    [124, NOTE.c5],
  ]) {
    note(module, slot, patternIndex, { line, track: 10, midi, instrument: sources.shepard, velocity: 48, length: 10 });
  }

  for (const line of pulses({ span: 128, count: 9 })) {
    note(module, slot, patternIndex, {
      line,
      track: 9,
      midi: [NOTE.c5, NOTE.g5, NOTE.eb5][line % 3],
      instrument: sources.bell,
      velocity: line === 0 ? 82 : 50,
      length: 3,
    });
  }

  for (const line of [112, 118, 124]) {
    note(module, slot, patternIndex, {
      line,
      track: 11,
      midi: NOTE.c5,
      instrument: sources.noisePing,
      velocity: line === 124 ? 46 : 34,
      length: 4,
    });
  }

  for (const [line, value] of [
    [0, 0],
    [32, 82],
    [64, 168],
    [96, 226],
    [120, 120],
  ]) {
    controllerEvent(module, slot, patternIndex, {
      line,
      track: 15,
      moduleIndex: effects.vowelFilter,
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
    output: { id: "output", index: OUTPUT_MODULE, name: "Output", position: layout.output },
    connections: mixConnections.map(([source, destination]) => ({ source, destination })),
    layout: { columns: layout.columns, settings: layout.settings },
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
        rmsRelativeToMaxPart < 0.25 ? "quiet" : rmsRelativeToMaxPart > 0.9 ? "dominant" : "present";
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
    const bytes = await readFile(source.path);
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
      theme.buildArrangement({ module, slot, patternIndex, sources: loadedSources, effects: mixGraph.indexes });

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
  tags: ["research:short-video-bgm", "research:polyrhythm-vocoder", "research:generated-music"],
  issue: 30,
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
      theme.buildArrangement({ module, slot, patternIndex, sources: loadedSources, effects: mixGraph.indexes });

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

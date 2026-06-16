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
import { buildContainer, parseContainer } from "../../../tools/sunvox-codec.mjs";
import { deterministicIconBase64, readSunsynthForMusic } from "../../../tools/sunvox-music-recipe-helpers.mjs";

const OUTPUT_DIR = "generated/music";
const SUMMARY_DIR = "var/music-recipe";
const OUTPUT_INDEX_PATH = join(SUMMARY_DIR, "short-video-bgm.summary.json");
const CHANNELS = DEFAULT_CHANNELS;
const SAMPLE_RATE = DEFAULT_SAMPLE_RATE;
const LINES = 128;
const TRACKS = 12;
const RENDER_SECONDS = 16;
const VELOCITY = 104;
const OUTPUT_MODULE = 0;

const instruments = [
  {
    id: "kick",
    moduleName: "Scratch Kick Snap",
    path: "generated/instruments/Scratch Kick Snap.sunsynth",
    musicRootVolume: 256,
    volume: 76,
  },
  {
    id: "bass",
    moduleName: "Scratch Acid Bass",
    path: "generated/instruments/Scratch Acid Bass.sunsynth",
    musicRootVolume: 256,
    volume: 42,
  },
  {
    id: "pad",
    moduleName: "Scratch Layered Pad",
    path: "generated/instruments/Scratch Layered Pad.sunsynth",
    musicRootVolume: 256,
    volume: 160,
  },
  {
    id: "bell",
    moduleName: "Scratch Glass Bell",
    path: "generated/instruments/Scratch Glass Bell.sunsynth",
    musicRootVolume: 256,
    volume: 132,
  },
  {
    id: "pluck",
    moduleName: "Scratch FMX Pluck",
    path: "generated/instruments/Scratch FMX Pluck.sunsynth",
    volume: 18000,
  },
  {
    id: "tines",
    moduleName: "Scratch FMX Tines",
    path: "generated/instruments/Scratch FMX Tines.sunsynth",
    volume: 16000,
  },
  {
    id: "organ",
    moduleName: "Scratch PWM Organ",
    path: "generated/instruments/Scratch PWM Organ.sunsynth",
    musicRootVolume: 256,
    volume: 230,
  },
];

const controllerIndexes = Object.freeze({
  Amplifier: Object.freeze({
    volume: 0,
    balance: 1,
    stereoWidth: 4,
    fineVolume: 6,
  }),
  Compressor: Object.freeze({
    volume: 0,
    threshold: 1,
    slope: 2,
    attack: 3,
    release: 4,
    mode: 5,
  }),
  Delay: Object.freeze({
    dry: 0,
    wet: 1,
    delayL: 2,
    delayR: 3,
    delayUnit: 8,
    feedback: 10,
  }),
  Reverb: Object.freeze({
    dry: 0,
    wet: 1,
    feedback: 2,
    damp: 3,
    stereoWidth: 4,
    mode: 6,
    roomSize: 8,
  }),
});

const mixModules = [
  {
    id: "kickTrim",
    type: "Amplifier",
    name: "Mix Kick Center",
    controllers: { volume: 212, balance: 128, stereoWidth: 86, fineVolume: 32768 },
  },
  {
    id: "bassTrim",
    type: "Amplifier",
    name: "Mix Bass Focus",
    controllers: { volume: 220, balance: 128, stereoWidth: 70, fineVolume: 32768 },
  },
  {
    id: "padTrim",
    type: "Amplifier",
    name: "Mix Pad Wide",
    controllers: { volume: 214, balance: 104, stereoWidth: 230, fineVolume: 32768 },
  },
  {
    id: "bellTrim",
    type: "Amplifier",
    name: "Mix Bell Air",
    controllers: { volume: 196, balance: 168, stereoWidth: 214, fineVolume: 32768 },
  },
  {
    id: "pluckTrim",
    type: "Amplifier",
    name: "Mix Pluck Motion",
    controllers: { volume: 192, balance: 92, stereoWidth: 238, fineVolume: 32768 },
  },
  {
    id: "tinesTrim",
    type: "Amplifier",
    name: "Mix Tines Lift",
    controllers: { volume: 204, balance: 176, stereoWidth: 238, fineVolume: 32768 },
  },
  {
    id: "organTrim",
    type: "Amplifier",
    name: "Mix Organ Stabs",
    controllers: { volume: 300, balance: 128, stereoWidth: 188, fineVolume: 32768 },
  },
  {
    id: "musicBus",
    type: "Amplifier",
    name: "Mix Music Width Bus",
    controllers: { volume: 226, balance: 128, stereoWidth: 224, fineVolume: 32768 },
  },
  {
    id: "spaceDelay",
    type: "Delay",
    name: "Mix Music Space Delay",
    controllers: { dry: 256, wet: 42, delayL: 88, delayR: 142, delayUnit: 1, feedback: 1700 },
  },
  {
    id: "airRoom",
    type: "Reverb",
    name: "Mix Music Air Room",
    controllers: { dry: 256, wet: 24, feedback: 132, damp: 172, stereoWidth: 232, mode: 0, roomSize: 18 },
  },
  {
    id: "masterGlue",
    type: "Compressor",
    name: "Mix Master Glue",
    controllers: { volume: 232, threshold: 324, slope: 84, attack: 8, release: 420, mode: 1 },
  },
];

const mixConnections = [
  ["kick", "kickTrim"],
  ["bass", "bassTrim"],
  ["pad", "padTrim"],
  ["bell", "bellTrim"],
  ["pluck", "pluckTrim"],
  ["tines", "tinesTrim"],
  ["organ", "organTrim"],
  ["kickTrim", "masterGlue"],
  ["bassTrim", "masterGlue"],
  ["padTrim", "musicBus"],
  ["bellTrim", "musicBus"],
  ["pluckTrim", "musicBus"],
  ["tinesTrim", "musicBus"],
  ["organTrim", "musicBus"],
  ["musicBus", "spaceDelay"],
  ["spaceDelay", "airRoom"],
  ["airRoom", "masterGlue"],
  ["masterGlue", "output"],
];

const arrangementIdeas = [
  "ghost kick pickups before section turns",
  "bass turnaround fills in bars 4, 6, and 8",
  "FMX tines pickup sparkles and final-bar riser",
  "PWM organ chord stabs for mid-loop contrast",
  "second-half pluck arpeggio lift",
  "bell call-and-response phrases",
];

const themes = Object.freeze([
  {
    id: "first-hook-loop",
    title: "First Hook Loop",
    songName: "Short BGM Probe - First Hook Loop",
    patternName: "15s hook loop",
    bpm: 128,
    iconSeed: 30,
    concept: "bright all-purpose hook loop with an immediate bell identity",
    arrangement: arrangementIdeas,
    buildArrangement: addFirstHookArrangement,
  },
  {
    id: "narration-lofi-bed",
    title: "Narration Lo-Fi Bed",
    songName: "Short BGM Probe - Narration Lo-Fi Bed",
    patternName: "15s narration lo-fi bed",
    bpm: 128,
    iconSeed: 31,
    concept: "lower-density half-time feel with more room for voiceover and captions",
    arrangement: [
      "half-time kick anchors without crowding narration",
      "round bass answers the kick with short rests",
      "wide pad sustains the emotional bed",
      "glass bell drops sparse first-second identity notes",
      "pluck and tines add low-level texture instead of a busy lead",
      "organ chords reinforce section changes softly",
    ],
    instrumentVolumes: {
      kick: 58,
      bass: 36,
      pad: 172,
      bell: 108,
      pluck: 16000,
      tines: 16500,
      organ: 215,
    },
    buildArrangement: addNarrationLofiArrangement,
  },
  {
    id: "tech-demo-stinger",
    title: "Tech Demo Stinger",
    songName: "Short BGM Probe - Tech Demo Stinger",
    patternName: "15s tech demo stinger",
    bpm: 128,
    iconSeed: 32,
    concept: "clean product-demo cue with a stronger first-second hook and more motion",
    arrangement: [
      "front-loaded bell and pluck hook for immediate recognition",
      "four-on-the-floor kick keeps edits locked to the grid",
      "short acid bass pattern creates forward motion without masking speech",
      "pad pulses keep the center clear",
      "tines riser and organ hits mark the final transition",
      "last-bar pickup resolves back into the opening hook",
    ],
    instrumentVolumes: {
      kick: 74,
      bass: 40,
      pad: 138,
      bell: 130,
      pluck: 17200,
      tines: 16800,
      organ: 250,
    },
    buildArrangement: addTechDemoStingerArrangement,
  },
]);

const layoutColumns = Object.freeze({
  source: 0,
  trim: 1,
  bus: 2,
  delay: 3,
  room: 4,
  master: 5,
  output: 6,
});

const layoutSettings = Object.freeze({
  left: 224,
  columnGap: 240,
  top: 224,
  rowGap: 112,
});

const partTrimIds = Object.freeze({
  kick: "kickTrim",
  bass: "bassTrim",
  pad: "padTrim",
  bell: "bellTrim",
  pluck: "pluckTrim",
  tines: "tinesTrim",
  organ: "organTrim",
});

const musicPartIds = Object.freeze(["pad", "bell", "pluck", "tines", "organ"]);

function layoutColumn(name) {
  return layoutSettings.left + layoutColumns[name] * layoutSettings.columnGap;
}

function partLaneY(partId) {
  const index = instruments.findIndex((instrument) => instrument.id === partId);
  if (index < 0) {
    throw new Error(`Missing layout lane for part ${partId}`);
  }
  return layoutSettings.top + index * layoutSettings.rowGap;
}

function averageY(partIds) {
  return Math.round(partIds.reduce((sum, partId) => sum + partLaneY(partId), 0) / partIds.length);
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
  const instrumentPositions = Object.fromEntries(
    instruments.map((instrument) => [
      instrument.id,
      { x: layoutColumn("source"), y: partLaneY(instrument.id), z: 0 },
    ]),
  );

  const mixPositions = {};
  for (const [partId, trimId] of Object.entries(partTrimIds)) {
    mixPositions[trimId] = { x: layoutColumn("trim"), y: partLaneY(partId), z: 0 };
  }

  const musicBusY = averageY(musicPartIds);
  const rhythmBusY = averageY(["kick", "bass"]);
  const masterY = Math.round((rhythmBusY + musicBusY) / 2);
  mixPositions.musicBus = { x: layoutColumn("bus"), y: musicBusY, z: 0 };
  mixPositions.spaceDelay = { x: layoutColumn("delay"), y: musicBusY, z: 0 };
  mixPositions.airRoom = { x: layoutColumn("room"), y: musicBusY, z: 0 };
  mixPositions.masterGlue = { x: layoutColumn("master"), y: masterY, z: 0 };

  return {
    columns: layoutColumns,
    settings: layoutSettings,
    instruments: instrumentPositions,
    mix: mixPositions,
    output: { x: layoutColumn("output"), y: masterY, z: 0 },
  };
}

const NOTE = Object.freeze({
  c2: 36,
  d2: 38,
  eb2: 39,
  f2: 41,
  g2: 43,
  bb2: 46,
  c3: 48,
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
});

function outputPathForTheme(theme) {
  return join(OUTPUT_DIR, `${theme.id}.sunvox`);
}

function summaryPathForTheme(theme) {
  return join(SUMMARY_DIR, `${theme.id}.summary.json`);
}

function instrumentVolumesForTheme(theme) {
  return Object.fromEntries(
    instruments.map((instrument) => [instrument.id, theme.instrumentVolumes?.[instrument.id] ?? instrument.volume]),
  );
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
  const indexes = controllerIndexes[type];
  if (!indexes) {
    throw new Error(`Missing controller map for ${type}`);
  }
  for (const [name, value] of Object.entries(controllers)) {
    const controllerIndex = indexes[name];
    if (controllerIndex === undefined) {
      throw new Error(`Missing controller index for ${type}.${name}`);
    }
    assertSunVoxOk(
      module._sv_set_module_ctl_value(slot, moduleIndex, controllerIndex, value, 0),
      `${type}.${name} controller`,
    );
  }
}

function addMixGraph(module, slot, loaded, layout) {
  const mix = {};
  for (const spec of mixModules) {
    const position = layout.mix[spec.id];
    if (!position) {
      throw new Error(`Missing mix layout for ${spec.id}`);
    }
    const moduleIndex = createModule(module, slot, { ...spec, ...position });
    setModuleControllers(module, slot, moduleIndex, spec.type, spec.controllers);
    mix[spec.id] = moduleIndex;
  }

  const moduleIndexesByMixId = { ...loaded, ...mix, output: OUTPUT_MODULE };
  for (const [sourceId, destinationId] of mixConnections) {
    const source = moduleIndexesByMixId[sourceId];
    const destination = moduleIndexesByMixId[destinationId];
    if (source === undefined || destination === undefined) {
      throw new Error(`Missing mix connection endpoint: ${sourceId} -> ${destinationId}`);
    }
    connectModules(module, slot, source, destination, `${sourceId} -> ${destinationId}`);
  }

  return {
    modules: mixModules.map((spec) => ({
      id: spec.id,
      index: mix[spec.id],
      type: spec.type,
      name: spec.name,
      controllers: spec.controllers,
      position: layout.mix[spec.id],
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

function applySavedLayout(document, layout) {
  const outputModule = document.modules[OUTPUT_MODULE];
  if (!outputModule) {
    throw new Error("Missing output module for layout");
  }
  outputModule.position = withZ(layout.output);

  for (const instrument of instruments) {
    const savedModule = document.modules.find((entry) => entry.name === instrument.moduleName);
    if (!savedModule) {
      throw new Error(`Could not find module for layout ${instrument.id}`);
    }
    savedModule.position = withZ(layout.instruments[instrument.id]);
  }

  for (const spec of mixModules) {
    const savedModule = document.modules.find((entry) => entry.name === spec.name);
    if (!savedModule) {
      throw new Error(`Could not find mix module for layout ${spec.id}`);
    }
    savedModule.position = withZ(layout.mix[spec.id]);
  }
}

function note(module, slot, patternIndex, { line, track, midi, instrument, velocity = VELOCITY, length = 4 }) {
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

function addKickPattern(module, slot, patternIndex, kick) {
  for (let bar = 0; bar < 8; bar += 1) {
    const start = bar * 16;
    for (const line of [start, start + 8]) {
      note(module, slot, patternIndex, { line, track: 0, midi: NOTE.c3, instrument: kick, velocity: 122, length: 1 });
    }
    if (bar >= 2) {
      note(module, slot, patternIndex, { line: start + 14, track: 0, midi: NOTE.c3, instrument: kick, velocity: 72, length: 1 });
    }
    if (bar === 3 || bar === 7) {
      note(module, slot, patternIndex, { line: start + 6, track: 0, midi: NOTE.c3, instrument: kick, velocity: 54, length: 1 });
      note(module, slot, patternIndex, { line: start + 15, track: 0, midi: NOTE.c3, instrument: kick, velocity: 64, length: 1 });
    }
  }
}

function addBassPattern(module, slot, patternIndex, bass) {
  const roots = [NOTE.c2, NOTE.bb2, NOTE.eb2, NOTE.f2, NOTE.c2, NOTE.bb2, NOTE.g2, NOTE.f2];
  for (let bar = 0; bar < roots.length; bar += 1) {
    const start = bar * 16;
    const root = roots[bar];
    note(module, slot, patternIndex, { line: start, track: 1, midi: root, instrument: bass, velocity: 96, length: 6 });
    note(module, slot, patternIndex, { line: start + 6, track: 1, midi: root + 12, instrument: bass, velocity: 78, length: 2 });
    note(module, slot, patternIndex, { line: start + 8, track: 1, midi: root, instrument: bass, velocity: 90, length: 4 });
    note(module, slot, patternIndex, { line: start + 12, track: 1, midi: root + 7, instrument: bass, velocity: 74, length: 3 });
    if (bar === 3 || bar === 7) {
      note(module, slot, patternIndex, { line: start + 14, track: 1, midi: root + 10, instrument: bass, velocity: 72, length: 1 });
      note(module, slot, patternIndex, { line: start + 15, track: 1, midi: root + 12, instrument: bass, velocity: 76, length: 1 });
    }
    if (bar === 5) {
      note(module, slot, patternIndex, { line: start + 10, track: 1, midi: root + 5, instrument: bass, velocity: 66, length: 2 });
    }
  }
}

function addPadPattern(module, slot, patternIndex, pad) {
  const chords = [
    [NOTE.c4, NOTE.eb4, NOTE.g4],
    [NOTE.bb3, NOTE.d4, NOTE.f4],
    [NOTE.eb4, NOTE.g4, NOTE.bb4],
    [NOTE.f4, NOTE.g4, NOTE.c5],
  ];
  for (let section = 0; section < 2; section += 1) {
    for (let chordIndex = 0; chordIndex < chords.length; chordIndex += 1) {
      const line = section * 64 + chordIndex * 16;
      chords[chordIndex].forEach((midi, offset) => {
        note(module, slot, patternIndex, {
          line,
          track: 2 + offset,
          midi,
          instrument: pad,
          velocity: section === 0 ? 54 : 62,
          length: 15,
        });
      });
    }
  }
}

function addBellHook(module, slot, patternIndex, bell) {
  const hook = [
    [0, NOTE.g4],
    [3, NOTE.bb4],
    [6, NOTE.c5],
    [10, NOTE.g4],
    [16, NOTE.f4],
    [19, NOTE.g4],
    [22, NOTE.bb4],
    [28, NOTE.c5],
  ];
  for (let repeat = 0; repeat < 4; repeat += 1) {
    const offset = repeat * 32;
    for (const [line, midi] of hook) {
      note(module, slot, patternIndex, {
        line: offset + line,
        track: 5,
        midi,
        instrument: bell,
        velocity: repeat === 0 && line === 0 ? 118 : 82,
        length: 3,
      });
    }
  }
}

function addBellResponse(module, slot, patternIndex, bell) {
  const response = [
    [76, NOTE.d5],
    [80, NOTE.c5],
    [92, NOTE.bb4],
    [96, NOTE.c5],
    [108, NOTE.g4],
    [111, NOTE.bb4],
    [124, NOTE.c5],
  ];
  for (const [line, midi] of response) {
    note(module, slot, patternIndex, {
      line,
      track: 7,
      midi,
      instrument: bell,
      velocity: line >= 124 ? 106 : 74,
      length: line >= 124 ? 5 : 3,
    });
  }
}

function addPluckArp(module, slot, patternIndex, pluck) {
  const arps = [
    [NOTE.c4, NOTE.eb4, NOTE.g4, NOTE.bb4],
    [NOTE.bb3, NOTE.d4, NOTE.f4, NOTE.g4],
    [NOTE.eb4, NOTE.g4, NOTE.bb4, NOTE.d5],
    [NOTE.f4, NOTE.g4, NOTE.c5, NOTE.eb5],
  ];
  for (let bar = 4; bar < 8; bar += 1) {
    const start = bar * 16;
    const arp = arps[bar % arps.length];
    for (let step = 0; step < 8; step += 1) {
      const line = start + step * 2 + (bar === 7 && step > 4 ? -1 : 0);
      if (line < start || line >= start + 16) {
        continue;
      }
      note(module, slot, patternIndex, {
        line,
        track: 6,
        midi: arp[step % arp.length],
        instrument: pluck,
        velocity: bar === 7 ? 68 : 58,
        length: 1,
      });
    }
  }
}

function addTinesSparkles(module, slot, patternIndex, tines) {
  const phrases = [
    [12, NOTE.d5, 50, 2],
    [14, NOTE.g5, 56, 2],
    [29, NOTE.c5, 48, 2],
    [31, NOTE.d5, 54, 2],
    [58, NOTE.bb4, 48, 1],
    [60, NOTE.c5, 52, 1],
    [62, NOTE.d5, 56, 1],
    [63, NOTE.eb5, 60, 1],
    [76, NOTE.g5, 52, 2],
    [82, NOTE.f5, 46, 2],
    [94, NOTE.d5, 50, 2],
    [98, NOTE.c5, 46, 2],
    [110, NOTE.eb5, 50, 2],
    [116, NOTE.f5, 54, 2],
    [120, NOTE.c5, 52, 1],
    [122, NOTE.d5, 56, 1],
    [124, NOTE.eb5, 62, 1],
    [126, NOTE.g5, 66, 2],
  ];
  for (const [line, midi, velocity, length] of phrases) {
    note(module, slot, patternIndex, {
      line,
      track: 8,
      midi,
      instrument: tines,
      velocity,
      length,
    });
  }
}

function addOrganStabs(module, slot, patternIndex, organ) {
  const stabs = [
    [32, [NOTE.c4, NOTE.eb4, NOTE.g4], 70, 4],
    [40, [NOTE.bb3, NOTE.d4, NOTE.f4], 66, 3],
    [72, [NOTE.eb4, NOTE.g4, NOTE.bb4], 64, 3],
    [88, [NOTE.f4, NOTE.g4, NOTE.c5], 68, 4],
    [104, [NOTE.c4, NOTE.eb4, NOTE.g4], 68, 3],
    [112, [NOTE.f4, NOTE.g4, NOTE.c5], 76, 5],
    [124, [NOTE.bb3, NOTE.d4, NOTE.g4], 72, 3],
  ];
  for (const [line, chord, velocity, length] of stabs) {
    chord.forEach((midi, offset) => {
      note(module, slot, patternIndex, {
        line,
        track: 9 + offset,
        midi,
        instrument: organ,
        velocity,
        length,
      });
    });
  }
}

function addFirstHookArrangement({ module, slot, patternIndex, loaded }) {
  addKickPattern(module, slot, patternIndex, loaded.kick);
  addBassPattern(module, slot, patternIndex, loaded.bass);
  addPadPattern(module, slot, patternIndex, loaded.pad);
  addBellHook(module, slot, patternIndex, loaded.bell);
  addBellResponse(module, slot, patternIndex, loaded.bell);
  addPluckArp(module, slot, patternIndex, loaded.pluck);
  addTinesSparkles(module, slot, patternIndex, loaded.tines);
  addOrganStabs(module, slot, patternIndex, loaded.organ);
}

function addSoftKickPattern(module, slot, patternIndex, kick) {
  for (let bar = 0; bar < 8; bar += 1) {
    const start = bar * 16;
    note(module, slot, patternIndex, { line: start, track: 0, midi: NOTE.c3, instrument: kick, velocity: 96, length: 1 });
    if (bar % 2 === 1) {
      note(module, slot, patternIndex, { line: start + 10, track: 0, midi: NOTE.c3, instrument: kick, velocity: 54, length: 1 });
    }
    if (bar === 3 || bar === 7) {
      note(module, slot, patternIndex, { line: start + 14, track: 0, midi: NOTE.c3, instrument: kick, velocity: 58, length: 1 });
    }
  }
}

function addLofiBassPattern(module, slot, patternIndex, bass) {
  const roots = [NOTE.c2, NOTE.c2, NOTE.bb2, NOTE.bb2, NOTE.eb2, NOTE.eb2, NOTE.f2, NOTE.g2];
  for (let bar = 0; bar < roots.length; bar += 1) {
    const start = bar * 16;
    const root = roots[bar];
    note(module, slot, patternIndex, { line: start + 2, track: 1, midi: root, instrument: bass, velocity: 72, length: 5 });
    note(module, slot, patternIndex, { line: start + 10, track: 1, midi: root + 7, instrument: bass, velocity: 60, length: 3 });
    if (bar >= 4) {
      note(module, slot, patternIndex, { line: start + 14, track: 1, midi: root + 12, instrument: bass, velocity: 54, length: 1 });
    }
  }
}

function addLofiPadBed(module, slot, patternIndex, pad) {
  const chords = [
    [NOTE.c4, NOTE.eb4, NOTE.g4],
    [NOTE.bb3, NOTE.d4, NOTE.f4],
    [NOTE.eb4, NOTE.g4, NOTE.bb4],
    [NOTE.f4, NOTE.g4, NOTE.c5],
  ];
  for (let chordIndex = 0; chordIndex < chords.length; chordIndex += 1) {
    const line = chordIndex * 32;
    chords[chordIndex].forEach((midi, offset) => {
      note(module, slot, patternIndex, {
        line,
        track: 2 + offset,
        midi,
        instrument: pad,
        velocity: chordIndex < 2 ? 50 : 58,
        length: 29,
      });
    });
  }
}

function addLofiBellMotif(module, slot, patternIndex, bell) {
  const motif = [
    [0, NOTE.g4, 108, 4],
    [18, NOTE.c5, 66, 3],
    [34, NOTE.bb4, 62, 3],
    [50, NOTE.g4, 58, 3],
    [66, NOTE.d5, 68, 3],
    [82, NOTE.c5, 60, 3],
    [110, NOTE.bb4, 64, 3],
    [124, NOTE.c5, 86, 4],
  ];
  for (const [line, midi, velocity, length] of motif) {
    note(module, slot, patternIndex, { line, track: 5, midi, instrument: bell, velocity, length });
  }
}

function addLofiPluckTexture(module, slot, patternIndex, pluck) {
  const notes = [NOTE.c4, NOTE.g4, NOTE.bb4, NOTE.eb5];
  for (let bar = 2; bar < 8; bar += 1) {
    const start = bar * 16;
    for (const step of [4, 12]) {
      note(module, slot, patternIndex, {
        line: start + step,
        track: 6,
        midi: notes[(bar + step) % notes.length],
        instrument: pluck,
        velocity: bar >= 6 ? 52 : 44,
        length: 2,
      });
    }
  }
}

function addLofiTinesDust(module, slot, patternIndex, tines) {
  const dust = [
    [14, NOTE.d5, 42],
    [30, NOTE.g5, 46],
    [62, NOTE.c5, 42],
    [78, NOTE.eb5, 48],
    [94, NOTE.d5, 44],
    [118, NOTE.f5, 52],
    [126, NOTE.g5, 58],
  ];
  for (const [line, midi, velocity] of dust) {
    note(module, slot, patternIndex, { line, track: 8, midi, instrument: tines, velocity, length: 2 });
  }
}

function addLofiOrganBed(module, slot, patternIndex, organ) {
  const stabs = [
    [24, [NOTE.c4, NOTE.eb4, NOTE.g4], 54, 8],
    [56, [NOTE.bb3, NOTE.d4, NOTE.f4], 52, 8],
    [88, [NOTE.eb4, NOTE.g4, NOTE.bb4], 56, 8],
    [120, [NOTE.f4, NOTE.g4, NOTE.c5], 60, 6],
  ];
  for (const [line, chord, velocity, length] of stabs) {
    chord.forEach((midi, offset) => {
      note(module, slot, patternIndex, { line, track: 9 + offset, midi, instrument: organ, velocity, length });
    });
  }
}

function addNarrationLofiArrangement({ module, slot, patternIndex, loaded }) {
  addSoftKickPattern(module, slot, patternIndex, loaded.kick);
  addLofiBassPattern(module, slot, patternIndex, loaded.bass);
  addLofiPadBed(module, slot, patternIndex, loaded.pad);
  addLofiBellMotif(module, slot, patternIndex, loaded.bell);
  addLofiPluckTexture(module, slot, patternIndex, loaded.pluck);
  addLofiTinesDust(module, slot, patternIndex, loaded.tines);
  addLofiOrganBed(module, slot, patternIndex, loaded.organ);
}

function addTechKickPattern(module, slot, patternIndex, kick) {
  for (let bar = 0; bar < 8; bar += 1) {
    const start = bar * 16;
    for (const line of [start, start + 8]) {
      note(module, slot, patternIndex, { line, track: 0, midi: NOTE.c3, instrument: kick, velocity: 120, length: 1 });
    }
    if (bar >= 2) {
      note(module, slot, patternIndex, { line: start + 12, track: 0, midi: NOTE.c3, instrument: kick, velocity: 70, length: 1 });
    }
    if (bar === 7) {
      note(module, slot, patternIndex, { line: start + 14, track: 0, midi: NOTE.c3, instrument: kick, velocity: 82, length: 1 });
      note(module, slot, patternIndex, { line: start + 15, track: 0, midi: NOTE.c3, instrument: kick, velocity: 72, length: 1 });
    }
  }
}

function addTechBassPattern(module, slot, patternIndex, bass) {
  const roots = [NOTE.c2, NOTE.bb2, NOTE.eb2, NOTE.f2, NOTE.c2, NOTE.bb2, NOTE.g2, NOTE.f2];
  const offsets = [0, 3, 6, 8, 11, 14];
  for (let bar = 0; bar < roots.length; bar += 1) {
    const start = bar * 16;
    const root = roots[bar];
    offsets.forEach((offset, index) => {
      const midi = index % 3 === 2 ? root + 12 : index % 2 === 1 ? root + 7 : root;
      note(module, slot, patternIndex, {
        line: start + offset,
        track: 1,
        midi,
        instrument: bass,
        velocity: offset === 0 ? 84 : 68,
        length: offset === 0 ? 2 : 1,
      });
    });
  }
}

function addTechPadPulses(module, slot, patternIndex, pad) {
  const chords = [
    [NOTE.c4, NOTE.eb4, NOTE.g4],
    [NOTE.bb3, NOTE.d4, NOTE.f4],
    [NOTE.eb4, NOTE.g4, NOTE.bb4],
    [NOTE.f4, NOTE.g4, NOTE.c5],
  ];
  for (let bar = 0; bar < 8; bar += 1) {
    const line = bar * 16;
    const chord = chords[bar % chords.length];
    chord.forEach((midi, offset) => {
      note(module, slot, patternIndex, {
        line,
        track: 2 + offset,
        midi,
        instrument: pad,
        velocity: bar >= 4 ? 56 : 48,
        length: 7,
      });
    });
  }
}

function addTechBellHook(module, slot, patternIndex, bell) {
  const hook = [
    [0, NOTE.c5, 116],
    [2, NOTE.g5, 92],
    [4, NOTE.eb5, 86],
    [8, NOTE.c5, 78],
    [16, NOTE.bb4, 76],
    [18, NOTE.c5, 82],
    [24, NOTE.g4, 72],
    [32, NOTE.c5, 90],
    [48, NOTE.d5, 78],
    [64, NOTE.eb5, 86],
    [80, NOTE.c5, 78],
    [96, NOTE.g5, 84],
    [112, NOTE.d5, 88],
    [124, NOTE.c5, 108],
  ];
  for (const [line, midi, velocity] of hook) {
    note(module, slot, patternIndex, { line, track: 5, midi, instrument: bell, velocity, length: 2 });
  }
}

function addTechPluckPulse(module, slot, patternIndex, pluck) {
  const arps = [
    [NOTE.c4, NOTE.eb4, NOTE.g4, NOTE.c5],
    [NOTE.bb3, NOTE.d4, NOTE.f4, NOTE.bb4],
    [NOTE.eb4, NOTE.g4, NOTE.bb4, NOTE.eb5],
    [NOTE.f4, NOTE.g4, NOTE.c5, NOTE.f5],
  ];
  for (let bar = 0; bar < 8; bar += 1) {
    const arp = arps[bar % arps.length];
    const start = bar * 16;
    for (let step = 0; step < 8; step += 1) {
      note(module, slot, patternIndex, {
        line: start + step * 2 + 1,
        track: 6,
        midi: arp[step % arp.length],
        instrument: pluck,
        velocity: bar >= 4 ? 58 : 50,
        length: 1,
      });
    }
  }
}

function addTechTinesRiser(module, slot, patternIndex, tines) {
  const riser = [
    [28, NOTE.g5, 48],
    [60, NOTE.f5, 50],
    [92, NOTE.g5, 52],
    [112, NOTE.c5, 52],
    [114, NOTE.d5, 54],
    [116, NOTE.eb5, 58],
    [118, NOTE.f5, 60],
    [120, NOTE.g5, 64],
    [122, NOTE.f5, 62],
    [124, NOTE.eb5, 66],
    [126, NOTE.g5, 72],
  ];
  for (const [line, midi, velocity] of riser) {
    note(module, slot, patternIndex, { line, track: 8, midi, instrument: tines, velocity, length: 1 });
  }
}

function addTechOrganHits(module, slot, patternIndex, organ) {
  const hits = [
    [16, [NOTE.c4, NOTE.eb4, NOTE.g4], 58, 3],
    [40, [NOTE.bb3, NOTE.d4, NOTE.f4], 62, 3],
    [72, [NOTE.eb4, NOTE.g4, NOTE.bb4], 64, 3],
    [104, [NOTE.f4, NOTE.g4, NOTE.c5], 68, 4],
    [120, [NOTE.c4, NOTE.eb4, NOTE.g4], 72, 5],
  ];
  for (const [line, chord, velocity, length] of hits) {
    chord.forEach((midi, offset) => {
      note(module, slot, patternIndex, { line, track: 9 + offset, midi, instrument: organ, velocity, length });
    });
  }
}

function addTechDemoStingerArrangement({ module, slot, patternIndex, loaded }) {
  addTechKickPattern(module, slot, patternIndex, loaded.kick);
  addTechBassPattern(module, slot, patternIndex, loaded.bass);
  addTechPadPulses(module, slot, patternIndex, loaded.pad);
  addTechBellHook(module, slot, patternIndex, loaded.bell);
  addTechPluckPulse(module, slot, patternIndex, loaded.pluck);
  addTechTinesRiser(module, slot, patternIndex, loaded.tines);
  addTechOrganHits(module, slot, patternIndex, loaded.organ);
}

function summarizeAudio(samples, channels) {
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
  const stereo = summarizeStereo(samples, channels);
  return {
    channels,
    frames: samples.length / channels,
    peak,
    rms,
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

function setRuntimeVolumes(module, slot, moduleIndexesById, volumesById) {
  for (const instrument of instruments) {
    const moduleIndex = moduleIndexesById[instrument.id];
    if (moduleIndex === undefined) {
      throw new Error(`Missing runtime module index for ${instrument.id}`);
    }
    const volume = volumesById[instrument.id] ?? instrument.volume;
    assertSunVoxOk(
      module._sv_set_module_ctl_value(slot, moduleIndex, 0, volume, 0),
      `${instrument.id} runtime volume`,
    );
  }
}

function renderProjectPass(
  module,
  { slot, sampleRate, channels, projectBytes, moduleIndexesById, volumesById, renderSeconds = RENDER_SECONDS },
) {
  loadProjectFromBuffer(module, projectBytes, { slot });
  setRuntimeVolumes(module, slot, moduleIndexesById, volumesById);
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
  return summarizeAudio(rendered.samples, channels);
}

function analyzePartBalance(mix, partSummaries) {
  const maxRms = Math.max(...partSummaries.map((part) => part.audio.rms));
  return {
    maxPartRms: maxRms,
    parts: partSummaries.map((part) => {
      const rmsRelativeToMaxPart = maxRms > 0 ? part.audio.rms / maxRms : 0;
      const rmsRelativeToMix = mix.rms > 0 ? part.audio.rms / mix.rms : 0;
      const status =
        rmsRelativeToMaxPart < 0.35 ? "quiet" : rmsRelativeToMaxPart > 0.9 ? "dominant" : "present";
      return {
        id: part.id,
        status,
        rmsRelativeToMaxPart,
        rmsRelativeToMix,
        peak: part.audio.peak,
        rms: part.audio.rms,
      };
    }),
  };
}

async function buildThemeProject(theme) {
  const instrumentVolumes = instrumentVolumesForTheme(theme);

  return withSunVoxSlot(
    { flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS, sampleRate: SAMPLE_RATE, channels: CHANNELS },
    async ({ module, slot }) => {
      setSongName(module, slot, theme.songName);

      const nodeLayout = computeNodeLayout();
      const loaded = {};
      for (const instrument of instruments) {
        const bytes = await readSunsynthForMusic(instrument.path, { rootVolume: instrument.musicRootVolume });
        const position = nodeLayout.instruments[instrument.id];
        loaded[instrument.id] = loadSynthModuleFromBuffer(module, bytes, {
          slot,
          ...position,
          connectToOutput: false,
        });
      }
      const mixGraph = addMixGraph(module, slot, loaded, nodeLayout);

      const patternIndex = createPattern(module, {
        slot,
        tracks: TRACKS,
        lines: LINES,
        name: theme.patternName,
        iconSeed: theme.iconSeed,
      });
      theme.buildArrangement({ module, slot, patternIndex, loaded });

      const document = parseContainer(saveSlotToMemory(module, slot));
      document.project.bpm = theme.bpm;
      applyDeterministicPatternIcons(document, theme);
      applySavedLayout(document, nodeLayout);
      for (const instrument of instruments) {
        const savedModule = document.modules.find((entry) => entry.name === instrument.moduleName);
        if (!savedModule?.controllers || Array.isArray(savedModule.controllers)) {
          throw new Error(`Could not find controllers for ${instrument.id}`);
        }
        savedModule.controllers.volume = instrumentVolumes[instrument.id];
      }
      for (const spec of mixModules) {
        const savedModule = document.modules.find((entry) => entry.name === spec.name);
        if (!savedModule?.controllers || Array.isArray(savedModule.controllers)) {
          throw new Error(`Could not find controllers for mix module ${spec.id}`);
        }
        Object.assign(savedModule.controllers, spec.controllers);
      }
      return { document, mixGraph };
    },
  );
}

async function buildThemeDocument(theme) {
  return (await buildThemeProject(theme)).document;
}

/** @satisfies {import("../../../tools/sunvox-music-recipe.d.ts").SunVoxMusicRecipe} */
export const recipe = {
  schemaVersion: 1,
  tags: ["research:short-video-bgm", "research:generated-music"],
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
  const instrumentVolumes = instrumentVolumesForTheme(theme);

  const summary = await withSunVoxSlot(
    { flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS, sampleRate: SAMPLE_RATE, channels: CHANNELS },
    async ({ module, slot, sampleRate, channels }) => {
      setSongName(module, slot, theme.songName);

      const nodeLayout = computeNodeLayout();
      const loaded = {};
      for (const instrument of instruments) {
        const bytes = await readSunsynthForMusic(instrument.path, { rootVolume: instrument.musicRootVolume });
        const position = nodeLayout.instruments[instrument.id];
        loaded[instrument.id] = loadSynthModuleFromBuffer(module, bytes, {
          slot,
          ...position,
          connectToOutput: false,
        });
      }
      const mixGraph = addMixGraph(module, slot, loaded, nodeLayout);

      const patternIndex = createPattern(module, {
        slot,
        tracks: TRACKS,
        lines: LINES,
        name: theme.patternName,
        iconSeed: theme.iconSeed,
      });
      theme.buildArrangement({ module, slot, patternIndex, loaded });

      const document = parseContainer(saveSlotToMemory(module, slot));
      document.project.bpm = theme.bpm;
      applyDeterministicPatternIcons(document, theme);
      applySavedLayout(document, nodeLayout);
      for (const instrument of instruments) {
        const savedModule = document.modules.find((entry) => entry.name === instrument.moduleName);
        if (!savedModule?.controllers || Array.isArray(savedModule.controllers)) {
          throw new Error(`Could not find controllers for ${instrument.id}`);
        }
        savedModule.controllers.volume = instrumentVolumes[instrument.id];
      }
      for (const spec of mixModules) {
        const savedModule = document.modules.find((entry) => entry.name === spec.name);
        if (!savedModule?.controllers || Array.isArray(savedModule.controllers)) {
          throw new Error(`Could not find controllers for mix module ${spec.id}`);
        }
        Object.assign(savedModule.controllers, spec.controllers);
      }
      const projectBytes = buildContainer(document);
      await writeFile(outputPath, projectBytes);

      const parsed = parseContainer(projectBytes);
      const moduleIndexesById = {};
      for (const instrument of instruments) {
        const moduleIndex = parsed.modules.findIndex((entry) => entry.name === instrument.moduleName);
        if (moduleIndex < 0) {
          throw new Error(`Missing saved module for ${instrument.id}: ${instrument.moduleName}`);
        }
        moduleIndexesById[instrument.id] = moduleIndex;
      }
      const mixAudio = renderProjectPass(module, {
        slot,
        sampleRate,
        channels,
        projectBytes,
        moduleIndexesById,
        volumesById: instrumentVolumes,
      });
      const partSummaries = instruments.map((instrument) => ({
        id: instrument.id,
        moduleName: instrument.moduleName,
        volume: instrumentVolumes[instrument.id],
        audio: renderProjectPass(module, {
          slot,
          sampleRate,
          channels,
          projectBytes,
          moduleIndexesById,
          volumesById: Object.fromEntries(
            instruments.map((candidate) => [
              candidate.id,
              candidate.id === instrument.id ? instrumentVolumes[instrument.id] : 0,
            ]),
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

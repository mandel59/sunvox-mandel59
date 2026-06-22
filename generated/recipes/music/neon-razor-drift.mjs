#!/usr/bin/env node
// @ts-check

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildContainer, TEXT_FORMAT } from "../../../tools/sunvox-codec.mjs";
import { deterministicIconBase64 } from "../../../tools/sunvox-music-recipe-helpers.mjs";

const PROJECT_PATH = "generated/music/neon-razor-drift.sunvox";
const SUMMARY_PATH = "var/music-recipe/neon-razor-drift.summary.json";
const BPM = 146;
const SPEED = 6;
const LINES = 128;

const MODULE = Object.freeze({
  output: 0,
  kick: 1,
  drums: 2,
  bass: 3,
  bassDrive: 4,
  bassFilter: 5,
  lead: 6,
  leadEcho: 7,
  pad: 8,
  bell: 9,
  noise: 10,
  musicBus: 11,
  room: 12,
  master: 13,
});

const TRACK = Object.freeze({
  kick: 0,
  drums: 1,
  bass: 2,
  bassAlt: 3,
  leadA: 4,
  leadB: 5,
  padA: 6,
  padB: 7,
  padC: 8,
  bell: 9,
  noise: 10,
  autoA: 11,
  autoB: 12,
  autoC: 13,
  padD: 14,
  counter: 15,
});

const SEMITONE_TO_NAME = Object.freeze(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]);
const NOTE_TO_SEMITONE = new Map(SEMITONE_TO_NAME.map((name, index) => [name, index]));

const harmony = Object.freeze([
  {
    root: "C2",
    symbol: "i(add9)",
    bassIntervals: [0, 7, 12, 0, 10, 7, 14],
    pad: ["C4", "D#4", "G4", "D5"],
    lead: ["G5", "D#5", "A#5", "C6", "G5", "D6"],
  },
  {
    root: "G#1",
    symbol: "VImaj7",
    bassIntervals: [0, 7, 12, 4, 11, 7, 12],
    pad: ["C4", "D#4", "G4", "G#4"],
    lead: ["C6", "D#6", "G5", "G#5", "D#6", "C6"],
  },
  {
    root: "D#2",
    symbol: "IIIadd9",
    bassIntervals: [0, 7, 12, 4, 14, 7, 12],
    pad: ["A#3", "D#4", "G4", "F5"],
    lead: ["A#5", "G5", "F6", "D#6", "D6", "A#5"],
  },
  {
    root: "A#1",
    symbol: "VIIadd11",
    bassIntervals: [0, 7, 12, 4, 17, 7, 12],
    pad: ["A#3", "D4", "F4", "D#5"],
    lead: ["F5", "D5", "D#6", "F6", "A#5", "D6"],
  },
  {
    root: "F1",
    symbol: "iv7",
    bassIntervals: [0, 7, 12, 3, 10, 7, 12],
    pad: ["C4", "D#4", "F4", "G#4"],
    lead: ["G#5", "F5", "C6", "D#6", "C6", "G#5"],
  },
  {
    root: "G#1",
    symbol: "VImaj7",
    bassIntervals: [0, 7, 12, 4, 11, 7, 12],
    pad: ["C4", "D#4", "G4", "G#4"],
    lead: ["C6", "G5", "D#6", "C6", "G#5", "G5"],
  },
  {
    root: "G1",
    symbol: "V7(b9)",
    bassIntervals: [0, 7, 12, 4, 10, 7, 13],
    pad: ["B3", "D4", "F4", "G#4"],
    lead: ["B5", "D6", "F6", "G#6", "G6", "D6"],
  },
  {
    root: "C2",
    symbol: "i(add9)",
    bassIntervals: [0, 7, 12, 3, 14, 7, 12],
    pad: ["C4", "D#4", "G4", "D5"],
    lead: ["C6", "G5", "D#6", "D6", "C6", "G5"],
  },
]);

function analog(overrides = {}) {
  return {
    volume: 88,
    waveform: "saw",
    panning: 128,
    attack: 0,
    release: 56,
    sustain: "on",
    expEnvelope: "on",
    dutyCycle: 512,
    osc2Pitch: 1000,
    filter: "lp24db",
    filterFreq: 9000,
    filterResonance: 160,
    filterExpFreq: "on",
    filterAttack: 0,
    filterRelease: 0,
    filterEnvelope: "off",
    polyphony: 4,
    mode: "hq",
    noise: 0,
    osc2Volume: 4200,
    osc2Mode: "add",
    osc2Phase: 0,
    ...overrides,
  };
}

function modules() {
  return [
    {
      flags: { exists: true, output: true },
      name: "Output",
      position: { x: 1460, y: 420, z: 0 },
      inputs: [{ slot: 0, module: MODULE.master }],
    },
    {
      type: "Kicker",
      name: "Neon Kick",
      color: "#ff385f",
      position: { x: 96, y: 144, z: 0 },
      controllers: {
        volume: 38,
        waveform: "sin",
        panning: 128,
        attack: 0,
        release: 28,
        boost: 310,
        acceleration: 360,
        polyphony: 1,
        noClick: "off",
      },
    },
    {
      type: "DrumSynth",
      name: "Razor Drums",
      color: "#00c2ff",
      position: { x: 96, y: 260, z: 0 },
      controllers: {
        volume: 210,
        panning: 128,
        polyphony: 8,
        bassVolume: 46,
        bassPower: 150,
        bassTone: 54,
        bassLength: 36,
        hihatVolume: 310,
        hihatLength: 26,
        snareVolume: 236,
        snareTone: 176,
        snareLength: 42,
        bassPan: 128,
        hihatPan: 182,
        snarePan: 98,
      },
    },
    {
      type: "Analog generator",
      name: "Reese Bass",
      color: "#70ff44",
      position: { x: 96, y: 420, z: 0 },
      controllers: analog({
        volume: 138,
        waveform: "saw",
        panning: 128,
        release: 44,
        polyphony: 1,
        mode: "hqMono",
        dutyCycle: 444,
        osc2Pitch: 497,
        osc2Volume: 7200,
        osc2Mode: "add",
        filter: "lp24db",
        filterFreq: 5200,
        filterResonance: 520,
      }),
    },
    {
      type: "Distortion",
      name: "Bass Drive",
      color: "#ff9f1a",
      position: { x: 340, y: 420, z: 0 },
      inputs: [{ slot: 0, module: MODULE.bass }],
      controllers: { volume: 176, type: "saturation5", power: 54, bitDepth: 16, freq: 44100, noise: 0 },
    },
    {
      type: "Filter Pro",
      name: "Bass Razor Filter",
      color: "#7fb5ff",
      position: { x: 580, y: 420, z: 0 },
      inputs: [{ slot: 0, module: MODULE.bassDrive }],
      controllers: {
        volume: 32768,
        type: "lp",
        freq: 3800,
        freqFinetune: 1000,
        freqScale: 100,
        expFreq: "on",
        q: 15200,
        gain: 16384,
        rolloff: "db36",
        response: 180,
        mode: "stereoSmoothing",
        mix: 32768,
        lfoFreq: 12,
        lfoAmp: 2400,
        lfoWaveform: "saw2",
        setLfoPhase: 0,
        lfoFreqUnit: "line",
      },
    },
    {
      type: "Analog generator",
      name: "Laser Lead",
      color: "#d24dff",
      position: { x: 96, y: 600, z: 0 },
      controllers: analog({
        volume: 96,
        waveform: "hsin",
        panning: 102,
        release: 62,
        polyphony: 2,
        dutyCycle: 560,
        osc2Pitch: 1207,
        osc2Volume: 11200,
        osc2Mode: "maxAbs",
        filter: "bp12db",
        filterFreq: 10800,
        filterResonance: 340,
      }),
    },
    {
      type: "Echo",
      name: "Lead Echo",
      color: "#ffa37f",
      position: { x: 340, y: 600, z: 0 },
      inputs: [{ slot: 0, module: MODULE.lead }],
      controllers: {
        dry: 256,
        wet: 52,
        feedback: 118,
        delay: 5,
        rightChannelOffset: "on",
        delayUnit: "line",
        rightChannelOffsetValue: 18800,
        filter: "lp6db",
        filterFreq: 6900,
      },
    },
    {
      type: "Analog generator",
      name: "Chrome Pad",
      color: "#3be0c3",
      position: { x: 96, y: 760, z: 0 },
      controllers: analog({
        volume: 72,
        waveform: "triangle",
        panning: 154,
        attack: 18,
        release: 120,
        polyphony: 8,
        dutyCycle: 520,
        osc2Pitch: 1007,
        osc2Volume: 9200,
        osc2Mode: "add",
        filter: "lp12db",
        filterFreq: 6200,
        filterResonance: 140,
        filterAttack: 10,
        filterRelease: 120,
        filterEnvelope: "sustainOn",
      }),
    },
    {
      type: "Analog generator",
      name: "Glass Bell",
      color: "#fff06b",
      position: { x: 96, y: 920, z: 0 },
      controllers: analog({
        volume: 84,
        waveform: "sin",
        panning: 178,
        attack: 0,
        release: 96,
        sustain: "off",
        polyphony: 6,
        osc2Pitch: 1500,
        osc2Volume: 13800,
        osc2Mode: "mul",
        filter: "off",
      }),
    },
    {
      type: "Analog generator",
      name: "Violet Riser",
      color: "#9a7cff",
      position: { x: 96, y: 1060, z: 0 },
      controllers: analog({
        volume: 58,
        waveform: "violetNoise",
        panning: 88,
        release: 92,
        sustain: "off",
        polyphony: 3,
        filter: "hp12db",
        filterFreq: 7600,
        filterResonance: 520,
        noise: 160,
        osc2Volume: 0,
      }),
    },
    {
      type: "Amplifier",
      name: "Music Wide Bus",
      color: "#d6d8d8",
      position: { x: 820, y: 760, z: 0 },
      inputs: [
        { slot: 0, module: MODULE.leadEcho },
        { slot: 1, module: MODULE.pad },
        { slot: 2, module: MODULE.bell },
        { slot: 3, module: MODULE.noise },
      ],
      controllers: {
        volume: 284,
        balance: 128,
        dcOffset: 128,
        inverse: "off",
        stereoWidth: 230,
        absolute: "off",
        fineVolume: 32768,
        gain: 1,
        bipolarDcOffset: 16384,
      },
    },
    {
      type: "Reverb",
      name: "Chrome Room",
      color: "#ffd37f",
      position: { x: 1060, y: 760, z: 0 },
      inputs: [{ slot: 0, module: MODULE.musicBus }],
      controllers: {
        dry: 246,
        wet: 34,
        feedback: 182,
        damp: 164,
        stereoWidth: 242,
        freeze: "off",
        mode: "hq",
        allpassFilter: "improved",
        roomSize: 22,
        randomSeed: 59,
      },
    },
    {
      type: "Compressor",
      name: "Neon Master Glue",
      color: "#ff3000",
      position: { x: 1240, y: 420, z: 0 },
      inputs: [
        { slot: 0, module: MODULE.kick },
        { slot: 1, module: MODULE.drums },
        { slot: 2, module: MODULE.bassFilter },
        { slot: 3, module: MODULE.room },
      ],
      controllers: {
        volume: 248,
        threshold: 318,
        slope: 86,
        attack: 5,
        release: 260,
        mode: "peak",
        sideChainInput: 0,
      },
    },
  ];
}

function eventKey(event) {
  return `${event.line}:${event.track}`;
}

function pushEvent(events, usedCells, event) {
  if (event.line < 0 || event.line >= LINES) {
    return;
  }
  const key = eventKey(event);
  if (usedCells.has(key)) {
    throw new Error(`Pattern cell already used: ${key}`);
  }
  usedCells.add(key);
  events.push(event);
}

function note(events, usedCells, { line, track, note: noteName, module, velocity = 108, gate = 2, effect, parameter }) {
  pushEvent(events, usedCells, {
    line,
    track,
    note: noteName,
    velocity,
    module,
    ...(effect ? { effect, parameter } : {}),
  });
  if (gate > 0 && line + gate < LINES) {
    pushEvent(events, usedCells, { line: line + gate, track, note: "noteOff", module });
  }
}

function controller(events, usedCells, { line, track, module, controller, parameter }) {
  pushEvent(events, usedCells, { line, track, module, controller, parameter });
}

function chord(events, usedCells, { line, tracks, notes, module, velocity = 56, gate = 14 }) {
  notes.forEach((noteName, index) => {
    note(events, usedCells, { line, track: tracks[index], note: noteName, module, velocity, gate });
  });
}

function parseNote(noteName) {
  const match = /^([A-G]#?)(-?\d+)$/u.exec(noteName);
  if (!match) {
    throw new Error(`Bad note: ${noteName}`);
  }
  const base = NOTE_TO_SEMITONE.get(match[1]);
  if (base === undefined) {
    throw new Error(`Bad note base: ${noteName}`);
  }
  return Number(match[2]) * 12 + base;
}

function formatNote(midiLike) {
  const semitone = ((midiLike % 12) + 12) % 12;
  const octave = Math.floor((midiLike - semitone) / 12);
  return `${SEMITONE_TO_NAME[semitone]}${octave}`;
}

function transpose(noteName, semitones) {
  return formatNote(parseNote(noteName) + semitones);
}

function addDrums(events, usedCells) {
  for (let bar = 0; bar < 8; bar += 1) {
    const line = bar * 16;
    for (const offset of [0, 4, 8, 12]) {
      note(events, usedCells, {
        line: line + offset,
        track: TRACK.kick,
        note: "C2",
        module: MODULE.kick,
        velocity: offset === 0 ? 124 : 108,
        gate: 1,
      });
    }
    if (bar === 3 || bar === 7) {
      note(events, usedCells, {
        line: line + 15,
        track: TRACK.kick,
        note: "C2",
        module: MODULE.kick,
        velocity: 72,
        gate: 0,
      });
    }

    for (const offset of [2, 6, 10, 14]) {
      note(events, usedCells, {
        line: line + offset,
        track: TRACK.drums,
        note: "D3",
        module: MODULE.drums,
        velocity: offset === 14 ? 70 : 58,
        gate: 0,
      });
    }
    for (const offset of [4, 12]) {
      note(events, usedCells, {
        line: line + offset,
        track: TRACK.drums,
        note: "D#3",
        module: MODULE.drums,
        velocity: bar >= 4 ? 82 : 74,
        gate: 0,
      });
    }
    if (bar >= 4) {
      note(events, usedCells, {
        line: line + 15,
        track: TRACK.drums,
        note: "D3",
        module: MODULE.drums,
        velocity: 46,
        gate: 0,
      });
    }
  }
}

function addBass(events, usedCells) {
  const motif = [
    [0, 0, 116, 2],
    [3, 1, 84, 2],
    [6, 2, 88, 1],
    [8, 3, 104, 1],
    [10, 4, 80, 2],
    [13, 5, 76, 1],
    [15, 6, 94, 1],
  ];

  for (let bar = 0; bar < harmony.length; bar += 1) {
    const chordTone = harmony[bar];
    const line = bar * 16;
    for (const [offset, intervalIndex, velocity, gate] of motif) {
      const add = chordTone.bassIntervals[intervalIndex];
      const track = offset === 15 ? TRACK.bassAlt : TRACK.bass;
      note(events, usedCells, {
        line: line + offset,
        track,
        note: transpose(chordTone.root, add),
        module: MODULE.bass,
        velocity,
        gate,
        ...(offset === 3 || offset === 10 ? { effect: "tonePortamento", parameter: { speed: offset === 3 ? 72 : 96 } } : {}),
      });
    }
  }
}

function addPads(events, usedCells) {
  for (let bar = 0; bar < harmony.length; bar += 1) {
    chord(events, usedCells, {
      line: bar * 16,
      tracks: [TRACK.padA, TRACK.padB, TRACK.padC, TRACK.padD],
      notes: harmony[bar].pad,
      module: MODULE.pad,
      velocity: bar >= 4 ? 58 : 48,
      gate: 13,
    });
  }
}

function addLead(events, usedCells) {
  const offsets = [0, 3, 6, 9, 12, 14];
  for (let bar = 0; bar < harmony.length; bar += 1) {
    const lineBase = bar * 16;
    harmony[bar].lead.forEach((noteName, index) => {
      note(events, usedCells, {
        line: lineBase + offsets[index],
        track: index % 2 === 0 ? TRACK.leadA : TRACK.leadB,
        note: noteName,
        module: MODULE.lead,
        velocity: bar === 0 && index === 0 ? 122 : bar >= 4 ? 78 : 68,
        gate: index === 5 ? 0 : index === 4 ? 1 : 2,
        ...(index === 1 || index === 3 ? { effect: "tonePortamento", parameter: { speed: bar === 6 ? 136 : 112 } } : {}),
      });
    });
  }

  for (const [line, track, effect, parameter] of [
    [15, TRACK.leadB, "pitchDown", { amount: 220 }],
    [47, TRACK.leadB, "vibrato", { speed: 7, amplitude: 22 }],
    [95, TRACK.leadB, "pitchUp", { amount: 260 }],
    [111, TRACK.leadB, "vibrato", { speed: 9, amplitude: 34 }],
  ]) {
    note(events, usedCells, {
      line,
      track,
      note: line === 111 ? "B5" : "D6",
      module: MODULE.lead,
      velocity: 62,
      gate: 0,
      effect,
      parameter,
    });
  }
}

function addAccents(events, usedCells) {
  for (const [line, noteName, velocity, gate] of [
    [0, "G6", 96, 3],
    [30, "C7", 62, 2],
    [62, "F6", 70, 2],
    [94, "G6", 66, 2],
    [110, "B6", 74, 2],
    [124, "C7", 108, 3],
  ]) {
    note(events, usedCells, { line, track: TRACK.bell, note: noteName, module: MODULE.bell, velocity, gate });
  }

  for (const [line, velocity, gate] of [
    [60, 38, 3],
    [92, 40, 3],
    [112, 48, 4],
    [120, 60, 3],
    [124, 76, 2],
  ]) {
    note(events, usedCells, { line, track: TRACK.noise, note: "C5", module: MODULE.noise, velocity, gate });
  }
}

function addAutomation(events, usedCells) {
  for (const [line, parameter] of [
    [0, 3000],
    [16, 5200],
    [32, 2600],
    [48, 7200],
    [64, 3400],
    [80, 6200],
    [96, 4300],
    [112, 9800],
    [124, 13200],
  ]) {
    controller(events, usedCells, {
      line,
      track: TRACK.autoA,
      module: MODULE.bassFilter,
      controller: "freq",
      parameter,
    });
  }
  for (const [line, parameter] of [
    [0, 70],
    [32, 94],
    [64, 122],
    [96, 156],
    [120, 210],
  ]) {
    controller(events, usedCells, {
      line,
      track: TRACK.autoB,
      module: MODULE.musicBus,
      controller: "stereoWidth",
      parameter,
    });
  }
  for (const [line, parameter] of [
    [0, 8700],
    [48, 10400],
    [80, 7600],
    [112, 12600],
  ]) {
    controller(events, usedCells, {
      line,
      track: TRACK.autoC,
      module: MODULE.lead,
      controller: "filterFreq",
      parameter,
    });
  }
}

function buildEvents() {
  const events = [];
  const usedCells = new Set();
  addDrums(events, usedCells);
  addBass(events, usedCells);
  addPads(events, usedCells);
  addLead(events, usedCells);
  addAccents(events, usedCells);
  addAutomation(events, usedCells);
  return events.sort((a, b) => a.line - b.line || a.track - b.track || (a.module ?? 0) - (b.module ?? 0));
}

export function buildNeonRazorDriftDocument() {
  return {
    format: TEXT_FORMAT,
    magic: "SVOX",
    headerTailHex: "00000000",
    _comments: [
      "Neon Razor Drift: aggressive 146 BPM cyber loop in C minor. The harmony is i(add9)-VImaj7-IIIadd9-VIIadd11-iv7-VImaj7-V7(b9)-i(add9), with the B natural and Ab in bar 7 pulling back to C minor.",
    ],
    project: {
      version: 33554437,
      baseVersion: 33554437,
      flags: {},
      syncFlags: { midiStartStopContinue: true, otherStartStopContinue: true },
      name: "Neon Razor Drift",
      bpm: BPM,
      speed: SPEED,
      globalVolume: 188,
      timeline: { grid: 4, grid2: 4 },
      view: { moduleScale: 256, moduleZoom: 152, xOffset: -180, yOffset: -160 },
      restartPosition: 0,
      selectedModule: MODULE.lead,
      lastSelectedGenerator: MODULE.lead,
      currentPattern: 0,
      currentPatternTrack: TRACK.leadA,
      currentPatternLine: 0,
    },
    patterns: [
      {
        name: "Neon razor drift loop",
        position: { x: 0, y: 0 },
        tracks: 16,
        lines: LINES,
        foreground: "#dff7ff",
        background: "#181d27",
        events: buildEvents(),
        iconBase64: deterministicIconBase64(59, 0),
      },
    ],
    modules: modules(),
    trailingChunks: [],
  };
}

/** @satisfies {import("../../../tools/sunvox-music-recipe.d.ts").SunVoxMusicRecipe} */
export const recipe = {
  schemaVersion: 1,
  tags: ["research:generated-music", "research:cool-song", "style:cyberpunk"],
  outputs: {
    neonRazorDrift: {
      file: PROJECT_PATH,
      title: "Neon Razor Drift",
      summaryFile: SUMMARY_PATH,
      params: {
        bpm: BPM,
        speed: SPEED,
        form: "8-bar loop",
        key: "C minor",
        harmony: harmony.map((chordTone) => chordTone.symbol),
        palette: ["distorted reese bass", "hard grid drums", "pitch-bent analog lead", "wide chrome pad"],
      },
      buildDocument: buildNeonRazorDriftDocument,
    },
  },
};

export default recipe;

export async function writeNeonRazorDrift(outputPath = PROJECT_PATH) {
  const resolvedOutputPath = resolve(outputPath);
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, buildContainer(buildNeonRazorDriftDocument()));
  return resolvedOutputPath;
}

if (typeof process !== "undefined" && import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  console.log(await writeNeonRazorDrift());
}

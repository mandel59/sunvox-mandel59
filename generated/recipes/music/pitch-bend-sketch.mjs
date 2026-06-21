#!/usr/bin/env node
// @ts-check

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildContainer, TEXT_FORMAT } from "../../../tools/sunvox-codec.mjs";
import { deterministicIconBase64 } from "../../../tools/sunvox-music-recipe-helpers.mjs";

const OUTPUT_DIR = "generated/music";
const SUMMARY_DIR = "var/music-recipe";
const PROJECT_PATH = `${OUTPUT_DIR}/pitch-bend-sketch.sunvox`;
const SUMMARY_PATH = `${SUMMARY_DIR}/pitch-bend-sketch.summary.json`;
const LINES = 128;
const TRACKS = 12;
const BPM = 118;
const SPEED = 6;

const MODULE = Object.freeze({
  output: 0,
  kick: 1,
  drums: 2,
  bass: 3,
  lead: 4,
  pad: 5,
  glass: 6,
  voiceMix: 7,
  bendDelay: 8,
  bendRoom: 9,
  glue: 10,
});

const TRACK = Object.freeze({
  kick: 0,
  drums: 1,
  bass: 2,
  pad: 4,
  lead: 7,
  glass: 10,
});

function analog(overrides = {}) {
  return {
    volume: 56,
    waveform: "triangle",
    panning: 128,
    attack: 0,
    release: 48,
    sustain: "off",
    expEnvelope: "on",
    dutyCycle: 512,
    osc2Pitch: 1000,
    filter: "off",
    filterFreq: 12000,
    filterResonance: 0,
    filterExpFreq: "on",
    filterAttack: 0,
    filterRelease: 0,
    filterEnvelope: "off",
    polyphony: 8,
    mode: "hq",
    noise: 0,
    osc2Volume: 5000,
    osc2Mode: "add",
    osc2Phase: 0,
    ...overrides,
  };
}

function amplifier(overrides = {}) {
  return {
    volume: 256,
    balance: 128,
    dcOffset: 128,
    inverse: "off",
    stereoWidth: 128,
    absolute: "off",
    fineVolume: 32768,
    gain: 0,
    bipolarDcOffset: 0,
    ...overrides,
  };
}

function delay(overrides = {}) {
  return {
    dry: 256,
    wet: 64,
    delayL: 6,
    delayR: 9,
    volumeL: 256,
    volumeR: 216,
    channels: "stereo",
    inverse: "off",
    delayUnit: "line",
    delayMultiplier: 1,
    feedback: 980,
    negativeFeedback: "off",
    allpassFilter: "off",
    ...overrides,
  };
}

function reverb(overrides = {}) {
  return {
    dry: 236,
    wet: 42,
    feedback: 176,
    damp: 184,
    stereoWidth: 224,
    freeze: "off",
    mode: "hq",
    allpassFilter: "improved",
    roomSize: 22,
    randomSeed: 45,
    ...overrides,
  };
}

function compressor(overrides = {}) {
  return {
    volume: 288,
    threshold: 304,
    slope: 64,
    attack: 10,
    release: 360,
    mode: "rms",
    sideChainInput: 0,
    ...overrides,
  };
}

function modules() {
  return [
    {
      flags: { exists: true, output: true },
      name: "Output",
      position: { x: 1136, y: 448, z: 0 },
      inputs: [{ slot: 0, module: MODULE.glue }],
    },
    {
      type: "Kicker",
      name: "Bend Pulse Kick",
      color: "#d75f46",
      position: { x: 96, y: 224, z: 0 },
      controllers: {
        volume: 34,
        waveform: 2,
        panning: 128,
        attack: 0,
        release: 30,
        boost: 238,
        acceleration: 308,
        polyphony: 1,
        noClick: "off",
      },
    },
    {
      type: "DrumSynth",
      name: "Bend Snap Drums",
      color: "#b8c46a",
      position: { x: 96, y: 352, z: 0 },
      controllers: {
        volume: 170,
        panning: 128,
        polyphony: 8,
        bassVolume: 52,
        bassPower: 150,
        bassTone: 42,
        bassLength: 36,
        hihatVolume: 268,
        hihatLength: 24,
        snareVolume: 178,
        snareTone: 176,
        snareLength: 38,
        bassPan: 128,
        hihatPan: 176,
        snarePan: 92,
      },
    },
    {
      type: "Analog generator",
      name: "Bend Mono Bass",
      color: "#4ea36f",
      position: { x: 96, y: 512, z: 0 },
      controllers: analog({
        volume: 150,
        waveform: "saw",
        panning: 112,
        release: 58,
        polyphony: 1,
        mode: "hqMono",
        dutyCycle: 442,
        osc2Pitch: 497,
        osc2Volume: 5200,
        filter: "lp24db",
        filterFreq: 4200,
        filterResonance: 88,
      }),
    },
    {
      type: "Analog generator",
      name: "Bend Ribbon Lead",
      color: "#6f9fdc",
      position: { x: 96, y: 672, z: 0 },
      controllers: analog({
        volume: 84,
        waveform: "hsin",
        panning: 100,
        attack: 0,
        release: 92,
        sustain: "on",
        polyphony: 2,
        dutyCycle: 560,
        osc2Pitch: 1204,
        osc2Volume: 9600,
        filter: "lp12db",
        filterFreq: 9800,
        filterResonance: 36,
      }),
    },
    {
      type: "Analog generator",
      name: "Bend Slow Pad",
      color: "#9e83ca",
      position: { x: 96, y: 832, z: 0 },
      controllers: analog({
        volume: 24,
        waveform: "triangle",
        panning: 150,
        attack: 44,
        release: 180,
        sustain: "on",
        polyphony: 12,
        dutyCycle: 496,
        osc2Pitch: 1007,
        osc2Volume: 4200,
        filter: "lp24db",
        filterFreq: 5600,
      }),
    },
    {
      type: "Analog generator",
      name: "Bend Glass Replies",
      color: "#d7c772",
      position: { x: 96, y: 992, z: 0 },
      controllers: analog({
        volume: 54,
        waveform: "asin",
        panning: 174,
        attack: 0,
        release: 76,
        polyphony: 6,
        osc2Pitch: 1507,
        osc2Volume: 8200,
        filter: "lp12db",
        filterFreq: 11000,
      }),
    },
    {
      type: "Amplifier",
      name: "Bend Voice Mix",
      color: "#d6d8d8",
      position: { x: 400, y: 608, z: 0 },
      inputs: [
        { slot: 0, module: MODULE.kick },
        { slot: 1, module: MODULE.drums },
        { slot: 2, module: MODULE.bass },
        { slot: 3, module: MODULE.lead },
        { slot: 4, module: MODULE.pad },
        { slot: 5, module: MODULE.glass },
      ],
      controllers: amplifier({ volume: 246, stereoWidth: 174 }),
    },
    {
      type: "Delay",
      name: "Bend Throw Delay",
      color: "#8fc4bd",
      position: { x: 640, y: 520, z: 0 },
      inputs: [{ slot: 0, module: MODULE.voiceMix }],
      controllers: delay({ wet: 46, delayL: 5, delayR: 7, feedback: 840 }),
    },
    {
      type: "Reverb",
      name: "Bend Soft Room",
      color: "#bdac92",
      position: { x: 832, y: 520, z: 0 },
      inputs: [{ slot: 0, module: MODULE.bendDelay }],
      controllers: reverb({ wet: 34, feedback: 168, roomSize: 20 }),
    },
    {
      type: "Compressor",
      name: "Bend Glue",
      color: "#eeeeee",
      position: { x: 1008, y: 448, z: 0 },
      inputs: [{ slot: 0, module: MODULE.bendRoom }],
      controllers: compressor({ threshold: 292, slope: 58 }),
    },
  ];
}

function pushNote(events, { line, track, note, module, velocity = 108, gate = 4, effect, value }) {
  if (line < 0 || line >= LINES) {
    return;
  }
  events.push({ line, track, note, velocity, module, ...(effect ? { effect, value } : {}) });
  const offLine = line + gate;
  if (gate > 0 && offLine < LINES) {
    events.push({ line: offLine, track, note: "noteOff", module });
  }
}

function pushEffect(events, { line, track, module, effect, value }) {
  if (line < 0 || line >= LINES) {
    return;
  }
  events.push({ line, track, module, effect, value });
}

function addDrums(events) {
  for (let bar = 0; bar < 8; bar += 1) {
    const line = bar * 16;
    for (const offset of [0, 8]) {
      pushNote(events, { line: line + offset, track: TRACK.kick, note: "D2", module: MODULE.kick, velocity: offset === 0 ? 122 : 104, gate: 2 });
    }
    for (const offset of [4, 12]) {
      pushNote(events, { line: line + offset, track: TRACK.drums, note: "F3", module: MODULE.drums, velocity: 92, gate: 1 });
    }
    for (const offset of [2, 6, 10, 14]) {
      pushNote(events, { line: line + offset, track: TRACK.drums + 1, note: "A4", module: MODULE.drums, velocity: offset === 14 ? 86 : 72, gate: 1 });
    }
  }
}

function addBass(events) {
  const cells = [
    ["C2", "G1", "A#1"],
    ["D#2", "A#1", "C2"],
    ["F2", "C2", "D#2"],
    ["G2", "D2", "F2"],
  ];
  for (let bar = 0; bar < 8; bar += 1) {
    const line = bar * 16;
    const [root, dip, lift] = cells[bar % cells.length];
    pushNote(events, { line, track: TRACK.bass, note: root, module: MODULE.bass, velocity: 116, gate: 14 });
    pushNote(events, {
      line: line + 5,
      track: TRACK.bass,
      note: dip,
      module: MODULE.bass,
      velocity: 96,
      gate: 0,
      effect: "tonePortamento",
      value: { speed: 56 + (bar % 2) * 16 },
    });
    pushNote(events, {
      line: line + 10,
      track: TRACK.bass,
      note: lift,
      module: MODULE.bass,
      velocity: 100,
      gate: 0,
      effect: "tonePortamento",
      value: { speed: 84 },
    });
    pushEffect(events, { line: line + 13, track: TRACK.bass, module: MODULE.bass, effect: "portamentoDown", value: { speed: 34 } });
  }
}

function addPads(events) {
  const chords = [
    ["C4", "D#4", "G4"],
    ["D#4", "G4", "A#4"],
    ["F4", "G#4", "C5"],
    ["G4", "A#4", "D5"],
  ];
  for (let bar = 0; bar < 8; bar += 1) {
    const line = bar * 16;
    const chord = chords[bar % chords.length];
    chord.forEach((note, index) => {
      const track = TRACK.pad + index;
      pushNote(events, { line, track, note, module: MODULE.pad, velocity: 60 + index * 5, gate: 15 });
      pushEffect(events, { line: line + 2 + index, track, module: MODULE.pad, effect: "vibrato", value: { speed: 2 + index, amplitude: 10 + bar } });
      pushEffect(events, { line: line + 9, track, module: MODULE.pad, effect: "finetune", value: { finetune: index === 1 ? 8 : -6 } });
    });
  }
}

function addLead(events) {
  const phrases = [
    { start: 0, notes: ["G5", "D#5", "A#5", "C6"], down: true },
    { start: 16, notes: ["A#5", "F5", "C6", "D6"], down: false },
    { start: 32, notes: ["C6", "G5", "D6", "F6"], down: true },
    { start: 48, notes: ["D#6", "A#5", "G5", "C6"], down: false },
    { start: 64, notes: ["G5", "C6", "D6", "A#5"], down: false },
    { start: 80, notes: ["F6", "D#6", "C6", "G5"], down: true },
    { start: 96, notes: ["A#5", "C6", "F6", "D6"], down: false },
    { start: 112, notes: ["C6", "G5", "D#6", "C6"], down: true },
  ];
  for (const [index, phrase] of phrases.entries()) {
    const track = TRACK.lead + (index % 2);
    const [start, targetA, targetB, close] = phrase.notes;
    pushNote(events, { line: phrase.start, track, note: start, module: MODULE.lead, velocity: 112, gate: 14 });
    pushNote(events, {
      line: phrase.start + 3,
      track,
      note: targetA,
      module: MODULE.lead,
      velocity: 98,
      gate: 0,
      effect: "tonePortamento",
      value: { speed: phrase.down ? 44 : 68 },
    });
    pushEffect(events, {
      line: phrase.start + 6,
      track,
      module: MODULE.lead,
      effect: phrase.down ? "pitchDown" : "pitchUp",
      value: { amount: phrase.down ? 420 : 360 },
    });
    pushNote(events, {
      line: phrase.start + 8,
      track,
      note: targetB,
      module: MODULE.lead,
      velocity: 104,
      gate: 0,
      effect: "tonePortamento",
      value: { speed: 96 },
    });
    pushEffect(events, { line: phrase.start + 10, track, module: MODULE.lead, effect: "vibrato", value: { speed: 6, amplitude: 28 } });
    pushNote(events, {
      line: phrase.start + 12,
      track,
      note: close,
      module: MODULE.lead,
      velocity: 92,
      gate: 0,
      effect: "tonePortamento",
      value: { speed: 128 },
    });
  }
}

function addGlassReplies(events) {
  const replies = [
    [6, "C6", "pitchDown", 180],
    [22, "G5", "pitchUp", 220],
    [38, "A#5", "pitchDown", 160],
    [54, "D6", "pitchUp", 240],
    [70, "F6", "pitchDown", 220],
    [86, "D#6", "pitchUp", 160],
    [102, "G6", "pitchDown", 260],
    [118, "C6", "pitchUp", 180],
  ];
  for (const [line, note, effect, amount] of replies) {
    const track = TRACK.glass + ((line / 16) % 2);
    pushNote(events, { line, track, note, module: MODULE.glass, velocity: 82, gate: 5, effect, value: { amount } });
    pushEffect(events, { line: line + 2, track, module: MODULE.glass, effect: "vibrato", value: { speed: 9, amplitude: 18 } });
  }
}

function compareEvents(a, b) {
  return a.line - b.line || a.track - b.track || (a.module ?? 0) - (b.module ?? 0) || String(a.note ?? "").localeCompare(String(b.note ?? ""));
}

function buildEvents() {
  const events = [];
  addDrums(events);
  addBass(events);
  addPads(events);
  addLead(events);
  addGlassReplies(events);
  return events.sort(compareEvents);
}

function applyDeterministicPatternIcons(document) {
  for (const [index, pattern] of (document.patterns ?? []).entries()) {
    pattern.iconBase64 = deterministicIconBase64(45, index);
  }
}

export function buildPitchBendSketchDocument() {
  const document = {
    format: TEXT_FORMAT,
    magic: "SVOX",
    headerTailHex: "00000000",
    _comments: [
      "Issue 45 pitch bend sketch: tonePortamento carries the lead and bass between target notes, while pitchUp/pitchDown throws bend accents into the delay.",
      "The bend gestures are kept as explicit pattern effects so they can be inspected in sunvox:outline and tuned without changing the synth patches.",
    ],
    project: {
      version: 33554437,
      baseVersion: 33554437,
      flags: {},
      syncFlags: {
        midiStartStopContinue: true,
        otherStartStopContinue: true,
      },
      name: "Pitch Bend Sketch",
      bpm: BPM,
      speed: SPEED,
      globalVolume: 256,
      timeline: { grid: 4, grid2: 4 },
      view: {
        moduleScale: 256,
        moduleZoom: 176,
        xOffset: -64,
        yOffset: -80,
      },
      restartPosition: 0,
      selectedModule: MODULE.lead,
      lastSelectedGenerator: MODULE.lead,
      currentPattern: 0,
      currentPatternTrack: TRACK.lead,
      currentPatternLine: 0,
    },
    patterns: [
      {
        name: "Pitch bend ribbon loop",
        position: { x: 0, y: 0 },
        tracks: TRACKS,
        lines: LINES,
        foreground: "#c7ded4",
        background: "#263039",
        events: buildEvents(),
      },
    ],
    modules: modules(),
    trailingChunks: [],
  };
  applyDeterministicPatternIcons(document);
  return document;
}

/** @satisfies {import("../../../tools/sunvox-music-recipe.d.ts").SunVoxMusicRecipe} */
export const recipe = {
  schemaVersion: 1,
  tags: ["research:pitch-bend-song", "research:generated-music"],
  issue: 45,
  outputs: {
    pitchBendSketch: {
      file: PROJECT_PATH,
      title: "Pitch Bend Sketch",
      summaryFile: SUMMARY_PATH,
      params: {
        bpm: BPM,
        speed: SPEED,
        pitchBendGestures: ["tonePortamento", "pitchUp", "pitchDown", "vibrato", "finetune"],
      },
      buildDocument: buildPitchBendSketchDocument,
    },
  },
};

export default recipe;

export async function writePitchBendSketch(outputPath = PROJECT_PATH) {
  const resolvedOutputPath = resolve(outputPath);
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, buildContainer(buildPitchBendSketchDocument()));
  return resolvedOutputPath;
}

if (typeof process !== "undefined" && import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  console.log(await writePitchBendSketch());
}

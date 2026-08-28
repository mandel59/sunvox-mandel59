#!/usr/bin/env node
// @ts-check

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildContainer, TEXT_FORMAT } from "../../../tools/sunvox-codec.mjs";
import { deterministicIconBase64 } from "../../../tools/sunvox-music-recipe-helpers.mjs";

const PROJECT_PATH = "generated/music/aurora-pulse.sunvox";
const SUMMARY_PATH = "var/music-recipe/aurora-pulse.summary.json";
const BPM = 128;
const SPEED = 6;
const BARS = 32;
const LINES = BARS * 16;

const MODULE = Object.freeze({
  output: 0,
  kick: 1,
  drums: 2,
  bass: 3,
  chord: 4,
  arp: 5,
  lead: 6,
  noise: 7,
  musicBus: 8,
  echo: 9,
  room: 10,
  master: 11,
});

const TRACK = Object.freeze({
  kick: 0,
  drums: 1,
  bass: 2,
  chordA: 3,
  chordB: 4,
  chordC: 5,
  arpA: 6,
  arpB: 7,
  leadA: 8,
  leadB: 9,
  noise: 10,
  autoA: 11,
  autoB: 12,
  autoC: 13,
  chordGain: 14,
});

const progression = Object.freeze([
  { symbol: "F#m(add9)", root: "F#2", chord: ["F#4", "A4", "C#5"], arp: ["F#5", "A5", "C#6", "G#5"] },
  { symbol: "Dmaj7", root: "D2", chord: ["D4", "F#4", "A4"], arp: ["F#5", "A5", "C#6", "A5"] },
  { symbol: "A(add9)", root: "A1", chord: ["A3", "C#4", "E4"], arp: ["E5", "A5", "B5", "C#6"] },
  { symbol: "Esus4", root: "E2", chord: ["E4", "A4", "B4"], arp: ["E5", "A5", "B5", "G#5"] },
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
    filterResonance: 120,
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
      position: { x: 1480, y: 420, z: 0 },
      inputs: [{ slot: 0, module: MODULE.master }],
    },
    {
      type: "Kicker",
      name: "Aurora Kick",
      color: "#ff496c",
      position: { x: 80, y: 140, z: 0 },
      controllers: { volume: 104, waveform: "sin", panning: 128, attack: 0, release: 30, boost: 286, acceleration: 344, polyphony: 1, noClick: "off" },
    },
    {
      type: "DrumSynth",
      name: "Pulse Hats and Claps",
      color: "#76d7ff",
      position: { x: 80, y: 270, z: 0 },
      controllers: {
        volume: 260, panning: 128, polyphony: 8,
        bassVolume: 90, bassPower: 80, bassTone: 64, bassLength: 24,
        hihatVolume: 330, hihatLength: 22, snareVolume: 280, snareTone: 166, snareLength: 42,
        bassPan: 128, hihatPan: 170, snarePan: 112,
      },
    },
    {
      type: "Analog generator",
      name: "Sidechain Bass",
      color: "#5dff89",
      position: { x: 80, y: 430, z: 0 },
      controllers: analog({ volume: 68, waveform: "saw", release: 42, polyphony: 1, mode: "hqMono", dutyCycle: 430, osc2Pitch: 497, osc2Volume: 6800, filterFreq: 4200, filterResonance: 330 }),
    },
    {
      type: "Analog generator",
      name: "Sunrise Chords",
      color: "#ffb45d",
      position: { x: 80, y: 590, z: 0 },
      controllers: analog({ volume: 64, waveform: "saw", panning: 142, attack: 5, release: 70, polyphony: 8, dutyCycle: 548, osc2Pitch: 1007, osc2Volume: 7600, filter: "lp12db", filterFreq: 6100, filterResonance: 110, filterAttack: 8, filterRelease: 72, filterEnvelope: "sustainOn" }),
    },
    {
      type: "Analog generator",
      name: "Crystal Arp",
      color: "#64ffe1",
      position: { x: 80, y: 750, z: 0 },
      controllers: analog({ volume: 120, waveform: "triangle", panning: 92, release: 38, sustain: "off", polyphony: 4, osc2Pitch: 1200, osc2Volume: 8200, osc2Mode: "add", filter: "lp12db", filterFreq: 12000, filterResonance: 190 }),
    },
    {
      type: "Analog generator",
      name: "Aurora Supersaw Lead",
      color: "#c678ff",
      position: { x: 80, y: 910, z: 0 },
      controllers: analog({ volume: 68, waveform: "saw", panning: 152, attack: 0, release: 72, polyphony: 3, dutyCycle: 576, osc2Pitch: 1005, osc2Volume: 10800, filter: "lp12db", filterFreq: 9800, filterResonance: 170 }),
    },
    {
      type: "Analog generator",
      name: "White Lift",
      color: "#f4f6ff",
      position: { x: 80, y: 1070, z: 0 },
      controllers: analog({ volume: 110, waveform: "whiteNoise", panning: 128, release: 46, sustain: "off", polyphony: 2, filter: "hp12db", filterFreq: 8400, filterResonance: 220, noise: 180, osc2Volume: 0 }),
    },
    {
      type: "Amplifier",
      name: "Wide Music Bus",
      color: "#d6d8d8",
      position: { x: 700, y: 700, z: 0 },
      inputs: [
        { slot: 0, module: MODULE.chord },
        { slot: 1, module: MODULE.arp },
        { slot: 2, module: MODULE.lead },
        { slot: 3, module: MODULE.noise },
      ],
      controllers: { volume: 248, balance: 128, dcOffset: 128, inverse: "off", stereoWidth: 224, absolute: "off", fineVolume: 32768, gain: 1, bipolarDcOffset: 16384 },
    },
    {
      type: "Delay",
      name: "Dotted Pulse Echo",
      color: "#7bc8ff",
      position: { x: 920, y: 700, z: 0 },
      inputs: [{ slot: 0, module: MODULE.musicBus }],
      controllers: { dry: 256, wet: 40, delayL: 3, delayR: 5, volumeL: 256, volumeR: 226, channels: "stereo", inverse: "off", delayUnit: "line", delayMultiplier: 1, feedback: 920, negativeFeedback: "off", allpassFilter: "off" },
    },
    {
      type: "Reverb",
      name: "Aurora Hall",
      color: "#a8b6ff",
      position: { x: 1120, y: 700, z: 0 },
      inputs: [{ slot: 0, module: MODULE.echo }],
      controllers: { dry: 244, wet: 30, feedback: 174, damp: 176, stereoWidth: 238, freeze: "off", mode: "hq", allpassFilter: "improved", roomSize: 22, randomSeed: 59 },
    },
    {
      type: "Compressor",
      name: "Festival Master Glue",
      color: "#ff7b45",
      position: { x: 1320, y: 420, z: 0 },
      inputs: [
        { slot: 0, module: MODULE.kick },
        { slot: 1, module: MODULE.drums },
        { slot: 2, module: MODULE.bass },
        { slot: 3, module: MODULE.room },
      ],
      controllers: { volume: 224, threshold: 322, slope: 82, attack: 7, release: 310, mode: "peak", sideChainInput: 0 },
    },
  ];
}

function push(events, used, event) {
  if (event.line < 0 || event.line >= LINES) return;
  const key = `${event.line}:${event.track}`;
  if (used.has(key)) throw new Error(`Pattern cell already used: ${key}`);
  used.add(key);
  events.push(event);
}

function note(events, used, { line, track, note: noteName, module, velocity = 104, gate = 1, effect, parameter }) {
  push(events, used, { line, track, note: noteName, velocity, module, ...(effect ? { effect, parameter } : {}) });
  if (gate > 0 && line + gate < LINES) push(events, used, { line: line + gate, track, note: "noteOff", module });
}

function control(events, used, { line, track, module, controller, parameter }) {
  push(events, used, { line, track, module, controller, parameter });
}

function sectionForBar(bar) {
  if (bar < 4) return "intro";
  if (bar < 8) return "build1";
  if (bar < 16) return "drop1";
  if (bar < 20) return "break";
  if (bar < 24) return "build2";
  if (bar < 30) return "drop2";
  return "outro";
}

function addDrums(events, used) {
  for (let bar = 0; bar < BARS; bar += 1) {
    const line = bar * 16;
    const section = sectionForBar(bar);
    const fullKick = ["build1", "drop1", "build2", "drop2", "outro"].includes(section);
    if (fullKick) {
      for (const offset of [0, 4, 8, 12]) note(events, used, { line: line + offset, track: TRACK.kick, note: "C2", module: MODULE.kick, velocity: offset === 0 ? 124 : 112, gate: 1 });
    } else if (section === "intro" && bar >= 2) {
      for (const offset of [0, 8]) note(events, used, { line: line + offset, track: TRACK.kick, note: "C2", module: MODULE.kick, velocity: 92, gate: 1 });
    }
    if (["build1", "drop1", "build2", "drop2"].includes(section)) {
      for (const offset of [2, 6, 10, 14]) note(events, used, { line: line + offset, track: TRACK.drums, note: "D3", module: MODULE.drums, velocity: section.startsWith("drop") ? 70 : 52, gate: 0 });
      for (const offset of [4, 12]) note(events, used, { line: line + offset, track: TRACK.drums, note: "D#3", module: MODULE.drums, velocity: 84, gate: 0 });
    }
  }
}

function addBass(events, used) {
  for (let bar = 0; bar < BARS; bar += 1) {
    const section = sectionForBar(bar);
    if (!["build1", "drop1", "build2", "drop2", "outro"].includes(section)) continue;
    const root = progression[bar % progression.length].root;
    const line = bar * 16;
    const offsets = section.startsWith("drop") ? [2, 6, 10, 14] : [2, 10];
    for (const [index, offset] of offsets.entries()) {
      note(events, used, { line: line + offset, track: TRACK.bass, note: root, module: MODULE.bass, velocity: index === 0 ? 116 : 100, gate: section.startsWith("drop") ? 2 : 3 });
    }
  }
}

function addHarmony(events, used) {
  for (let bar = 0; bar < BARS; bar += 1) {
    const section = sectionForBar(bar);
    const chord = progression[bar % progression.length];
    const line = bar * 16;
    const chordLines = section.startsWith("drop") ? [2, 10] : [0];
    const gate = section === "intro" || section === "break" ? 14 : 5;
    for (const offset of chordLines) {
      chord.chord.forEach((noteName, index) => note(events, used, {
        line: line + offset,
        track: TRACK.chordA + index,
        note: noteName,
        module: MODULE.chord,
        velocity: section === "intro" || section === "build1" ? 88 : section === "build2" ? 72 : section.startsWith("drop") ? 76 : 56,
        gate,
      }));
    }
  }
}

function addArp(events, used) {
  for (let bar = 0; bar < BARS; bar += 1) {
    const section = sectionForBar(bar);
    if (section === "intro" && bar < 2) continue;
    if (section === "outro") continue;
    const chord = progression[bar % progression.length];
    const line = bar * 16;
    const step = section.startsWith("drop") ? 2 : 4;
    for (let offset = 0; offset < 16; offset += step) {
      const noteName = chord.arp[(offset / step + bar) % chord.arp.length];
      note(events, used, { line: line + offset, track: TRACK.arpA + ((offset / step) % 2), note: noteName, module: MODULE.arp, velocity: section.startsWith("drop") ? 78 : 58, gate: 1 });
    }
  }
}

const leadPhrase = Object.freeze([
  [0, "C#6", 3], [3, "B5", 2], [6, "A5", 2], [8, "F#5", 3], [12, "A5", 2], [14, "B5", 1],
  [16, "C#6", 3], [20, "E6", 3], [24, "C#6", 2], [27, "B5", 2], [30, "A5", 1],
  [32, "E6", 3], [36, "C#6", 3], [40, "B5", 2], [43, "A5", 2], [46, "F#5", 1],
  [48, "G#5", 3], [52, "B5", 3], [56, "C#6", 3], [60, "E6", 2], [63, "C#6", 0],
]);

function addLead(events, used) {
  for (const startBar of [8, 12, 24, 28]) {
    const start = startBar * 16;
    for (const [offset, noteName, gate] of leadPhrase) {
      if (startBar === 28 && offset >= 32) continue;
      note(events, used, { line: start + offset, track: TRACK.leadA + (offset % 2), note: noteName, module: MODULE.lead, velocity: startBar >= 24 ? 112 : 102, gate: Math.max(1, Math.min(gate, 1)) });
    }
  }
}

function addTransitions(events, used) {
  for (const bar of [7, 23]) {
    const line = bar * 16;
    for (const offset of [0, 4, 8, 12]) note(events, used, { line: line + offset, track: TRACK.noise, note: "C5", module: MODULE.noise, velocity: 42 + offset * 4, gate: 2 });
  }
  for (const [line, parameter] of [[0, 7000], [48, 7000], [64, 7000], [80, 7600], [96, 8400], [112, 9200], [128, 11800], [256, 2600], [320, 6400], [368, 12200], [384, 11800], [480, 5200]]) {
    control(events, used, { line, track: TRACK.autoA, module: MODULE.chord, controller: "filterFreq", parameter });
  }
  // Pattern controller parameters use SunVox's normalized 0000..8000 range:
  // Compensate briefly when the rhythm section enters at bar 4, then lower
  // gain as the filter opens so build 1 grows without burying the chords.
  for (const [line, parameter] of [[0, 0x2C00], [48, 0x2C00], [64, 0x3C00], [80, 0x2C00], [96, 0x2600], [112, 0x2000], [128, 0x2000]]) {
    control(events, used, { line, track: TRACK.chordGain, module: MODULE.chord, controller: "volume", parameter });
  }
  for (const [line, parameter] of [[0, 124], [96, 178], [128, 236], [256, 150], [368, 246], [480, 176]]) {
    control(events, used, { line, track: TRACK.autoB, module: MODULE.musicBus, controller: "stereoWidth", parameter });
  }
  for (const [line, parameter] of [[0, 28], [112, 68], [128, 40], [256, 74], [368, 92], [384, 44], [480, 26]]) {
    control(events, used, { line, track: TRACK.autoC, module: MODULE.echo, controller: "wet", parameter });
  }
}

function buildEvents() {
  const events = [];
  const used = new Set();
  addDrums(events, used);
  addBass(events, used);
  addHarmony(events, used);
  addArp(events, used);
  addLead(events, used);
  addTransitions(events, used);
  return events.sort((a, b) => a.line - b.line || a.track - b.track || (a.module ?? 0) - (b.module ?? 0));
}

export function buildAuroraPulseDocument() {
  return {
    format: TEXT_FORMAT,
    magic: "SVOX",
    headerTailHex: "00000000",
    _comments: [
      "Aurora Pulse: a 32-bar melodic progressive-house track in F# minor. Form: intro, build, first drop, breakdown, second build, final drop, outro.",
    ],
    project: {
      version: 33554437,
      baseVersion: 33554437,
      flags: {},
      syncFlags: { midiStartStopContinue: true, otherStartStopContinue: true },
      name: "Aurora Pulse",
      bpm: BPM,
      speed: SPEED,
      globalVolume: 196,
      timeline: { grid: 4, grid2: 4 },
      view: { moduleScale: 256, moduleZoom: 150, xOffset: -180, yOffset: -160 },
      restartPosition: 0,
      selectedModule: MODULE.lead,
      lastSelectedGenerator: MODULE.lead,
      currentPattern: 0,
      currentPatternTrack: TRACK.leadA,
      currentPatternLine: 0,
    },
    patterns: [{
      name: "Aurora Pulse — full arrangement",
      position: { x: 0, y: 0 },
      tracks: 15,
      lines: LINES,
      foreground: "#dffaff",
      background: "#161b34",
      events: buildEvents(),
      iconBase64: deterministicIconBase64(128, 32),
    }],
    modules: modules(),
    trailingChunks: [],
  };
}

/** @satisfies {import("../../../tools/sunvox-music-recipe.d.ts").SunVoxMusicRecipe} */
export const recipe = {
  schemaVersion: 1,
  tags: ["research:generated-music", "style:edm", "style:progressive-house"],
  outputs: {
    auroraPulse: {
      file: PROJECT_PATH,
      title: "Aurora Pulse",
      summaryFile: SUMMARY_PATH,
      params: {
        bpm: BPM,
        speed: SPEED,
        form: "32 bars: intro / build / drop / break / build / drop / outro",
        key: "F# minor",
        harmony: progression.map((chord) => chord.symbol),
        palette: ["four-on-the-floor kick", "offbeat bass", "supersaw lead", "crystal arpeggio", "noise risers"],
      },
      verification: { durationSeconds: 60, requireAudio: true, maxClippedSamples: 0, maxLeadingSilenceSeconds: 0.1 },
      buildDocument: buildAuroraPulseDocument,
    },
  },
};

export default recipe;

export async function writeAuroraPulse(outputPath = PROJECT_PATH) {
  const resolvedOutputPath = resolve(outputPath);
  await mkdir(dirname(resolvedOutputPath), { recursive: true });
  await writeFile(resolvedOutputPath, buildContainer(buildAuroraPulseDocument()));
  return resolvedOutputPath;
}

if (typeof process !== "undefined" && import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  console.log(await writeAuroraPulse());
}

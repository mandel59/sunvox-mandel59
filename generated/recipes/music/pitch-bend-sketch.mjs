#!/usr/bin/env node
// @ts-check

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildContainer, TEXT_FORMAT } from "../../../tools/sunvox-codec.mjs";
import { deterministicIconBase64 } from "../../../tools/sunvox-music-recipe-helpers.mjs";

const PROJECT_PATH = "generated/music/pitch-bend-sketch.sunvox";
const SUMMARY_PATH = "var/music-recipe/pitch-bend-sketch.summary.json";
const BPM = 118;
const SPEED = 6;
const LINES = 64;

const MODULE = Object.freeze({ output: 0, kick: 1, bass: 2, lead: 3, mix: 4, delay: 5, room: 6 });
const TRACK = Object.freeze({ kick: 0, bass: 1, lead: 3 });

function analog(overrides = {}) {
  return {
    volume: 80,
    waveform: "triangle",
    panning: 128,
    attack: 0,
    release: 64,
    sustain: "on",
    expEnvelope: "on",
    dutyCycle: 512,
    osc2Pitch: 1000,
    filter: "lp12db",
    filterFreq: 9000,
    filterResonance: 24,
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
    { flags: { exists: true, output: true }, name: "Output", position: { x: 928, y: 416, z: 0 }, inputs: [{ slot: 0, module: MODULE.room }] },
    {
      type: "Kicker",
      name: "Bend Kick",
      color: "#d75f46",
      position: { x: 96, y: 224, z: 0 },
      controllers: { volume: 34, waveform: 2, panning: 128, attack: 0, release: 28, boost: 236, acceleration: 304, polyphony: 1, noClick: "off" },
    },
    {
      type: "Analog generator",
      name: "Bend Bass",
      color: "#4ea36f",
      position: { x: 96, y: 416, z: 0 },
      controllers: analog({ volume: 136, waveform: "saw", panning: 112, release: 54, polyphony: 1, mode: "hqMono", dutyCycle: 438, osc2Pitch: 497, osc2Volume: 5200, filter: "lp24db", filterFreq: 3900 }),
    },
    {
      type: "Analog generator",
      name: "Bend Lead",
      color: "#6f9fdc",
      position: { x: 96, y: 608, z: 0 },
      controllers: analog({ volume: 88, waveform: "hsin", panning: 104, release: 88, polyphony: 2, dutyCycle: 558, osc2Pitch: 1204, osc2Volume: 9400, filterFreq: 9800 }),
    },
    {
      type: "Amplifier",
      name: "Bend Mix",
      color: "#d6d8d8",
      position: { x: 416, y: 416, z: 0 },
      inputs: [{ slot: 0, module: MODULE.kick }, { slot: 1, module: MODULE.bass }, { slot: 2, module: MODULE.lead }],
      controllers: { volume: 248, balance: 128, dcOffset: 128, inverse: "off", stereoWidth: 164, absolute: "off", fineVolume: 32768, gain: 1, bipolarDcOffset: 16384 },
    },
    {
      type: "Delay",
      name: "Bend Echo",
      color: "#8fc4bd",
      position: { x: 640, y: 352, z: 0 },
      inputs: [{ slot: 0, module: MODULE.mix }],
      controllers: { dry: 256, wet: 42, delayL: 5, delayR: 7, volumeL: 256, volumeR: 216, channels: "stereo", inverse: "off", delayUnit: "line", delayMultiplier: 1, feedback: 720, negativeFeedback: "off", allpassFilter: "off" },
    },
    {
      type: "Reverb",
      name: "Bend Room",
      color: "#bdac92",
      position: { x: 800, y: 416, z: 0 },
      inputs: [{ slot: 0, module: MODULE.delay }],
      controllers: { dry: 240, wet: 30, feedback: 164, damp: 184, stereoWidth: 220, freeze: "off", mode: "hq", allpassFilter: "improved", roomSize: 18, randomSeed: 45 },
    },
  ];
}

function note(events, { line, track, note, module, velocity = 108, gate = 4, effect, value }) {
  events.push({ line, track, note, velocity, module, ...(effect ? { effect, value } : {}) });
  if (gate > 0 && line + gate < LINES) events.push({ line: line + gate, track, note: "noteOff", module });
}

function fx(events, { line, track, module, effect, value }) {
  events.push({ line, track, module, effect, value });
}

function buildEvents() {
  const events = [];
  for (let bar = 0; bar < 4; bar += 1) {
    const line = bar * 16;
    note(events, { line, track: TRACK.kick, note: "D2", module: MODULE.kick, velocity: 122, gate: 2 });
    note(events, { line: line + 8, track: TRACK.kick, note: "D2", module: MODULE.kick, velocity: 104, gate: 2 });
    const bass = [["C2", "G1", "A#1"], ["D#2", "A#1", "C2"], ["F2", "C2", "D#2"], ["G2", "D2", "F2"]][bar];
    note(events, { line, track: TRACK.bass, note: bass[0], module: MODULE.bass, velocity: 116, gate: 14 });
    note(events, { line: line + 5, track: TRACK.bass, note: bass[1], module: MODULE.bass, velocity: 96, gate: 0, effect: "tonePortamento", value: { speed: 56 } });
    note(events, { line: line + 10, track: TRACK.bass, note: bass[2], module: MODULE.bass, velocity: 100, gate: 0, effect: "tonePortamento", value: { speed: 84 } });
    fx(events, { line: line + 13, track: TRACK.bass, module: MODULE.bass, effect: "portamentoDown", value: { speed: 34 } });
  }

  const phrases = [
    { line: 0, notes: ["G5", "D#5", "A#5", "C6"], down: true },
    { line: 16, notes: ["A#5", "F5", "C6", "D6"], down: false },
    { line: 32, notes: ["C6", "G5", "D6", "F6"], down: true },
    { line: 48, notes: ["D#6", "A#5", "G5", "C6"], down: false },
  ];
  for (const [index, phrase] of phrases.entries()) {
    const track = TRACK.lead + (index % 2);
    note(events, { line: phrase.line, track, note: phrase.notes[0], module: MODULE.lead, velocity: 112, gate: 14 });
    note(events, { line: phrase.line + 3, track, note: phrase.notes[1], module: MODULE.lead, velocity: 98, gate: 0, effect: "tonePortamento", value: { speed: phrase.down ? 44 : 68 } });
    fx(events, { line: phrase.line + 6, track, module: MODULE.lead, effect: phrase.down ? "pitchDown" : "pitchUp", value: { amount: phrase.down ? 420 : 360 } });
    note(events, { line: phrase.line + 8, track, note: phrase.notes[2], module: MODULE.lead, velocity: 104, gate: 0, effect: "tonePortamento", value: { speed: 96 } });
    fx(events, { line: phrase.line + 10, track, module: MODULE.lead, effect: "vibrato", value: { speed: 6, amplitude: 28 } });
    note(events, { line: phrase.line + 12, track, note: phrase.notes[3], module: MODULE.lead, velocity: 92, gate: 0, effect: "tonePortamento", value: { speed: 128 } });
  }
  return events.sort((a, b) => a.line - b.line || a.track - b.track || (a.module ?? 0) - (b.module ?? 0));
}

export function buildPitchBendSketchDocument() {
  const document = {
    format: TEXT_FORMAT,
    magic: "SVOX",
    headerTailHex: "00000000",
    _comments: [
      "Issue 45 pitch bend sketch: the lead and bass use tonePortamento, pitchUp, pitchDown, vibrato, and portamentoDown as explicit pitch-bend gestures.",
    ],
    project: {
      version: 33554437,
      baseVersion: 33554437,
      flags: {},
      syncFlags: { midiStartStopContinue: true, otherStartStopContinue: true },
      name: "Pitch Bend Sketch",
      bpm: BPM,
      speed: SPEED,
      globalVolume: 256,
      timeline: { grid: 4, grid2: 4 },
      view: { moduleScale: 256, moduleZoom: 176, xOffset: -48, yOffset: -64 },
      restartPosition: 0,
      selectedModule: MODULE.lead,
      lastSelectedGenerator: MODULE.lead,
      currentPattern: 0,
      currentPatternTrack: TRACK.lead,
      currentPatternLine: 0,
    },
    patterns: [{ name: "Pitch bend ribbon loop", position: { x: 0, y: 0 }, tracks: 6, lines: LINES, foreground: "#c7ded4", background: "#263039", events: buildEvents(), iconBase64: deterministicIconBase64(45, 0) }],
    modules: modules(),
    trailingChunks: [],
  };
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
      params: { bpm: BPM, speed: SPEED, pitchBendGestures: ["tonePortamento", "pitchUp", "pitchDown", "vibrato", "portamentoDown"] },
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

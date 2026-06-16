#!/usr/bin/env node
// @ts-check

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildContainer, TEXT_FORMAT } from "../../../tools/sunvox-codec.mjs";

export const OUTPUT_FILE = "generated/music/podcast-bed-loop.sunvox";

const TOTAL_LINES = 384;
const TRACKS = 24;
const BAR_LINES = 16;

const MODULE = {
  output: 0,
  padL: 1,
  padR: 2,
  padFilter: 3,
  padReverb: 4,
  bass: 5,
  bassFilter: 6,
  bassAmp: 7,
  pulse: 8,
  pulseFilter: 9,
  pulseDelay: 10,
  air: 11,
  airFilter: 12,
  airReverb: 13,
  masterMix: 14,
  masterGlue: 15,
};

const AUTO_TRACKS = [20, 21, 22, 23];

const PROGRESSION = [
  {
    pad: ["C3", "G3", "B3", "D4", "E4"],
    bass: ["C2", "G2", "E2", "B1"],
    pulse: ["E4", "G4", "B4", "D5"],
  },
  {
    pad: ["B2", "G3", "A3", "D4", "G4"],
    bass: ["B1", "G2", "D2", "A1"],
    pulse: ["D4", "G4", "A4", "D5"],
  },
  {
    pad: ["A2", "E3", "G3", "C4", "E4"],
    bass: ["A1", "E2", "C2", "G1"],
    pulse: ["C4", "E4", "G4", "B4"],
  },
  {
    pad: ["F2", "C3", "E3", "A3", "C4"],
    bass: ["F1", "C2", "A1", "E2"],
    pulse: ["C4", "E4", "A4", "G4"],
  },
];

function analog(overrides = {}) {
  return {
    volume: 80,
    waveform: "triangle",
    panning: 128,
    attack: 0,
    release: 0,
    sustain: "on",
    expEnvelope: "on",
    dutyCycle: 512,
    osc2Pitch: 1000,
    filter: "off",
    filterFreq: 14000,
    filterResonance: 0,
    filterExpFreq: "on",
    filterAttack: 0,
    filterRelease: 0,
    filterEnvelope: "off",
    polyphony: 16,
    mode: "hqMono",
    noise: 0,
    osc2Volume: 32768,
    osc2Mode: "add",
    osc2Phase: 0,
    ...overrides,
  };
}

function filterPro(overrides = {}) {
  return {
    volume: 32768,
    type: "lp",
    freq: 22000,
    freqFinetune: 1000,
    freqScale: 100,
    expFreq: "off",
    q: 16384,
    gain: 16384,
    rolloff: "db12",
    response: 250,
    mode: "stereo",
    mix: 32768,
    lfoFreq: 8,
    lfoAmp: 0,
    lfoWaveform: "sin",
    setLfoPhase: 0,
    lfoFreqUnit: "hz002",
    ...overrides,
  };
}

function delay(overrides = {}) {
  return {
    dry: 256,
    wet: 256,
    delayL: 128,
    delayR: 160,
    volumeL: 256,
    volumeR: 256,
    channels: "stereo",
    inverse: "off",
    delayUnit: "sec16384",
    delayMultiplier: 1,
    feedback: 0,
    negativeFeedback: "off",
    allpassFilter: "off",
    ...overrides,
  };
}

function reverb(overrides = {}) {
  return {
    dry: 256,
    wet: 40,
    feedback: 256,
    damp: 128,
    stereoWidth: 256,
    freeze: "off",
    mode: "hq",
    allpassFilter: "on",
    roomSize: 16,
    randomSeed: 0,
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
    ...overrides,
  };
}

function cleanEvent(event) {
  return Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined));
}

function pushEvent(events, usedCells, event) {
  if (!Number.isInteger(event.line) || event.line < 0 || event.line >= TOTAL_LINES) {
    throw new Error(`Event line is outside the loop: ${event.line}`);
  }
  if (!Number.isInteger(event.track) || event.track < 0 || event.track >= TRACKS) {
    throw new Error(`Event track is outside the pattern: ${event.track}`);
  }
  const key = `${event.line}:${event.track}`;
  if (usedCells.has(key)) {
    throw new Error(`Duplicate pattern event cell ${key}`);
  }
  usedCells.add(key);
  events.push(cleanEvent(event));
}

function note(events, usedCells, line, track, module, noteName, velocity) {
  pushEvent(events, usedCells, { line, track, note: noteName, module, velocity });
}

function noteOff(events, usedCells, line, track, module) {
  pushEvent(events, usedCells, { line, track, note: "noteOff", module, velocity: 0 });
}

function chord(events, usedCells, line, firstTrack, module, notes, velocity) {
  notes.forEach((noteName, index) => note(events, usedCells, line, firstTrack + index, module, noteName, velocity));
}

function chordOff(events, usedCells, line, firstTrack, module, noteCount) {
  for (let index = 0; index < noteCount; index += 1) {
    noteOff(events, usedCells, line, firstTrack + index, module);
  }
}

function controller(events, usedCells, autoUseByLine, line, module, controllerName, parameter) {
  const autoIndex = autoUseByLine.get(line) ?? 0;
  const track = AUTO_TRACKS[autoIndex];
  if (track === undefined) {
    throw new Error(`Too many controller events on line ${line}`);
  }
  autoUseByLine.set(line, autoIndex + 1);
  pushEvent(events, usedCells, {
    line,
    track,
    module,
    controller: controllerName,
    parameter,
  });
}

function addPads(events, usedCells, bar, progression, section) {
  const line = bar * BAR_LINES;
  const velocity = section % 3 === 1 ? 34 : 30;
  chord(events, usedCells, line, 0, MODULE.padL, progression.pad, velocity);
  chord(events, usedCells, line, 5, MODULE.padR, progression.pad, velocity);
  chordOff(events, usedCells, line + BAR_LINES - 1, 0, MODULE.padL, progression.pad.length);
  chordOff(events, usedCells, line + BAR_LINES - 1, 5, MODULE.padR, progression.pad.length);
}

function addBass(events, usedCells, bar, progression, section) {
  const line = bar * BAR_LINES;
  const pattern = [
    [0, progression.bass[0], 54],
    [6, progression.bass[1], section >= 3 ? 42 : 38],
    [10, progression.bass[2], 44],
    [14, progression.bass[3], 32],
  ];
  for (const [offset, noteName, velocity] of pattern) {
    note(events, usedCells, line + offset, 10, MODULE.bass, noteName, velocity);
  }
}

function addPulse(events, usedCells, bar, progression, section) {
  const line = bar * BAR_LINES;
  if (section === 0 && bar % 2 === 1) {
    return;
  }
  const offsets = section >= 4 ? [4, 8, 12] : [4, 12];
  offsets.forEach((offset, index) => {
    const noteName = progression.pulse[(bar + index) % progression.pulse.length];
    const velocity = section >= 2 ? 38 : 32;
    note(events, usedCells, line + offset, 11 + (index % 2), MODULE.pulse, noteName, velocity);
  });
}

function addAir(events, usedCells, bar, section) {
  if (bar % 2 !== 0) {
    return;
  }
  const line = bar * BAR_LINES;
  const velocity = section >= 2 ? 14 : 10;
  note(events, usedCells, line + 2, 13, MODULE.air, "C6", velocity);
  note(events, usedCells, line + 10, 13, MODULE.air, "G6", Math.max(8, velocity - 2));
}

function buildEvents() {
  const events = [];
  const usedCells = new Set();
  const autoUseByLine = new Map();
  const filterSteps = [3600, 4200, 5000, 4400, 5400, 3800];
  const pulseSteps = [3800, 4400, 5200, 4700, 5600, 4000];

  for (let bar = 0; bar < 24; bar += 1) {
    const section = Math.floor(bar / 4);
    const progression = PROGRESSION[bar % PROGRESSION.length];
    addPads(events, usedCells, bar, progression, section);
    addBass(events, usedCells, bar, progression, section);
    addPulse(events, usedCells, bar, progression, section);
    addAir(events, usedCells, bar, section);

    if (bar % 4 === 0) {
      const line = bar * BAR_LINES;
      controller(events, usedCells, autoUseByLine, line, MODULE.padFilter, "freq", filterSteps[section]);
      controller(events, usedCells, autoUseByLine, line, MODULE.pulseFilter, "freq", pulseSteps[section]);
    }
  }

  return events.sort((a, b) => a.line - b.line || a.track - b.track);
}

function modules() {
  return [
    {
      flags: {
        exists: true,
        output: true,
      },
      name: "Output",
      position: { x: 1280, y: 704, z: 0 },
      inputs: [{ slot: 0, module: MODULE.masterGlue }],
    },
    {
      type: "Analog generator",
      name: "Warm Pad L",
      color: "#7fb7a3",
      position: { x: 48, y: 352, z: 0 },
      controllers: analog({
        waveform: "saw",
        volume: 42,
        panning: 96,
        attack: 52,
        release: 188,
        sustain: "on",
        dutyCycle: 460,
        osc2Pitch: 1005,
        osc2Volume: 12000,
        polyphony: 16,
        mode: "hq",
        noise: 4,
      }),
    },
    {
      type: "Analog generator",
      name: "Warm Pad R",
      color: "#8fc9b8",
      position: { x: 48, y: 544, z: 0 },
      controllers: analog({
        waveform: "saw",
        volume: 40,
        panning: 160,
        attack: 58,
        release: 196,
        sustain: "on",
        dutyCycle: 552,
        osc2Pitch: 995,
        osc2Volume: 11800,
        polyphony: 16,
        mode: "hq",
        noise: 4,
      }),
    },
    {
      type: "Filter Pro",
      name: "Pad Talk-Space Filter",
      color: "#a3d2ca",
      position: { x: 288, y: 448, z: 0 },
      inputs: [
        { slot: 0, module: MODULE.padL },
        { slot: 1, module: MODULE.padR },
      ],
      controllers: filterPro({
        type: "lp",
        freq: 3800,
        q: 9800,
        rolloff: "db24",
        response: 180,
        mode: "stereoSmoothing",
        lfoFreq: 6,
        lfoAmp: 80,
      }),
    },
    {
      type: "Reverb",
      name: "Pad Room",
      color: "#b6dfd8",
      position: { x: 528, y: 448, z: 0 },
      inputs: [{ slot: 0, module: MODULE.padFilter }],
      controllers: reverb({
        dry: 238,
        wet: 44,
        feedback: 188,
        damp: 182,
        stereoWidth: 232,
        roomSize: 24,
        randomSeed: 59,
      }),
    },
    {
      type: "Analog generator",
      name: "Round Bass",
      color: "#f0c35b",
      position: { x: 48, y: 832, z: 0 },
      controllers: analog({
        waveform: "triangle",
        volume: 66,
        panning: 128,
        attack: 0,
        release: 36,
        sustain: "off",
        dutyCycle: 512,
        osc2Pitch: 500,
        osc2Volume: 6200,
        polyphony: 4,
        mode: "hqMono",
      }),
    },
    {
      type: "Filter Pro",
      name: "Bass Low Shelf",
      color: "#f4d58d",
      position: { x: 288, y: 832, z: 0 },
      inputs: [{ slot: 0, module: MODULE.bass }],
      controllers: filterPro({
        type: "lp",
        freq: 2200,
        q: 7000,
        rolloff: "db24",
        response: 120,
        mode: "stereo",
      }),
    },
    {
      type: "Amplifier",
      name: "Bass Trim",
      color: "#f7dfae",
      position: { x: 528, y: 832, z: 0 },
      inputs: [{ slot: 0, module: MODULE.bassFilter }],
      controllers: amplifier({
        volume: 184,
        stereoWidth: 112,
        fineVolume: 32768,
      }),
    },
    {
      type: "Analog generator",
      name: "Soft Pulse",
      color: "#c589e8",
      position: { x: 48, y: 1120, z: 0 },
      controllers: analog({
        waveform: "triangle",
        volume: 28,
        panning: 128,
        attack: 0,
        release: 42,
        sustain: "off",
        dutyCycle: 420,
        osc2Pitch: 1200,
        osc2Volume: 5800,
        polyphony: 8,
        mode: "hq",
        noise: 3,
      }),
    },
    {
      type: "Filter Pro",
      name: "Pulse Dull Filter",
      color: "#d0a5f0",
      position: { x: 288, y: 1120, z: 0 },
      inputs: [{ slot: 0, module: MODULE.pulse }],
      controllers: filterPro({
        type: "lp",
        freq: 4200,
        q: 5800,
        rolloff: "db12",
        response: 150,
        mode: "stereoSmoothing",
      }),
    },
    {
      type: "Delay",
      name: "Pulse Wide Delay",
      color: "#ddc0f5",
      position: { x: 528, y: 1120, z: 0 },
      inputs: [{ slot: 0, module: MODULE.pulseFilter }],
      controllers: delay({
        dry: 244,
        wet: 54,
        delayL: 312,
        delayR: 468,
        delayUnit: "ms",
        delayMultiplier: 1,
        feedback: 2600,
      }),
    },
    {
      type: "Analog generator",
      name: "Air Texture",
      color: "#91a7ff",
      position: { x: 48, y: 1392, z: 0 },
      controllers: analog({
        waveform: "pinkNoise",
        volume: 14,
        panning: 132,
        attack: 86,
        release: 220,
        sustain: "off",
        polyphony: 2,
        mode: "hq",
      }),
    },
    {
      type: "Filter Pro",
      name: "Air Highpass",
      color: "#aab7ff",
      position: { x: 288, y: 1392, z: 0 },
      inputs: [{ slot: 0, module: MODULE.air }],
      controllers: filterPro({
        type: "hp",
        freq: 4200,
        q: 4600,
        rolloff: "db12",
        response: 120,
        mode: "stereoSmoothing",
      }),
    },
    {
      type: "Reverb",
      name: "Air Tail",
      color: "#c1cbff",
      position: { x: 528, y: 1392, z: 0 },
      inputs: [{ slot: 0, module: MODULE.airFilter }],
      controllers: reverb({
        dry: 190,
        wet: 74,
        feedback: 220,
        damp: 210,
        stereoWidth: 250,
        roomSize: 26,
        randomSeed: 95,
      }),
    },
    {
      type: "Amplifier",
      name: "Master Bed Mix",
      color: "#dddddd",
      position: { x: 816, y: 832, z: 0 },
      inputs: [
        { slot: 0, module: MODULE.padReverb },
        { slot: 1, module: MODULE.bassAmp },
        { slot: 2, module: MODULE.pulseDelay },
        { slot: 3, module: MODULE.airReverb },
      ],
      controllers: amplifier({
        volume: 312,
        stereoWidth: 170,
        fineVolume: 32768,
      }),
    },
    {
      type: "Compressor",
      name: "Conversation-Safe Glue",
      color: "#f3f3f3",
      position: { x: 1040, y: 832, z: 0 },
      inputs: [{ slot: 0, module: MODULE.masterMix }],
      controllers: {
        volume: 300,
        threshold: 276,
        slope: 62,
        attack: 14,
        release: 520,
        mode: "rms",
      },
    },
  ];
}

export function buildPodcastBedLoopDocument() {
  return {
    format: TEXT_FORMAT,
    magic: "SVOX",
    headerTailHex: "00000000",
    _comments: [
      "Generated podcast BGM bed.",
      "BPM 96 / TPL 6 / 384 lines = 60 seconds.",
      "Low transient density and muted filters leave room for speech.",
    ],
    project: {
      version: 33554437,
      baseVersion: 33554437,
      flags: {},
      syncFlags: {
        midiStartStopContinue: true,
        otherStartStopContinue: true,
      },
      name: "Podcast Bed Loop",
      bpm: 96,
      speed: 6,
      globalVolume: 72,
      timeline: {
        grid: 4,
        grid2: 4,
      },
      view: {
        moduleScale: 256,
        moduleZoom: 176,
        xOffset: -96,
        yOffset: -96,
      },
      restartPosition: 0,
      selectedModule: MODULE.masterMix,
      lastSelectedGenerator: MODULE.pulse,
      currentPattern: 0,
      currentPatternTrack: 11,
      currentPatternLine: 0,
    },
    patterns: [
      {
        name: "60s Podcast Bed",
        position: { x: 0, y: 0 },
        tracks: TRACKS,
        lines: TOTAL_LINES,
        foreground: "#d7f7ef",
        background: "#22272e",
        events: buildEvents(),
      },
    ],
    modules: modules(),
    trailingChunks: [],
  };
}

export const recipe = {
  schemaVersion: 1,
  tags: ["research:podcast-bgm", "research:generated-music"],
  issue: 38,
  outputs: {
    podcastBedLoop: {
      file: OUTPUT_FILE,
      summaryFile: "var/music-recipe/podcast-bed-loop.summary.json",
      buildDocument: buildPodcastBedLoopDocument,
    },
  },
};

export default recipe;

export async function writePodcastBedLoop(outputFile = OUTPUT_FILE) {
  const outputPath = resolve(outputFile);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, buildContainer(buildPodcastBedLoopDocument()));
  return outputPath;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const outputPath = await writePodcastBedLoop(process.argv[2] ?? OUTPUT_FILE);
  console.log(outputPath);
}

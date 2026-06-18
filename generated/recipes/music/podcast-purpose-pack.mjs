#!/usr/bin/env node
// @ts-check

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildContainer, TEXT_FORMAT } from "../../../tools/sunvox-codec.mjs";

export const OUTPUT_FILES = {
  coldOpenTitle: "generated/music/podcast-cold-open-title.sunvox",
  sectionTransition: "generated/music/podcast-section-transition.sunvox",
  adReadBed: "generated/music/podcast-ad-read-bed.sunvox",
  outroCredits: "generated/music/podcast-outro-credits.sunvox",
};

const TRACKS = 24;
const BAR_LINES = 16;
const AUTO_TRACKS = [20, 21, 22, 23];

const MODULE = {
  output: 0,
  padL: 1,
  padR: 2,
  padFilter: 3,
  padRoom: 4,
  bass: 5,
  bassFilter: 6,
  bassTrim: 7,
  accent: 8,
  accentFilter: 9,
  accentDelay: 10,
  air: 11,
  airFilter: 12,
  airRoom: 13,
  masterMix: 14,
  masterGlue: 15,
};

const PROGRESSIONS = {
  warmLift: [
    { pad: ["D3", "A3", "C4", "E4", "F#4"], bass: ["D2", "A2", "F#2", "C2"], accent: ["A4", "C5", "E5", "F#5"] },
    { pad: ["G2", "D3", "B3", "E4", "A4"], bass: ["G1", "D2", "B1", "E2"], accent: ["B4", "D5", "E5", "A5"] },
    { pad: ["A2", "E3", "G3", "C#4", "E4"], bass: ["A1", "E2", "C#2", "G1"], accent: ["E4", "G4", "C#5", "E5"] },
    { pad: ["F#2", "C#3", "A3", "D4", "E4"], bass: ["F#1", "C#2", "A1", "E2"], accent: ["A4", "C#5", "D5", "E5"] },
  ],
  neutralRead: [
    { pad: ["C3", "G3", "B3", "D4", "E4"], bass: ["C2", "G2", "E2", "B1"], accent: ["E4", "G4", "B4", "D5"] },
    { pad: ["A2", "E3", "G3", "C4", "D4"], bass: ["A1", "E2", "C2", "G1"], accent: ["C4", "E4", "G4", "D5"] },
    { pad: ["F2", "C3", "A3", "D4", "E4"], bass: ["F1", "C2", "A1", "E2"], accent: ["A3", "C4", "D4", "E4"] },
    { pad: ["G2", "D3", "A3", "B3", "D4"], bass: ["G1", "D2", "B1", "A1"], accent: ["B3", "D4", "G4", "A4"] },
  ],
  resolvedClose: [
    { pad: ["E2", "B2", "G#3", "C#4", "E4"], bass: ["E1", "B1", "G#1", "C#2"], accent: ["G#4", "B4", "C#5", "E5"] },
    { pad: ["A2", "E3", "G#3", "B3", "C#4"], bass: ["A1", "E2", "C#2", "G#1"], accent: ["E4", "G#4", "B4", "C#5"] },
    { pad: ["F#2", "C#3", "A3", "B3", "E4"], bass: ["F#1", "C#2", "A1", "B1"], accent: ["A4", "B4", "C#5", "E5"] },
    { pad: ["E2", "B2", "E3", "G#3", "B3"], bass: ["E1", "B1", "E2", "G#1"], accent: ["B3", "E4", "G#4", "B4"] },
  ],
};

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

class EventBuilder {
  constructor(totalLines) {
    this.totalLines = totalLines;
    this.events = [];
    this.usedCells = new Set();
    this.autoUseByLine = new Map();
  }

  push(event) {
    if (!Number.isInteger(event.line) || event.line < 0 || event.line >= this.totalLines) {
      throw new Error(`Event line is outside the loop: ${event.line}`);
    }
    if (!Number.isInteger(event.track) || event.track < 0 || event.track >= TRACKS) {
      throw new Error(`Event track is outside the pattern: ${event.track}`);
    }
    const key = `${event.line}:${event.track}`;
    if (this.usedCells.has(key)) {
      throw new Error(`Duplicate pattern event cell ${key}`);
    }
    this.usedCells.add(key);
    this.events.push(cleanEvent(event));
  }

  note(line, track, module, noteName, velocity) {
    this.push({ line, track, note: noteName, module, velocity });
  }

  noteOff(line, track, module) {
    this.push({ line, track, note: "noteOff", module, velocity: 0 });
  }

  chord(line, firstTrack, module, notes, velocity) {
    notes.forEach((noteName, index) => this.note(line, firstTrack + index, module, noteName, velocity));
  }

  chordOff(line, firstTrack, module, noteCount) {
    for (let index = 0; index < noteCount; index += 1) {
      this.noteOff(line, firstTrack + index, module);
    }
  }

  controller(line, module, controllerName, parameter) {
    const autoIndex = this.autoUseByLine.get(line) ?? 0;
    const track = AUTO_TRACKS[autoIndex];
    if (track === undefined) {
      throw new Error(`Too many controller events on line ${line}`);
    }
    this.autoUseByLine.set(line, autoIndex + 1);
    this.push({ line, track, module, controller: controllerName, parameter });
  }

  sortedEvents() {
    return this.events.sort((a, b) => a.line - b.line || a.track - b.track);
  }
}

function addSustainedPad(builder, bar, progression, velocity) {
  const line = bar * BAR_LINES;
  builder.chord(line, 0, MODULE.padL, progression.pad, velocity);
  builder.chord(line, 5, MODULE.padR, progression.pad, velocity);
  builder.chordOff(line + BAR_LINES - 1, 0, MODULE.padL, progression.pad.length);
  builder.chordOff(line + BAR_LINES - 1, 5, MODULE.padR, progression.pad.length);
}

function addMeasuredBass(builder, bar, progression, velocity, density = "normal") {
  const line = bar * BAR_LINES;
  const offsets = density === "sparse" ? [0, 10] : [0, 6, 10, 14];
  offsets.forEach((offset, index) => {
    builder.note(line + offset, 10, MODULE.bass, progression.bass[index % progression.bass.length], Math.max(28, velocity - index * 5));
  });
}

function addSoftPulse(builder, bar, progression, velocity, offsets) {
  const line = bar * BAR_LINES;
  offsets.forEach((offset, index) => {
    builder.note(line + offset, 11 + (index % 3), MODULE.accent, progression.accent[(bar + index) % progression.accent.length], velocity);
  });
}

function addAirPings(builder, bar, velocity) {
  if (bar % 2 !== 0) {
    return;
  }
  const line = bar * BAR_LINES;
  builder.note(line + 2, 14, MODULE.air, "C6", velocity);
  builder.note(line + 10, 14, MODULE.air, "G6", Math.max(8, velocity - 3));
}

function buildColdOpenTitleEvents(totalLines) {
  const builder = new EventBuilder(totalLines);
  const padFilter = [5200, 6200, 7000, 6600];
  for (let bar = 0; bar < 8; bar += 1) {
    const progression = PROGRESSIONS.warmLift[bar % PROGRESSIONS.warmLift.length];
    addSustainedPad(builder, bar, progression, bar >= 4 ? 40 : 36);
    addMeasuredBass(builder, bar, progression, bar >= 4 ? 58 : 52, bar < 2 ? "sparse" : "normal");
    addSoftPulse(builder, bar, progression, bar >= 4 ? 50 : 42, [2, 6, 10, 14]);
    addAirPings(builder, bar, bar >= 4 ? 18 : 14);
    if (bar % 2 === 0) {
      builder.controller(bar * BAR_LINES, MODULE.padFilter, "freq", padFilter[(bar / 2) % padFilter.length]);
      builder.controller(bar * BAR_LINES, MODULE.accentFilter, "freq", 6400 + bar * 300);
    }
  }
  builder.note(124, 15, MODULE.accent, "D6", 62);
  return builder.sortedEvents();
}

function buildSectionTransitionEvents(totalLines) {
  const builder = new EventBuilder(totalLines);
  const first = PROGRESSIONS.warmLift[0];
  const second = PROGRESSIONS.warmLift[2];
  addSustainedPad(builder, 0, first, 30);
  builder.chordOff(31, 0, MODULE.padL, first.pad.length);
  builder.chordOff(31, 5, MODULE.padR, first.pad.length);
  builder.chord(32, 0, MODULE.padL, second.pad, 34);
  builder.chord(32, 5, MODULE.padR, second.pad, 34);
  builder.chordOff(63, 0, MODULE.padL, second.pad.length);
  builder.chordOff(63, 5, MODULE.padR, second.pad.length);

  [
    [4, "D4", 38],
    [8, "F#4", 42],
    [12, "A4", 44],
    [16, "C5", 46],
    [22, "E5", 48],
    [28, "A5", 52],
    [36, "C5", 44],
    [40, "E5", 46],
    [44, "F#5", 48],
    [48, "A5", 50],
    [54, "C6", 54],
    [60, "D6", 60],
  ].forEach(([line, noteName, velocity], index) => {
    builder.note(line, 11 + (index % 3), MODULE.accent, noteName, velocity);
  });
  builder.note(2, 14, MODULE.air, "C6", 16);
  builder.note(34, 14, MODULE.air, "G6", 18);
  builder.controller(0, MODULE.padFilter, "freq", 4200);
  builder.controller(0, MODULE.accentFilter, "freq", 5600);
  builder.controller(32, MODULE.padFilter, "freq", 7200);
  builder.controller(48, MODULE.accentFilter, "freq", 8200);
  return builder.sortedEvents();
}

function buildAdReadBedEvents(totalLines) {
  const builder = new EventBuilder(totalLines);
  for (let bar = 0; bar < 12; bar += 1) {
    const progression = PROGRESSIONS.neutralRead[bar % PROGRESSIONS.neutralRead.length];
    addSustainedPad(builder, bar, progression, 24);
    addMeasuredBass(builder, bar, progression, 42, "sparse");
    if (bar % 2 === 0) {
      addSoftPulse(builder, bar, progression, 24, [8, 12]);
    }
    if (bar % 4 === 0) {
      addAirPings(builder, bar, 10);
      builder.controller(bar * BAR_LINES, MODULE.padFilter, "freq", 3200 + (bar % 8) * 150);
      builder.controller(bar * BAR_LINES, MODULE.accentFilter, "freq", 3600 + (bar % 8) * 180);
    }
  }
  return builder.sortedEvents();
}

function buildOutroCreditsEvents(totalLines) {
  const builder = new EventBuilder(totalLines);
  for (let bar = 0; bar < 15; bar += 1) {
    const progression = PROGRESSIONS.resolvedClose[bar % PROGRESSIONS.resolvedClose.length];
    const fade = bar >= 11 ? 15 - bar : 4;
    addSustainedPad(builder, bar, progression, Math.max(22, 34 + Math.min(bar, 4) - fade));
    addMeasuredBass(builder, bar, progression, Math.max(34, 48 - Math.max(0, bar - 8) * 2), bar >= 10 ? "sparse" : "normal");
    if (bar < 13 && bar % 2 === 0) {
      addSoftPulse(builder, bar, progression, Math.max(24, 34 - Math.max(0, bar - 8)), [4, 12]);
    }
    if (bar % 3 === 0) {
      addAirPings(builder, bar, Math.max(9, 14 - Math.floor(bar / 3)));
    }
    if (bar % 4 === 0) {
      builder.controller(bar * BAR_LINES, MODULE.padFilter, "freq", Math.max(2600, 5200 - bar * 120));
      builder.controller(bar * BAR_LINES, MODULE.accentFilter, "freq", Math.max(3000, 5200 - bar * 100));
    }
  }
  builder.controller(176, MODULE.masterMix, "volume", 292);
  builder.controller(192, MODULE.masterMix, "volume", 236);
  builder.controller(208, MODULE.masterMix, "volume", 178);
  builder.controller(224, MODULE.masterMix, "volume", 112);
  return builder.sortedEvents();
}

function modules(style) {
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
      name: "Wide Pad L",
      color: style.palette.padL,
      position: { x: 48, y: 352, z: 0 },
      controllers: analog({
        waveform: "saw",
        volume: style.padVolume,
        panning: 94,
        attack: style.padAttack,
        release: 190,
        sustain: "on",
        dutyCycle: 456,
        osc2Pitch: 1005,
        osc2Volume: 11200,
        polyphony: 16,
        mode: "hq",
        noise: style.padNoise,
      }),
    },
    {
      type: "Analog generator",
      name: "Wide Pad R",
      color: style.palette.padR,
      position: { x: 48, y: 544, z: 0 },
      controllers: analog({
        waveform: "saw",
        volume: Math.max(1, style.padVolume - 2),
        panning: 162,
        attack: style.padAttack + 6,
        release: 202,
        sustain: "on",
        dutyCycle: 560,
        osc2Pitch: 995,
        osc2Volume: 10800,
        polyphony: 16,
        mode: "hq",
        noise: style.padNoise,
      }),
    },
    {
      type: "Filter Pro",
      name: "Speech-Space Pad Filter",
      color: style.palette.padFilter,
      position: { x: 288, y: 448, z: 0 },
      inputs: [
        { slot: 0, module: MODULE.padL },
        { slot: 1, module: MODULE.padR },
      ],
      controllers: filterPro({
        type: "lp",
        freq: style.padFreq,
        q: style.padQ,
        rolloff: "db24",
        response: 170,
        mode: "stereoSmoothing",
        lfoFreq: 5,
        lfoAmp: style.padLfo,
      }),
    },
    {
      type: "Reverb",
      name: "Pad Room",
      color: style.palette.padRoom,
      position: { x: 528, y: 448, z: 0 },
      inputs: [{ slot: 0, module: MODULE.padFilter }],
      controllers: reverb({
        dry: 236,
        wet: style.padReverbWet,
        feedback: 188,
        damp: 184,
        stereoWidth: 236,
        roomSize: style.roomSize,
        randomSeed: style.seed,
      }),
    },
    {
      type: "Analog generator",
      name: "Round Bass",
      color: style.palette.bass,
      position: { x: 48, y: 832, z: 0 },
      controllers: analog({
        waveform: "triangle",
        volume: style.bassVolume,
        panning: 128,
        attack: 0,
        release: 34,
        sustain: "off",
        dutyCycle: 512,
        osc2Pitch: 500,
        osc2Volume: 5600,
        polyphony: 4,
        mode: "hqMono",
      }),
    },
    {
      type: "Filter Pro",
      name: "Bass Warm Filter",
      color: style.palette.bassFilter,
      position: { x: 288, y: 832, z: 0 },
      inputs: [{ slot: 0, module: MODULE.bass }],
      controllers: filterPro({
        type: "lp",
        freq: style.bassFreq,
        q: 6800,
        rolloff: "db24",
        response: 115,
        mode: "stereo",
      }),
    },
    {
      type: "Amplifier",
      name: "Bass Trim",
      color: style.palette.bassTrim,
      position: { x: 528, y: 832, z: 0 },
      inputs: [{ slot: 0, module: MODULE.bassFilter }],
      controllers: amplifier({
        volume: style.bassTrim,
        stereoWidth: 110,
        fineVolume: 32768,
      }),
    },
    {
      type: "Analog generator",
      name: "Use-Case Accent",
      color: style.palette.accent,
      position: { x: 48, y: 1120, z: 0 },
      controllers: analog({
        waveform: style.accentWaveform,
        volume: style.accentVolume,
        panning: 128,
        attack: style.accentAttack,
        release: style.accentRelease,
        sustain: "off",
        dutyCycle: 428,
        osc2Pitch: style.accentOsc2Pitch,
        osc2Volume: style.accentOsc2Volume,
        polyphony: 10,
        mode: "hq",
        noise: style.accentNoise,
      }),
    },
    {
      type: "Filter Pro",
      name: "Accent Filter",
      color: style.palette.accentFilter,
      position: { x: 288, y: 1120, z: 0 },
      inputs: [{ slot: 0, module: MODULE.accent }],
      controllers: filterPro({
        type: "lp",
        freq: style.accentFreq,
        q: style.accentQ,
        rolloff: "db12",
        response: 145,
        mode: "stereoSmoothing",
      }),
    },
    {
      type: "Delay",
      name: "Accent Delay",
      color: style.palette.accentDelay,
      position: { x: 528, y: 1120, z: 0 },
      inputs: [{ slot: 0, module: MODULE.accentFilter }],
      controllers: delay({
        dry: 244,
        wet: style.accentDelayWet,
        delayL: style.delayL,
        delayR: style.delayR,
        delayUnit: "ms",
        delayMultiplier: 1,
        feedback: style.delayFeedback,
      }),
    },
    {
      type: "Analog generator",
      name: "Air Texture",
      color: style.palette.air,
      position: { x: 48, y: 1392, z: 0 },
      controllers: analog({
        waveform: "pinkNoise",
        volume: style.airVolume,
        panning: 132,
        attack: 80,
        release: 224,
        sustain: "off",
        polyphony: 2,
        mode: "hq",
      }),
    },
    {
      type: "Filter Pro",
      name: "Air Highpass",
      color: style.palette.airFilter,
      position: { x: 288, y: 1392, z: 0 },
      inputs: [{ slot: 0, module: MODULE.air }],
      controllers: filterPro({
        type: "hp",
        freq: style.airFreq,
        q: 4400,
        rolloff: "db12",
        response: 115,
        mode: "stereoSmoothing",
      }),
    },
    {
      type: "Reverb",
      name: "Air Tail",
      color: style.palette.airRoom,
      position: { x: 528, y: 1392, z: 0 },
      inputs: [{ slot: 0, module: MODULE.airFilter }],
      controllers: reverb({
        dry: 188,
        wet: style.airReverbWet,
        feedback: 214,
        damp: 206,
        stereoWidth: 250,
        roomSize: style.roomSize + 2,
        randomSeed: style.seed + 17,
      }),
    },
    {
      type: "Amplifier",
      name: "Purpose Mix",
      color: "#dddddd",
      position: { x: 816, y: 832, z: 0 },
      inputs: [
        { slot: 0, module: MODULE.padRoom },
        { slot: 1, module: MODULE.bassTrim },
        { slot: 2, module: MODULE.accentDelay },
        { slot: 3, module: MODULE.airRoom },
      ],
      controllers: amplifier({
        volume: style.masterVolume,
        stereoWidth: style.stereoWidth,
        fineVolume: 32768,
      }),
    },
    {
      type: "Compressor",
      name: "Podcast Glue",
      color: "#f3f3f3",
      position: { x: 1040, y: 832, z: 0 },
      inputs: [{ slot: 0, module: MODULE.masterMix }],
      controllers: {
        volume: style.glueVolume,
        threshold: style.compressorThreshold,
        slope: style.compressorSlope,
        attack: 12,
        release: 500,
        mode: "rms",
      },
    },
  ];
}

const TRACK_DEFINITIONS = [
  {
    id: "coldOpenTitle",
    outputFile: OUTPUT_FILES.coldOpenTitle,
    projectName: "Podcast Cold Open Title",
    patternName: "16s Cold Open Title",
    bpm: 120,
    lines: 128,
    globalVolume: 74,
    currentPatternTrack: 11,
    comments: [
      "Generated podcast title/opening cue.",
      "BPM 120 / TPL 6 / 128 lines = 16 seconds.",
      "Brighter pulses and a clear final accent for show intros.",
    ],
    colors: { foreground: "#fbe8a6", background: "#27231d" },
    style: {
      seed: 41,
      padVolume: 38,
      padAttack: 30,
      padNoise: 5,
      padFreq: 5200,
      padQ: 8800,
      padLfo: 70,
      padReverbWet: 52,
      bassVolume: 58,
      bassFreq: 2600,
      bassTrim: 196,
      accentWaveform: "triangle",
      accentVolume: 36,
      accentAttack: 0,
      accentRelease: 48,
      accentOsc2Pitch: 1200,
      accentOsc2Volume: 7000,
      accentNoise: 3,
      accentFreq: 6200,
      accentQ: 6200,
      accentDelayWet: 76,
      delayL: 220,
      delayR: 330,
      delayFeedback: 3300,
      airVolume: 16,
      airFreq: 5000,
      airReverbWet: 80,
      roomSize: 24,
      masterVolume: 336,
      stereoWidth: 178,
      glueVolume: 308,
      compressorThreshold: 286,
      compressorSlope: 68,
      palette: {
        padL: "#d3a95f",
        padR: "#e2bb72",
        padFilter: "#f0ca88",
        padRoom: "#f4d9a8",
        bass: "#f0b35b",
        bassFilter: "#f4c97e",
        bassTrim: "#f7dfae",
        accent: "#79c7ff",
        accentFilter: "#99d6ff",
        accentDelay: "#b8e5ff",
        air: "#c9d6ff",
        airFilter: "#d5ddff",
        airRoom: "#e2e8ff",
      },
    },
    buildEvents: buildColdOpenTitleEvents,
  },
  {
    id: "sectionTransition",
    outputFile: OUTPUT_FILES.sectionTransition,
    projectName: "Podcast Section Transition",
    patternName: "8s Section Transition",
    bpm: 120,
    lines: 64,
    globalVolume: 144,
    currentPatternTrack: 11,
    comments: [
      "Generated podcast section transition cue.",
      "BPM 120 / TPL 6 / 64 lines = 8 seconds.",
      "Short rising motif for moving between topics without a hard stop.",
    ],
    colors: { foreground: "#aee8ff", background: "#1c2630" },
    style: {
      seed: 73,
      padVolume: 32,
      padAttack: 20,
      padNoise: 3,
      padFreq: 4600,
      padQ: 8200,
      padLfo: 60,
      padReverbWet: 58,
      bassVolume: 30,
      bassFreq: 2200,
      bassTrim: 150,
      accentWaveform: "triangle",
      accentVolume: 42,
      accentAttack: 0,
      accentRelease: 56,
      accentOsc2Pitch: 1212,
      accentOsc2Volume: 8200,
      accentNoise: 2,
      accentFreq: 5800,
      accentQ: 5600,
      accentDelayWet: 92,
      delayL: 180,
      delayR: 270,
      delayFeedback: 3600,
      airVolume: 18,
      airFreq: 5400,
      airReverbWet: 86,
      roomSize: 26,
      masterVolume: 318,
      stereoWidth: 188,
      glueVolume: 300,
      compressorThreshold: 286,
      compressorSlope: 66,
      palette: {
        padL: "#72b6c8",
        padR: "#86c8d8",
        padFilter: "#9ad8e8",
        padRoom: "#b8e8f1",
        bass: "#d2c16a",
        bassFilter: "#dfd088",
        bassTrim: "#eadfaa",
        accent: "#8bd17c",
        accentFilter: "#a8df9f",
        accentDelay: "#c0ecc0",
        air: "#97a8ff",
        airFilter: "#b0bdff",
        airRoom: "#c7d0ff",
      },
    },
    buildEvents: buildSectionTransitionEvents,
  },
  {
    id: "adReadBed",
    outputFile: OUTPUT_FILES.adReadBed,
    projectName: "Podcast Ad Read Bed",
    patternName: "30s Ad Read Bed",
    bpm: 96,
    lines: 192,
    globalVolume: 160,
    currentPatternTrack: 0,
    comments: [
      "Generated sponsor/ad-read bed.",
      "BPM 96 / TPL 6 / 192 lines = 30 seconds.",
      "Low pulse density and dull filtering keep narration dominant.",
    ],
    colors: { foreground: "#d5eadc", background: "#222822" },
    style: {
      seed: 104,
      padVolume: 58,
      padAttack: 56,
      padNoise: 4,
      padFreq: 3200,
      padQ: 7600,
      padLfo: 44,
      padReverbWet: 42,
      bassVolume: 72,
      bassFreq: 1800,
      bassTrim: 236,
      accentWaveform: "triangle",
      accentVolume: 34,
      accentAttack: 2,
      accentRelease: 46,
      accentOsc2Pitch: 1007,
      accentOsc2Volume: 4200,
      accentNoise: 2,
      accentFreq: 3600,
      accentQ: 4600,
      accentDelayWet: 38,
      delayL: 300,
      delayR: 450,
      delayFeedback: 1800,
      airVolume: 18,
      airFreq: 4600,
      airReverbWet: 58,
      roomSize: 18,
      masterVolume: 430,
      stereoWidth: 154,
      glueVolume: 420,
      compressorThreshold: 272,
      compressorSlope: 58,
      palette: {
        padL: "#82a884",
        padR: "#93b894",
        padFilter: "#abcaa8",
        padRoom: "#bdd9bc",
        bass: "#d2bc76",
        bassFilter: "#decd91",
        bassTrim: "#ebdfb4",
        accent: "#9baac5",
        accentFilter: "#b0bed4",
        accentDelay: "#c8d2e1",
        air: "#a9b7ce",
        airFilter: "#bdc8d9",
        airRoom: "#d3dae4",
      },
    },
    buildEvents: buildAdReadBedEvents,
  },
  {
    id: "outroCredits",
    outputFile: OUTPUT_FILES.outroCredits,
    projectName: "Podcast Outro Credits",
    patternName: "45s Outro Credits",
    bpm: 80,
    lines: 240,
    globalVolume: 144,
    currentPatternTrack: 0,
    comments: [
      "Generated podcast outro/credits cue.",
      "BPM 80 / TPL 6 / 240 lines = 45 seconds.",
      "Resolved harmony with a built-in master fade for closing narration.",
    ],
    colors: { foreground: "#ead7ff", background: "#282231" },
    style: {
      seed: 139,
      padVolume: 36,
      padAttack: 64,
      padNoise: 5,
      padFreq: 4600,
      padQ: 8200,
      padLfo: 55,
      padReverbWet: 56,
      bassVolume: 50,
      bassFreq: 2100,
      bassTrim: 176,
      accentWaveform: "triangle",
      accentVolume: 26,
      accentAttack: 4,
      accentRelease: 64,
      accentOsc2Pitch: 1005,
      accentOsc2Volume: 5200,
      accentNoise: 3,
      accentFreq: 4800,
      accentQ: 5200,
      accentDelayWet: 72,
      delayL: 380,
      delayR: 570,
      delayFeedback: 3100,
      airVolume: 13,
      airFreq: 4800,
      airReverbWet: 76,
      roomSize: 28,
      masterVolume: 310,
      stereoWidth: 176,
      glueVolume: 292,
      compressorThreshold: 278,
      compressorSlope: 62,
      palette: {
        padL: "#b59ad7",
        padR: "#c6aee5",
        padFilter: "#d6c1ee",
        padRoom: "#e4d5f4",
        bass: "#c9b26f",
        bassFilter: "#d6c489",
        bassTrim: "#e7d9ac",
        accent: "#82c6b0",
        accentFilter: "#9ed6c4",
        accentDelay: "#bee6d8",
        air: "#a9b8ee",
        airFilter: "#c0cbf4",
        airRoom: "#d6def8",
      },
    },
    buildEvents: buildOutroCreditsEvents,
  },
];

export function buildPodcastPurposeDocument(definition) {
  return {
    format: TEXT_FORMAT,
    magic: "SVOX",
    headerTailHex: "00000000",
    _comments: definition.comments,
    project: {
      version: 33554437,
      baseVersion: 33554437,
      flags: {},
      syncFlags: {
        midiStartStopContinue: true,
        otherStartStopContinue: true,
      },
      name: definition.projectName,
      bpm: definition.bpm,
      speed: 6,
      globalVolume: definition.globalVolume,
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
      lastSelectedGenerator: MODULE.accent,
      currentPattern: 0,
      currentPatternTrack: definition.currentPatternTrack,
      currentPatternLine: 0,
    },
    patterns: [
      {
        name: definition.patternName,
        position: { x: 0, y: 0 },
        tracks: TRACKS,
        lines: definition.lines,
        foreground: definition.colors.foreground,
        background: definition.colors.background,
        events: definition.buildEvents(definition.lines),
      },
    ],
    modules: modules(definition.style),
    trailingChunks: [],
  };
}

export function buildPodcastPurposeDocuments() {
  return Object.fromEntries(TRACK_DEFINITIONS.map((definition) => [definition.id, buildPodcastPurposeDocument(definition)]));
}

function summaryFileForDefinition(definition) {
  return `var/music-recipe/${definition.outputFile.split("/").at(-1).replace(/\.sunvox$/u, ".summary.json")}`;
}

export const recipe = {
  schemaVersion: 1,
  tags: ["research:podcast-bgm", "research:generated-music"],
  issue: 38,
  outputs: Object.fromEntries(
    TRACK_DEFINITIONS.map((definition) => [
      definition.id,
      {
        file: definition.outputFile,
        summaryFile: summaryFileForDefinition(definition),
        buildDocument: () => buildPodcastPurposeDocument(definition),
      },
    ]),
  ),
};

export default recipe;

export async function writePodcastPurposePack(outputFiles = OUTPUT_FILES) {
  const written = [];
  for (const definition of TRACK_DEFINITIONS) {
    const outputPath = resolve(outputFiles[definition.id] ?? definition.outputFile);
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, buildContainer(buildPodcastPurposeDocument(definition)));
    written.push(outputPath);
  }
  return written;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const written = await writePodcastPurposePack();
  for (const outputPath of written) {
    console.log(outputPath);
  }
}

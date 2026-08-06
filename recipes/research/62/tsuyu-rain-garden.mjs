#!/usr/bin/env node
// @ts-check

import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildContainer, TEXT_FORMAT } from "../../../tools/sunvox-codec.mjs";
import { deterministicIconBase64 } from "../../../tools/sunvox-music-recipe-helpers.mjs";

const PROJECT_PATH = "var/62/tsuyu-rain-garden.sunvox";
const SUMMARY_PATH = "var/62/tsuyu-rain-garden.summary.json";
const BPM = 108;
const SPEED = 6;
const LINES = 256;
const TRACKS = 20;
const BAR_LINES = 16;

const MODULE = Object.freeze({
  output: 0,
  thunder: 1,
  rainDrum: 2,
  rainDrop: 3,
  rainDropDelay: 4,
  bass: 5,
  bassFilter: 6,
  pad: 7,
  padFilter: 8,
  koto: 9,
  kotoDelay: 10,
  mist: 11,
  mistFilter: 12,
  rainRoom: 13,
  musicBus: 14,
  master: 15,
  percussionBus: 16,
  rainTone: 17,
  lead: 18,
});

const TRACK = Object.freeze({
  thunder: 0,
  rainDrum: 1,
  dropA: 2,
  dropB: 3,
  bass: 4,
  padA: 5,
  padB: 6,
  padC: 7,
  padD: 8,
  kotoA: 9,
  kotoB: 10,
  mist: 11,
  autoA: 12,
  autoB: 13,
  autoC: 14,
  autoD: 15,
  dropC: 16,
  kotoTail: 17,
  rainTone: 18,
  lead: 19,
});

const SEMITONE_TO_NAME = Object.freeze(["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]);
const NOTE_TO_SEMITONE = new Map(SEMITONE_TO_NAME.map((name, index) => [name, index]));

const harmony = Object.freeze([
  {
    root: "D2",
    symbol: "i9",
    bass: ["D2", "A2", "F2", "C3"],
    pad: ["D4", "F4", "A4", "E5"],
    koto: ["A5", "E5", "F5", "D5", "C5"],
  },
  {
    root: "A#1",
    symbol: "bvi(add9)",
    bass: ["A#1", "F2", "C#2", "C3"],
    pad: ["A#3", "C#4", "F4", "C5"],
    koto: ["F5", "C5", "C#5", "A#4", "G#4"],
  },
  {
    root: "F2",
    symbol: "iii(add9)",
    bass: ["F2", "C3", "G#2", "G2"],
    pad: ["F3", "G#3", "C4", "G4"],
    koto: ["C5", "G#5", "G5", "D#5", "F5"],
  },
  {
    root: "C2",
    symbol: "vii(add9)",
    bass: ["C2", "G2", "D#2", "D3"],
    pad: ["C4", "D#4", "G4", "D5"],
    koto: ["G5", "D5", "C5", "D#5", "A#4"],
  },
  {
    root: "G1",
    symbol: "iv9",
    bass: ["G1", "D2", "A#2", "F2"],
    pad: ["G3", "A#3", "D4", "A4"],
    koto: ["D5", "F5", "A5", "A#5", "D6"],
  },
  {
    root: "A1",
    symbol: "V7sus(b9)",
    bass: ["A1", "E2", "G2", "A#2"],
    pad: ["A3", "D4", "E4", "A#4"],
    koto: ["E5", "A#5", "D6", "C#6", "A5"],
  },
  {
    root: "D2",
    symbol: "i(add11)",
    bass: ["D2", "A2", "G2", "F2"],
    pad: ["D4", "G4", "A4", "F5"],
    koto: ["A5", "G5", "F5", "D5", "A4"],
  },
  {
    root: "A1",
    symbol: "V7(b9)",
    bass: ["A1", "E2", "C#3", "A#2"],
    pad: ["C#4", "E4", "G4", "A#4"],
    koto: ["C#6", "E6", "A#5", "G5", "D6"],
  },
]);

const arrangement = Object.freeze(
  [0, 0, 1, 2, 3, 4, 5, 6, 1, 2, 4, 5, 6, 7, 0, 0].map((index) => harmony[index]),
);

function analog(overrides = {}) {
  return {
    volume: 84,
    waveform: "triangle",
    panning: 128,
    attack: 0,
    release: 64,
    sustain: "on",
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
    osc2Volume: 8192,
    osc2Mode: "add",
    osc2Phase: 0,
    ...overrides,
  };
}

function filterPro(overrides = {}) {
  return {
    volume: 32768,
    type: "lp",
    freq: 6000,
    freqFinetune: 1000,
    freqScale: 100,
    expFreq: "on",
    q: 9000,
    gain: 16384,
    rolloff: "db24",
    response: 180,
    mode: "stereoSmoothing",
    mix: 32768,
    lfoFreq: 5,
    lfoAmp: 0,
    lfoWaveform: "sin",
    setLfoPhase: 0,
    lfoFreqUnit: "line",
    ...overrides,
  };
}

function modules() {
  return [
    {
      flags: { exists: true, output: true },
      name: "Output",
      position: { x: 1350, y: 560, z: 0 },
      inputs: [{ slot: 0, module: MODULE.master }],
    },
    {
      type: "Kicker",
      name: "Distant Thunder",
      color: "#536976",
      position: { x: 80, y: 160, z: 0 },
      controllers: {
        volume: 30,
        waveform: "sin",
        panning: 128,
        attack: 1,
        release: 86,
        boost: 220,
        acceleration: 94,
        polyphony: 1,
        noClick: "on",
      },
    },
    {
      type: "DrumSynth",
      name: "Roof Rain",
      color: "#8bc9d9",
      position: { x: 80, y: 320, z: 0 },
      controllers: {
        volume: 112,
        panning: 128,
        polyphony: 8,
        bassVolume: 52,
        bassPower: 136,
        bassTone: 68,
        bassLength: 30,
        hihatVolume: 124,
        hihatLength: 18,
        snareVolume: 62,
        snareTone: 210,
        snareLength: 26,
        bassPan: 128,
        hihatPan: 178,
        snarePan: 92,
      },
    },
    {
      type: "Analog generator",
      name: "Eaves Droplets",
      color: "#b8f5ff",
      position: { x: 80, y: 500, z: 0 },
      controllers: analog({
        volume: 84,
        waveform: "sin",
        panning: 156,
        attack: 0,
        release: 22,
        sustain: "off",
        polyphony: 10,
        osc2Pitch: 2000,
        osc2Volume: 8800,
        osc2Mode: "mul",
        filter: "hp12db",
        filterFreq: 5000,
        filterResonance: 440,
      }),
    },
    {
      type: "Delay",
      name: "Droplet Ripples",
      color: "#9ee3ee",
      position: { x: 330, y: 500, z: 0 },
      inputs: [{ slot: 0, module: MODULE.rainDrop }],
      controllers: {
        dry: 238,
        wet: 70,
        delayL: 3,
        delayR: 5,
        volumeL: 244,
        volumeR: 228,
        channels: "stereo",
        inverse: "off",
        delayUnit: "line",
        delayMultiplier: 1,
        feedback: 174,
        negativeFeedback: "off",
        allpassFilter: "on",
      },
    },
    {
      type: "Analog generator",
      name: "Wet Sub",
      color: "#4f7c68",
      position: { x: 80, y: 720, z: 0 },
      controllers: analog({
        volume: 104,
        waveform: "triangle",
        panning: 128,
        release: 42,
        sustain: "off",
        polyphony: 2,
        mode: "hqMono",
        osc2Pitch: 500,
        osc2Volume: 5200,
        filter: "lp24db",
        filterFreq: 3000,
        filterResonance: 260,
      }),
    },
    {
      type: "Filter Pro",
      name: "Sub Moss Filter",
      color: "#6da68b",
      position: { x: 330, y: 720, z: 0 },
      inputs: [{ slot: 0, module: MODULE.bass }],
      controllers: filterPro({
        type: "lp",
        freq: 2400,
        q: 8200,
        rolloff: "db24",
        response: 150,
        lfoFreq: 8,
        lfoAmp: 320,
      }),
    },
    {
      type: "Analog generator",
      name: "Hydrangea Pad",
      color: "#9fa8da",
      position: { x: 80, y: 920, z: 0 },
      controllers: analog({
        volume: 58,
        waveform: "triangle",
        panning: 120,
        attack: 36,
        release: 176,
        dutyCycle: 468,
        osc2Pitch: 1005,
        osc2Volume: 9800,
        polyphony: 12,
        filter: "lp12db",
        filterFreq: 4200,
        filterResonance: 120,
        filterAttack: 24,
        filterRelease: 160,
        filterEnvelope: "sustainOn",
      }),
    },
    {
      type: "Filter Pro",
      name: "Cloud Filter",
      color: "#b7bee8",
      position: { x: 330, y: 920, z: 0 },
      inputs: [{ slot: 0, module: MODULE.pad }],
      controllers: filterPro({
        type: "lp",
        freq: 3500,
        q: 7200,
        rolloff: "db36",
        response: 210,
        lfoFreq: 4,
        lfoAmp: 460,
      }),
    },
    {
      type: "Analog generator",
      name: "Rain Koto",
      color: "#e7d28b",
      position: { x: 80, y: 1120, z: 0 },
      controllers: analog({
        volume: 74,
        waveform: "triangle",
        panning: 98,
        attack: 0,
        release: 54,
        sustain: "off",
        dutyCycle: 384,
        osc2Pitch: 2000,
        osc2Volume: 13200,
        osc2Mode: "mul",
        polyphony: 6,
        filter: "lp12db",
        filterFreq: 6800,
        filterResonance: 260,
      }),
    },
    {
      type: "Echo",
      name: "Koto Alley Echo",
      color: "#f2df9e",
      position: { x: 330, y: 1120, z: 0 },
      inputs: [{ slot: 0, module: MODULE.koto }],
      controllers: {
        dry: 256,
        wet: 42,
        feedback: 82,
        delay: 6,
        rightChannelOffset: "on",
        delayUnit: "line",
        rightChannelOffsetValue: 15200,
        filter: "lp6db",
        filterFreq: 4800,
      },
    },
    {
      type: "Analog generator",
      name: "Humidity Mist",
      color: "#cfe8d5",
      position: { x: 80, y: 1320, z: 0 },
      controllers: analog({
        volume: 18,
        waveform: "pinkNoise",
        panning: 138,
        attack: 110,
        release: 256,
        sustain: "off",
        polyphony: 2,
        noise: 80,
        osc2Volume: 0,
        filter: "hp12db",
        filterFreq: 2600,
        filterResonance: 260,
      }),
    },
    {
      type: "Filter Pro",
      name: "Mist High Canopy",
      color: "#d9f0df",
      position: { x: 330, y: 1320, z: 0 },
      inputs: [{ slot: 0, module: MODULE.mist }],
      controllers: filterPro({
        type: "bpConstSkirtGain",
        freq: 4800,
        q: 5200,
        rolloff: "db12",
        response: 100,
        lfoFreq: 3,
        lfoAmp: 900,
      }),
    },
    {
      type: "Reverb",
      name: "Rain Garden Room",
      color: "#d3e2ef",
      position: { x: 620, y: 720, z: 0 },
      inputs: [
        { slot: 0, module: MODULE.percussionBus },
        { slot: 1, module: MODULE.rainDropDelay },
        { slot: 2, module: MODULE.padFilter },
        { slot: 3, module: MODULE.kotoDelay },
        { slot: 4, module: MODULE.mistFilter },
        { slot: 5, module: MODULE.lead },
      ],
      controllers: {
        dry: 236,
        wet: 54,
        feedback: 196,
        damp: 190,
        stereoWidth: 244,
        freeze: "off",
        mode: "hq",
        allpassFilter: "improved",
        roomSize: 24,
        randomSeed: 606,
      },
    },
    {
      type: "Amplifier",
      name: "Wet Music Bus",
      color: "#d7dce5",
      position: { x: 900, y: 720, z: 0 },
      inputs: [
        { slot: 0, module: MODULE.thunder },
        { slot: 1, module: MODULE.bassFilter },
        { slot: 2, module: MODULE.rainRoom },
      ],
      controllers: {
        volume: 1024,
        balance: 128,
        dcOffset: 128,
        inverse: "off",
        stereoWidth: 214,
        absolute: "off",
        fineVolume: 32768,
      },
    },
    {
      type: "Compressor",
      name: "Soft Rain Glue",
      color: "#cfd3d4",
      position: { x: 1140, y: 720, z: 0 },
      inputs: [{ slot: 0, module: MODULE.musicBus }],
      controllers: {
        volume: 252,
        threshold: 332,
        slope: 78,
        attack: 9,
        release: 310,
        mode: "peak",
        sideChainInput: 0,
      },
    },
    {
      type: "Amplifier",
      name: "Rain Percussion Bus",
      color: "#9fcbd6",
      position: { x: 390, y: 320, z: 0 },
      inputs: [
        { slot: 0, module: MODULE.rainDrum },
        { slot: 1, module: MODULE.rainTone },
      ],
      controllers: {
        volume: 196,
        balance: 128,
        dcOffset: 128,
        inverse: "off",
        stereoWidth: 188,
        absolute: "off",
        fineVolume: 32768,
      },
    },
    {
      type: "Analog generator",
      name: "Rain Marimba",
      color: "#708c86",
      position: { x: 80, y: 400, z: 0 },
      controllers: analog({
        volume: 84,
        waveform: "sin",
        panning: 118,
        attack: 0,
        release: 46,
        sustain: "off",
        polyphony: 4,
        mode: "hq",
        osc2Pitch: 2000,
        osc2Volume: 2600,
        osc2Mode: "add",
        filter: "lp12db",
        filterFreq: 5200,
        filterResonance: 120,
      }),
    },
    {
      type: "Analog generator",
      name: "Mourning Reed",
      color: "#657080",
      position: { x: 330, y: 1040, z: 0 },
      controllers: analog({
        volume: 68,
        waveform: "triangle",
        panning: 142,
        attack: 8,
        release: 92,
        sustain: "off",
        polyphony: 2,
        mode: "hqMono",
        dutyCycle: 430,
        osc2Pitch: 1003,
        osc2Volume: 6200,
        osc2Mode: "add",
        filter: "lp12db",
        filterFreq: 4300,
        filterResonance: 210,
      }),
    },
  ];
}

function cleanEvent(event) {
  return Object.fromEntries(Object.entries(event).filter(([, value]) => value !== undefined));
}

function pushEvent(events, usedCells, event) {
  if (!Number.isInteger(event.line) || event.line < 0 || event.line >= LINES) {
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

function note(events, usedCells, { line, track, module, note: noteName, velocity = 88, gate = 1, effect, parameter }) {
  pushEvent(events, usedCells, {
    line,
    track,
    module,
    note: noteName,
    velocity,
    effect,
    parameter,
  });
  if (gate > 0 && line + gate < LINES) {
    pushEvent(events, usedCells, { line: line + gate, track, module, note: "noteOff", velocity: 0 });
  }
}

function controller(events, usedCells, lineUse, { line, module, controller: controllerName, parameter }) {
  const autoTracks = [TRACK.autoA, TRACK.autoB, TRACK.autoC, TRACK.autoD];
  const index = lineUse.get(line) ?? 0;
  const track = autoTracks[index];
  if (track === undefined) {
    throw new Error(`Too many controller events on line ${line}`);
  }
  lineUse.set(line, index + 1);
  pushEvent(events, usedCells, { line, track, module, controller: controllerName, parameter });
}

function chord(events, usedCells, { line, tracks, module, notes, velocity = 44, gate = 14 }) {
  notes.forEach((noteName, index) => {
    note(events, usedCells, { line, track: tracks[index], module, note: noteName, velocity, gate });
  });
}

function parseNote(noteName) {
  const match = /^([A-G]#?)(-?\d+)$/u.exec(noteName);
  if (!match) {
    throw new Error(`Bad note: ${noteName}`);
  }
  const semitone = NOTE_TO_SEMITONE.get(match[1]);
  if (semitone === undefined) {
    throw new Error(`Bad note base: ${noteName}`);
  }
  return Number(match[2]) * 12 + semitone;
}

function formatNote(value) {
  const semitone = ((value % 12) + 12) % 12;
  const octave = Math.floor((value - semitone) / 12);
  return `${SEMITONE_TO_NAME[semitone]}${octave}`;
}

function transpose(noteName, semitones) {
  return formatNote(parseNote(noteName) + semitones);
}

function addRain(events, usedCells) {
  for (let bar = 0; bar < arrangement.length; bar += 1) {
    const line = bar * BAR_LINES;
    const dripOffsets =
      bar < 2
        ? [1, 5, 10, 14]
        : bar >= 10 && bar < 14
          ? [0, 2, 3, 5, 6, 7, 9, 10, 12, 14]
          : [1, 3, 6, 7, 10, 13, 15];
    for (const offset of dripOffsets) {
      const dripAccent = offset === 6 || offset === 13 ? 18 : offset === 1 || offset === 10 ? 8 : 0;
      note(events, usedCells, {
        line: line + offset,
        track: offset % 3 === 0 ? TRACK.dropA : offset % 3 === 1 ? TRACK.dropB : TRACK.dropC,
        module: MODULE.rainDrop,
        note: offset % 2 === 0 ? "G6" : offset === 13 ? "D#6" : "C6",
        velocity: Math.min(102, 38 + ((bar * 5 + offset * 7) % 38) + dripAccent),
        gate: 0,
      });
    }
    const percussionOffsets =
      bar === 0
        ? []
        : bar === 1
          ? [8]
          : bar < 6
            ? [0, 8]
            : bar < 10
              ? [0, 4, 8, 12]
              : bar < 14
                ? [0, 4, 8, 12]
                : bar === 14
                  ? [0, 8]
                  : [0];
    for (const offset of percussionOffsets) {
      const downbeat = offset % 8 === 0;
      const climax = bar >= 10 && bar < 14;
      note(events, usedCells, {
        line: line + offset,
        track: TRACK.rainDrum,
        module: MODULE.rainDrum,
        note: downbeat ? "D3" : "D#3",
        velocity: Math.min(
          88,
          (downbeat ? 54 : 42) + (climax ? 6 : bar >= 6 ? 3 : 0) + ((bar + offset) % 4),
        ),
        gate: 0,
      });
    }
    const pitchedOffsets =
      bar < 2 ? (bar === 1 ? [8] : []) : bar >= 10 && bar < 14 ? [0, 4, 8, 12] : [0, 8];
    const pitchedIntervals = [24, 31, 27, 31];
    for (const [index, offset] of pitchedOffsets.entries()) {
      note(events, usedCells, {
        line: line + offset,
        track: TRACK.rainTone,
        module: MODULE.rainTone,
        note: transpose(arrangement[bar].root, pitchedIntervals[index]),
        velocity: bar >= 10 && bar < 14 ? 66 - index * 2 : bar >= 6 ? 58 - index * 2 : 54 - index * 2,
        gate: 3,
      });
    }
    if ([0, 7, 10, 13].includes(bar)) {
      note(events, usedCells, {
        line,
        track: TRACK.thunder,
        module: MODULE.thunder,
        note: "C2",
        velocity: bar === 0 ? 64 : bar === 13 ? 88 : 76,
        gate: 2,
      });
    }
  }
}

function addBass(events, usedCells) {
  for (let bar = 2; bar < arrangement.length - 1; bar += 1) {
    const base = bar * BAR_LINES;
    const entry = arrangement[bar];
    for (const [offset, index, velocity, gate] of [
      [0, 0, bar >= 10 && bar < 14 ? 94 : 82, 3],
      [6, 1, 64, 2],
      [10, 2, 70, 2],
      [14, 3, bar === 14 ? 42 : 54, 1],
    ]) {
      note(events, usedCells, {
        line: base + offset,
        track: TRACK.bass,
        module: MODULE.bass,
        note: entry.bass[index],
        velocity,
        gate,
        ...(offset === 14 ? { effect: "tonePortamento", parameter: { speed: 62 } } : {}),
      });
    }
  }
}

function addPads(events, usedCells) {
  for (let bar = 1; bar < arrangement.length; bar += 1) {
    chord(events, usedCells, {
      line: bar * BAR_LINES,
      tracks: [TRACK.padA, TRACK.padB, TRACK.padC, TRACK.padD],
      module: MODULE.pad,
      notes: arrangement[bar].pad,
      velocity: bar === 1 ? 30 : bar >= 10 && bar < 14 ? 52 : bar >= 14 ? 36 : 43,
      gate: 15,
    });
  }
}

function addKoto(events, usedCells) {
  const offsets = [2, 5, 9, 12, 15];
  for (let bar = 2; bar < arrangement.length - 1; bar += 1) {
    const lineBase = bar * BAR_LINES;
    const noteCount = bar < 6 ? 3 : bar >= 14 ? 2 : 5;
    arrangement[bar].koto.slice(0, noteCount).forEach((noteName, index) => {
      note(events, usedCells, {
        line: lineBase + offsets[index],
        track: index % 2 === 0 ? TRACK.kotoA : TRACK.kotoB,
        module: MODULE.koto,
        note: noteName,
        velocity:
          bar >= 10 && bar < 14 ? 80 - index * 4 : bar >= 6 ? 70 - index * 4 : 58 - index * 3,
        gate: index === 4 ? 0 : 2,
        ...(index === 2 && bar % 2 === 1 ? { effect: "vibrato", parameter: { speed: 4, amplitude: 12 } } : {}),
      });
    });
  }

  for (const [line, noteName, velocity, amount] of [
    [95, "D#5", 46, 80],
    [159, "G#5", 54, 80],
    [223, "F5", 58, 96],
    [248, "D5", 68, 140],
  ]) {
    note(events, usedCells, {
      line,
      track: TRACK.kotoTail,
      module: MODULE.koto,
      note: noteName,
      velocity,
      gate: line === 248 ? 6 : 0,
      effect: "pitchDown",
      parameter: { amount },
    });
  }
}

const leadPhrases = Object.freeze([
  null,
  null,
  [[1, "A#4", 4], [6, "C#5", 4], [11, "C5", 4]],
  [[1, "G#4", 4], [6, "G4", 4], [11, "F4", 4]],
  [[1, "G4", 4], [6, "D#4", 4], [11, "D4", 4]],
  [[1, "D4", 4], [6, "F4", 4], [11, "A4", 4]],
  [[1, "A#4", 4], [6, "A4", 4], [11, "E4", 4]],
  [[1, "F4", 4], [6, "E4", 4], [11, "D4", 4]],
  [[1, "C#5", 4], [6, "C5", 4], [11, "A#4", 4]],
  [[1, "G#4", 4], [6, "G4", 4], [11, "F4", 4]],
  [[1, "D4", 3], [5, "F4", 3], [9, "G4", 3], [13, "A#4", 2]],
  [[1, "A#4", 3], [5, "A4", 3], [9, "E4", 3], [13, "D4", 2]],
  [[1, "A4", 3], [5, "G4", 3], [9, "F4", 3], [13, "D4", 2]],
  [[1, "C#5", 3], [5, "A#4", 3], [9, "G4", 3], [13, "E4", 2]],
  [[1, "F4", 4], [6, "E4", 4], [11, "D4", 4]],
  [[1, "D4", 14]],
]);

function addLead(events, usedCells) {
  for (let bar = 0; bar < leadPhrases.length; bar += 1) {
    const phrase = leadPhrases[bar];
    if (!phrase) continue;
    phrase.forEach(([offset, noteName, gate], index) => {
      note(events, usedCells, {
        line: bar * BAR_LINES + offset,
        track: TRACK.lead,
        module: MODULE.lead,
        note: noteName,
        velocity: bar >= 10 && bar < 14 ? 76 - index * 2 : bar === 15 ? 58 : 66 - index * 2,
        gate,
        ...(index === 1 && bar % 2 === 0 ? { effect: "vibrato", parameter: { speed: 3, amplitude: 8 } } : {}),
      });
    });
  }
}

function addMist(events, usedCells) {
  for (let bar = 0; bar < arrangement.length; bar += 2) {
    note(events, usedCells, {
      line: bar * BAR_LINES + 1,
      track: TRACK.mist,
      module: MODULE.mist,
      note: bar >= 4 ? "A5" : "D5",
      velocity: bar >= 4 ? 18 : 14,
      gate: 10,
    });
  }
}

function addAutomation(events, usedCells) {
  const lineUse = new Map();
  const cloud = [2400, 2700, 3200, 3600, 3900, 3500, 3800, 4200, 3500, 3900, 4400, 4700, 5000, 5200, 3600, 2500];
  const moss = [1500, 1700, 2000, 2400, 2700, 2300, 2600, 2900, 2500, 2800, 3200, 3500, 3800, 4000, 2300, 1600];
  const rainWet = [68, 64, 58, 54, 52, 54, 58, 60, 58, 60, 64, 66, 68, 72, 62, 76];
  for (let bar = 0; bar < arrangement.length; bar += 1) {
    const line = bar * BAR_LINES;
    controller(events, usedCells, lineUse, { line, module: MODULE.padFilter, controller: "freq", parameter: cloud[bar] });
    controller(events, usedCells, lineUse, { line, module: MODULE.bassFilter, controller: "freq", parameter: moss[bar] });
    controller(events, usedCells, lineUse, { line, module: MODULE.rainRoom, controller: "wet", parameter: rainWet[bar] });
    if (bar === 7 || bar === 11 || bar === 13) {
      controller(events, usedCells, lineUse, {
        line: line + 8,
        module: MODULE.padFilter,
        controller: "lfoAmp",
        parameter: bar === 13 ? 820 : 620,
      });
    }
  }
}

function buildEvents() {
  const events = [];
  const usedCells = new Set();
  addRain(events, usedCells);
  addBass(events, usedCells);
  addPads(events, usedCells);
  addKoto(events, usedCells);
  addLead(events, usedCells);
  addMist(events, usedCells);
  addAutomation(events, usedCells);
  return events.sort((a, b) => a.line - b.line || a.track - b.track);
}

export function buildTsuyuRainGardenDocument() {
  return {
    format: TEXT_FORMAT,
    magic: "SVOX",
    headerTailHex: "00000000",
    project: {
      version: 33620995,
      baseVersion: 33620995,
      flags: {},
      syncFlags: {
        midiStartStopContinue: true,
        otherStartStopContinue: true,
      },
      bpm: BPM,
      speed: SPEED,
      timeline: { grid: 4, grid2: 4 },
      globalVolume: 256,
      name: "Tsuyu Rain Garden",
      view: {
        moduleScale: 256,
        moduleZoom: 256,
        xOffset: 0,
        yOffset: 0,
      },
      layerMask: 0,
      currentLayer: 0,
      selectedModule: MODULE.pad,
      lastSelectedGenerator: MODULE.koto,
      currentPattern: 0,
      currentPatternTrack: TRACK.kotoA,
      currentPatternLine: 0,
    },
    patterns: [
      {
        name: "Rain garden / dusk - downpour - hollow clearing",
        position: { x: 0, y: 0 },
        tracks: TRACKS,
        lines: LINES,
        ySize: 32,
        flags: {},
        iconBase64: deterministicIconBase64(606, 2026),
        foreground: "#dbead7",
        background: "#1f2a32",
        infoFlags: {},
        events: buildEvents(),
      },
    ],
    modules: modules(),
    trailingChunks: [],
  };
}

/** @satisfies {import("../../../tools/sunvox-music-recipe.d.ts").SunVoxMusicRecipe} */
export const recipe = {
  schemaVersion: 1,
  tags: ["research:generated-music", "theme:tsuyu", "theme:rain"],
  issue: 62,
  outputs: {
    tsuyuRainGarden: {
      file: PROJECT_PATH,
      title: "Tsuyu Rain Garden",
      summaryFile: SUMMARY_PATH,
      verification: {
        durationSeconds: 38,
        requireAudio: true,
        maxClippedSamples: 0,
        maxLeadingSilenceSeconds: 1,
      },
      buildDocument: buildTsuyuRainGardenDocument,
    },
  },
};

export default recipe;

export async function writeTsuyuRainGarden() {
  const buffer = buildContainer(buildTsuyuRainGardenDocument());
  await mkdir(dirname(PROJECT_PATH), { recursive: true });
  await writeFile(PROJECT_PATH, buffer);
  return buffer;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  await writeTsuyuRainGarden();
  console.log(PROJECT_PATH);
}

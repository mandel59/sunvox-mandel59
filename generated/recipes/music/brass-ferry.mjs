#!/usr/bin/env node
// @ts-check
// "Brass Ferry" (#105): a ~90-second fast ska instrumental in G major at
// 176 BPM, synthesized from native SunVox modules only. Kicker / noise drums
// with a rim-click break, the Midnight Loop Line FM bass walking in quarters,
// offbeat skanks on a band-passed saw "guitar" and an additive FMX drawbar
// organ through a rotary-style flanger, and a two-part horn section (bright
// and dark synth brass) on the theme, all in one plate-like room. The score
// lives in generated/recipes/music-lib/brass-ferry/. Run with:
//   npm run sunvox:music-recipe -- generated/recipes/music/brass-ferry.mjs

import { SongBuilder, Timeline } from "../../../tools/sunvox-song-builder.mjs";
import { defaultControllers } from "../../../tools/sunsynth-lab.mjs";
import { fmBass, synthBrass } from "../music-lib/midnight-loop-line/instruments.mjs";
import { BPM, SECTIONS, TOTAL_BARS, arrange } from "../music-lib/brass-ferry/score.mjs";

const PROJECT_PATH = "generated/music/brass-ferry.sunvox";
const SUMMARY_PATH = "var/music-recipe/brass-ferry.summary.json";

const LANES = [
  { key: "drums", name: "Drums", y: 0, tracks: 6, color: { foreground: "#fff3d0", background: "#3d2a10" } },
  { key: "bass", name: "Bass", y: 32, tracks: 1, color: { foreground: "#dcffe9", background: "#123326" } },
  { key: "guitar", name: "Skank Guitar", y: 64, tracks: 4, color: { foreground: "#f0f0f0", background: "#202020" } },
  { key: "organ", name: "Organ", y: 96, tracks: 5, color: { foreground: "#ffe4d0", background: "#3d1a10" } },
  { key: "horns", name: "Horns", y: 128, tracks: 2, color: { foreground: "#fff8d0", background: "#3d3410" } },
];

/** Reused patch with a new name and controller overrides. */
const patch = (base, name, overrides) => ({ ...base, name, controllers: { ...base.controllers, ...overrides } });

/** FMX operator with the default controllers. @param {Record<string, string | number>} overrides */
const fmxOp = (overrides) => ({ ...Object.values(defaultControllers("FMX").operators)[0], ...overrides });

/** Additive drawbar organ: five sine operators straight to the output (16', 8', 4', 2 2/3', 2'). */
function drawbarOrgan() {
  const bar = (freqMul, volume) => fmxOp({
    volume, attack: 2, decay: 100, sustainLevel: 32768, release: 45, sustain: "on", waveform: "sin",
    freqMul, velocitySensitivity: 150, outputMode: 1,
  });
  return {
    type: "FMX", name: "Ferry Organ",
    controllers: {
      volume: 3300, panning: 150, sampleRate: "native", polyphony: 10, channels: "mono",
      adsrSmoothTransitions: "restartVolumeChange", envelopeGain: 1000,
      operators: [bar(500, 5000), bar(1000, 26000), bar(2000, 15000), bar(3000, 7000), bar(4000, 9000)],
    },
  };
}

export function buildBrassFerryDocument() {
  const song = new SongBuilder({ name: "Brass Ferry", bpm: BPM, speed: 6, globalVolume: 256 });

  // --- Master ----------------------------------------------------------------
  song.addModule("limiter", {
    type: "Compressor", name: "Ferry Limiter",
    controllers: { volume: 256, threshold: 228, slope: 100, attack: 0, release: 60, mode: "peakZeroLatency", sideChainInput: 0 },
    to: "output",
  });
  song.addModule("glue", {
    type: "Compressor", name: "Bus Glue",
    controllers: { volume: 256, threshold: 110, slope: 24, attack: 10, release: 140, mode: "rms", sideChainInput: 0 },
    to: "limiter",
  });
  song.addModule("masterBus", { type: "Amplifier", name: "Master Bus", controllers: { volume: 96, stereoWidth: 136 }, to: "glue" });
  song.addModule("plate", {
    type: "Reverb", name: "Plate",
    controllers: { dry: 0, wet: 256, feedback: 176, damp: 120, stereoWidth: 256, mode: "hq", allpassFilter: "improved", roomSize: 20, randomSeed: 105 },
    to: "masterBus",
  });
  song.addModule("plateSend", { type: "Amplifier", name: "Plate Send", controllers: { volume: 52 }, to: "plate" });

  // --- Drums -----------------------------------------------------------------
  song.addModule("drumBus", { type: "Amplifier", name: "Drum Bus", controllers: { volume: 256 }, to: "masterBus" });
  song.addModule("kick", {
    type: "Kicker", name: "Kick",
    controllers: { volume: 220, waveform: "sin", attack: 0, release: 36, boost: 140, acceleration: 180, polyphony: 1, noClick: "on" },
    to: "drumBus",
  });
  song.addModule("snareLevel", { type: "Amplifier", name: "Snare Level", controllers: { volume: 260 }, to: ["drumBus", "plateSend"] });
  song.addModule("snareVcf", {
    type: "Filter", name: "Snare HPF", controllers: { freq: 1500, resonance: 140, type: "hp", rolloff: "db12", mode: "hq" },
    to: "snareLevel",
  });
  song.addModule("snareNoise", {
    type: "Analog generator", name: "Snare Noise",
    controllers: { volume: 256, waveform: "whiteNoise", attack: 0, release: 164, sustain: "off", expEnvelope: "on", polyphony: 6, mode: "hq", osc2Volume: 0 },
    to: "snareVcf",
  });
  song.addModule("snareBody", {
    type: "Kicker", name: "Snare Body",
    controllers: { volume: 170, waveform: "triangle", attack: 0, release: 16, boost: 130, acceleration: 100, polyphony: 3 },
    to: "snareLevel",
  });
  song.addModule("hatVcf", {
    type: "Filter", name: "Hat HPF", controllers: { freq: 8800, resonance: 150, type: "hp", rolloff: "db24", mode: "hq" },
    to: "drumBus",
  });
  song.addModule("hat", {
    type: "Analog generator", name: "Hat",
    controllers: { volume: 180, waveform: "whiteNoise", attack: 0, release: 140, sustain: "off", expEnvelope: "on", polyphony: 3, panning: 156, osc2Volume: 0 },
    to: "hatVcf",
  });
  song.addModule("openHat", {
    type: "Analog generator", name: "Open Hat",
    controllers: { volume: 150, waveform: "whiteNoise", attack: 0, release: 188, sustain: "off", expEnvelope: "on", polyphony: 2, panning: 156, osc2Volume: 0 },
    to: "hatVcf",
  });
  song.addModule("crashVcf", {
    type: "Filter", name: "Crash HPF", controllers: { freq: 4400, resonance: 60, type: "hp", rolloff: "db12", mode: "hq" },
    to: ["drumBus", "plateSend"],
  });
  song.addModule("crash", {
    type: "Analog generator", name: "Crash",
    controllers: { volume: 100, waveform: "whiteNoise", attack: 0, release: 224, sustain: "off", expEnvelope: "on", polyphony: 2, osc2Volume: 0 },
    to: "crashVcf",
  });

  // --- Bass ------------------------------------------------------------------
  song.addModule("bassComp", {
    type: "Compressor", name: "Bass Comp",
    controllers: { volume: 256, threshold: 150, slope: 50, attack: 2, release: 90, mode: "peak", sideChainInput: 0 },
    to: "masterBus",
  });
  song.addModule("bass", { ...patch(fmBass(), "Ferry Bass", { volume: 21500 }), to: "bassComp" });

  // --- Skank guitar and organ -------------------------------------------------
  song.addModule("guitarBody", {
    type: "Filter", name: "Guitar Body", controllers: { freq: 1800, resonance: 160, type: "bp", rolloff: "db12", mode: "hq" },
    to: ["masterBus", "plateSend"],
  });
  song.addModule("guitar", {
    type: "Analog generator", name: "Skank Guitar",
    controllers: {
      volume: 120, waveform: "saw", panning: 96, attack: 0, release: 150, sustain: "off", expEnvelope: "on",
      osc2Pitch: 1000 + 5, osc2Volume: 24000, osc2Mode: "add", polyphony: 8, mode: "hq",
    },
    to: "guitarBody",
  });
  song.addModule("rotary", {
    type: "Flanger", name: "Rotary",
    controllers: { dry: 256, wet: 140, feedback: 10, delay: 220, response: 2, lfoFreq: 120, lfoAmp: 110, lfoWaveform: "sin", lfoFreqUnit: "hz005" },
    to: ["masterBus", "plateSend"],
  });
  song.addModule("organ", { ...drawbarOrgan(), to: "rotary" });

  // --- Horns -----------------------------------------------------------------
  song.addModule("hornEcho", {
    type: "Delay", name: "Slap Echo",
    controllers: { dry: 256, wet: 40, delayL: 2, delayR: 3, volumeL: 200, volumeR: 200, channels: "stereo", delayUnit: "line", delayMultiplier: 1, feedback: 3000 },
    to: ["masterBus", "plateSend"],
  });
  song.addModule("trumpet", {
    ...patch(synthBrass(), "Ferry Trumpet", { volume: 92, panning: 150, attack: 3, release: 36, filterFreq: 8600, filterResonance: 200, polyphony: 2 }),
    to: "hornEcho",
  });
  song.addModule("trombone", {
    ...patch(synthBrass(), "Ferry Trombone", { volume: 138, panning: 100, attack: 5, release: 40, filterFreq: 4400, filterResonance: 120, osc2Pitch: 994, polyphony: 2 }),
    to: "hornEcho",
  });

  // --- Layout ----------------------------------------------------------------
  const LAYOUT = {
    kick: [0, 0], snareNoise: [0, 80], snareBody: [0, 150], snareVcf: [150, 80], snareLevel: [300, 110],
    hat: [0, 220], openHat: [0, 290], hatVcf: [150, 250], crash: [0, 360], crashVcf: [150, 360], drumBus: [450, 180],
    bass: [0, 450], bassComp: [150, 450],
    guitar: [0, 530], guitarBody: [150, 530], organ: [0, 610], rotary: [150, 610],
    trumpet: [0, 690], trombone: [0, 760], hornEcho: [150, 720],
    plateSend: [500, 640], plate: [650, 640], masterBus: [650, 400], glue: [800, 400], limiter: [950, 400], output: [1100, 400],
  };
  for (const [key, [x, y]] of Object.entries(LAYOUT)) song.place(key, x, y);

  // --- Score -----------------------------------------------------------------
  const timeline = new Timeline(song, { sections: SECTIONS, lanes: LANES });
  const M = new Proxy({}, { get: (_, key) => (song.moduleIndex(String(key)), String(key)) });
  arrange(timeline, M);

  return song.build({
    flags: { supertracks: true },
    selectedModule: song.moduleIndex("trumpet"),
    pruneEmptyPatterns: true,
    comments: [
      `Brass Ferry: fast ska in G major, ${BPM} BPM, ${TOTAL_BARS} bars.`,
      "Built by generated/recipes/music/brass-ferry.mjs from native SunVox modules only.",
    ],
  });
}

/** @satisfies {import("../../../tools/sunvox-music-recipe.d.ts").SunVoxMusicRecipe} */
export const recipe = {
  schemaVersion: 1,
  issue: 105,
  tags: ["research:generated-music", "style:ska"],
  outputs: {
    brassFerry: {
      file: PROJECT_PATH,
      title: "Brass Ferry",
      summaryFile: SUMMARY_PATH,
      params: { bpm: BPM, bars: TOTAL_BARS, key: "G major", form: SECTIONS.map((s) => `${s.name} ${s.bars}`).join(" / ") },
      verification: { durationSeconds: 92, requireAudio: true, maxClippedSamples: 0, maxLeadingSilenceSeconds: 0.1 },
      buildDocument: buildBrassFerryDocument,
    },
  },
};

export default recipe;

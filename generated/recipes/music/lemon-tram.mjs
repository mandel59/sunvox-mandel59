#!/usr/bin/env node
// @ts-check
// "Lemon Tram" (#101): a ~90-second upbeat J-fusion instrumental in Bb major
// at 150 BPM on the Confirmation progression (コンファメ進行), synthesized from
// native SunVox modules only. Kicker / noise drums, the Midnight Loop Line FM
// slap bass and tine Rhodes with rootless voicings, analog brass hits and
// strings, a saw lead and a whistle lead through a dotted echo, all sharing
// one hall reverb. The score lives in generated/recipes/music-lib/lemon-tram/.
// Run with:
//   npm run sunvox:music-recipe -- generated/recipes/music/lemon-tram.mjs

import { SongBuilder, Timeline } from "../../../tools/sunvox-song-builder.mjs";
import { fmBass, leadSynth, softLead, stringPad, synthBrass, tinePiano } from "../music-lib/midnight-loop-line/instruments.mjs";
import { BPM, SECTIONS, TOTAL_BARS, arrange } from "../music-lib/lemon-tram/score.mjs";

const PROJECT_PATH = "generated/music/lemon-tram.sunvox";
const SUMMARY_PATH = "var/music-recipe/lemon-tram.summary.json";

const LANES = [
  { key: "drums", name: "Drums", y: 0, tracks: 5, color: { foreground: "#fff6cc", background: "#3a3010" } },
  { key: "bass", name: "Bass", y: 32, tracks: 1, color: { foreground: "#dcffe9", background: "#123326" } },
  { key: "keys", name: "Rhodes", y: 64, tracks: 4, color: { foreground: "#e2f2ff", background: "#152a40" } },
  { key: "brass", name: "Brass", y: 96, tracks: 4, color: { foreground: "#ffeacc", background: "#3d2410" } },
  { key: "pad", name: "Strings", y: 128, tracks: 4, color: { foreground: "#ffe4ee", background: "#3a1424" } },
  { key: "lead", name: "Lead", y: 160, tracks: 2, color: { foreground: "#f6ffd0", background: "#2c3a10" } },
  { key: "mod", name: "Cymbals", y: 192, tracks: 1, color: { foreground: "#fffbd0", background: "#2e2d12" } },
];

/** Reused patch with a new name and controller overrides. */
const patch = (base, name, overrides) => ({ ...base, name, controllers: { ...base.controllers, ...overrides } });

export function buildLemonTramDocument() {
  const song = new SongBuilder({ name: "Lemon Tram", bpm: BPM, speed: 6, globalVolume: 256 });

  // --- Master ----------------------------------------------------------------
  song.addModule("limiter", {
    type: "Compressor", name: "Tram Limiter",
    controllers: { volume: 256, threshold: 228, slope: 100, attack: 0, release: 60, mode: "peakZeroLatency", sideChainInput: 0 },
    to: "output",
  });
  song.addModule("glue", {
    type: "Compressor", name: "Bus Glue",
    controllers: { volume: 256, threshold: 110, slope: 24, attack: 10, release: 150, mode: "rms", sideChainInput: 0 },
    to: "limiter",
  });
  song.addModule("masterBus", { type: "Amplifier", name: "Master Bus", controllers: { volume: 84, stereoWidth: 140 }, to: "glue" });
  song.addModule("hall", {
    type: "Reverb", name: "Hall",
    controllers: { dry: 0, wet: 256, feedback: 200, damp: 150, stereoWidth: 256, mode: "hq", allpassFilter: "improved", roomSize: 30, randomSeed: 101 },
    to: "masterBus",
  });
  song.addModule("hallSend", { type: "Amplifier", name: "Hall Send", controllers: { volume: 56 }, to: "hall" });

  // --- Drums -----------------------------------------------------------------
  song.addModule("drumBus", { type: "Amplifier", name: "Drum Bus", controllers: { volume: 256 }, to: "masterBus" });
  song.addModule("kick", {
    type: "Kicker", name: "Kick",
    controllers: { volume: 230, waveform: "sin", attack: 0, release: 40, boost: 150, acceleration: 190, polyphony: 1, noClick: "on" },
    to: "drumBus",
  });
  song.addModule("snareLevel", { type: "Amplifier", name: "Snare Level", controllers: { volume: 280 }, to: ["drumBus", "hallSend"] });
  song.addModule("snareVcf", {
    type: "Filter", name: "Snare HPF", controllers: { freq: 1300, resonance: 120, type: "hp", rolloff: "db12", mode: "hq" },
    to: "snareLevel",
  });
  song.addModule("snareNoise", {
    type: "Analog generator", name: "Snare Noise",
    controllers: { volume: 256, waveform: "whiteNoise", attack: 0, release: 170, sustain: "off", expEnvelope: "on", polyphony: 6, mode: "hq", osc2Volume: 0 },
    to: "snareVcf",
  });
  song.addModule("snareBody", {
    type: "Kicker", name: "Snare Body",
    controllers: { volume: 160, waveform: "triangle", attack: 0, release: 18, boost: 120, acceleration: 100, polyphony: 2 },
    to: "snareLevel",
  });
  song.addModule("hatVcf", {
    type: "Filter", name: "Hat HPF", controllers: { freq: 8500, resonance: 160, type: "hp", rolloff: "db24", mode: "hq" },
    to: "drumBus",
  });
  song.addModule("hat", {
    type: "Analog generator", name: "Hat",
    controllers: { volume: 170, waveform: "whiteNoise", attack: 0, release: 150, sustain: "off", expEnvelope: "on", polyphony: 3, panning: 152, osc2Volume: 0 },
    to: "hatVcf",
  });
  song.addModule("openHat", {
    type: "Analog generator", name: "Open Hat",
    controllers: { volume: 170, waveform: "whiteNoise", attack: 0, release: 194, sustain: "off", expEnvelope: "on", polyphony: 2, panning: 152, osc2Volume: 0 },
    to: "hatVcf",
  });
  song.addModule("rideVcf", {
    type: "Filter", name: "Ride BPF", controllers: { freq: 6200, resonance: 520, type: "bp", rolloff: "db12", mode: "hq" },
    to: ["drumBus", "hallSend"],
  });
  song.addModule("ride", {
    type: "Analog generator", name: "Ride",
    controllers: { volume: 210, waveform: "whiteNoise", attack: 0, release: 205, sustain: "off", expEnvelope: "on", polyphony: 3, panning: 96, osc2Volume: 0 },
    to: "rideVcf",
  });
  song.addModule("crashVcf", {
    type: "Filter", name: "Crash HPF", controllers: { freq: 4500, resonance: 60, type: "hp", rolloff: "db12", mode: "hq" },
    to: ["drumBus", "hallSend"],
  });
  song.addModule("crash", {
    type: "Analog generator", name: "Crash",
    controllers: { volume: 100, waveform: "whiteNoise", attack: 0, release: 226, sustain: "off", expEnvelope: "on", polyphony: 2, osc2Volume: 0 },
    to: "crashVcf",
  });

  // --- Bass ------------------------------------------------------------------
  song.addModule("bassComp", {
    type: "Compressor", name: "Bass Comp",
    controllers: { volume: 256, threshold: 150, slope: 50, attack: 2, release: 90, mode: "peak", sideChainInput: 0 },
    to: "masterBus",
  });
  song.addModule("bass", { ...patch(fmBass(), "Tram Slap Bass", { volume: 20000 }), to: "bassComp" });

  // --- Keys, brass, strings ---------------------------------------------------
  song.addModule("keysChorus", {
    type: "Flanger", name: "Rhodes Chorus",
    controllers: { dry: 256, wet: 130, feedback: 20, delay: 300, response: 2, lfoFreq: 80, lfoAmp: 90, lfoWaveform: "sin", lfoFreqUnit: "hz005" },
    to: ["masterBus", "hallSend"],
  });
  const tines = tinePiano();
  song.addModule("keys", { ...patch(tines, "Tram Rhodes", { volume: 6600, polyphony: 12 }), to: "keysChorus" });
  song.addModule("brassTone", {
    type: "Filter", name: "Brass Tone", controllers: { freq: 6500, resonance: 0, type: "lp", rolloff: "db12", mode: "hq" },
    to: ["masterBus", "hallSend"],
  });
  song.addModule("brass", { ...patch(synthBrass(), "Tram Brass", { volume: 42, panning: 150 }), to: "brassTone" });
  song.addModule("strings", { ...patch(stringPad(), "Tram Strings", { volume: 40, panning: 104 }), to: ["masterBus", "hallSend"] });

  // --- Leads -----------------------------------------------------------------
  song.addModule("leadEcho", {
    type: "Delay", name: "Dotted Echo",
    controllers: { dry: 256, wet: 64, delayL: 3, delayR: 6, volumeL: 220, volumeR: 200, channels: "stereo", delayUnit: "line", delayMultiplier: 1, feedback: 8000 },
    to: ["masterBus", "hallSend"],
  });
  song.addModule("lead", { ...patch(leadSynth(), "Tram Lead", { volume: 96 }), to: "leadEcho" });
  song.addModule("whistle", { ...patch(softLead(), "Tram Whistle", { volume: 96 }), to: "leadEcho" });

  // --- Layout ----------------------------------------------------------------
  const LAYOUT = {
    kick: [0, 0], snareNoise: [0, 80], snareBody: [0, 150], snareVcf: [150, 80], snareLevel: [300, 110],
    hat: [0, 220], openHat: [0, 290], hatVcf: [150, 250], ride: [0, 360], rideVcf: [150, 360], crash: [0, 430], crashVcf: [150, 430],
    drumBus: [450, 200],
    bass: [0, 520], bassComp: [150, 520],
    keys: [0, 600], keysChorus: [150, 600], brass: [0, 680], brassTone: [150, 680], strings: [0, 760],
    lead: [0, 840], whistle: [0, 910], leadEcho: [150, 870],
    hallSend: [600, 760], hall: [750, 760], masterBus: [750, 450], glue: [900, 450], limiter: [1050, 450], output: [1200, 450],
  };
  for (const [key, [x, y]] of Object.entries(LAYOUT)) song.place(key, x, y);

  // --- Score -----------------------------------------------------------------
  const timeline = new Timeline(song, { sections: SECTIONS, lanes: LANES });
  const M = new Proxy({}, { get: (_, key) => (song.moduleIndex(String(key)), String(key)) });
  arrange(timeline, M);

  return song.build({
    flags: { supertracks: true },
    selectedModule: song.moduleIndex("lead"),
    pruneEmptyPatterns: true,
    comments: [
      `Lemon Tram: J-fusion on the Confirmation progression in Bb major, ${BPM} BPM, ${TOTAL_BARS} bars.`,
      "Built by generated/recipes/music/lemon-tram.mjs from native SunVox modules only.",
    ],
  });
}

/** @satisfies {import("../../../tools/sunvox-music-recipe.d.ts").SunVoxMusicRecipe} */
export const recipe = {
  schemaVersion: 1,
  issue: 101,
  tags: ["research:generated-music", "style:j-fusion", "harmony:confirmation-progression"],
  outputs: {
    lemonTram: {
      file: PROJECT_PATH,
      title: "Lemon Tram",
      summaryFile: SUMMARY_PATH,
      params: { bpm: BPM, bars: TOTAL_BARS, key: "Bb major", progression: "Confirmation (コンファメ進行)", form: SECTIONS.map((s) => `${s.name} ${s.bars}`).join(" / ") },
      verification: { durationSeconds: 95, requireAudio: true, maxClippedSamples: 0, maxLeadingSilenceSeconds: 0.1 },
      buildDocument: buildLemonTramDocument,
    },
  },
};

export default recipe;

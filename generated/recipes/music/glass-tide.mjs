#!/usr/bin/env node
// @ts-check
// "Glass Tide" (#95): a ~100-second liquid drum & bass track in F minor at
// 174 BPM, synthesized from native SunVox modules only. Two-step Kicker /
// noise drums through an automated bus low-pass, a sine sub with a detuned
// "reese" layer ducked by the kick, FM tine keys, bowed FMX saw pads and a
// soft lead with a dotted echo, all sharing one hall reverb. The score lives
// in generated/recipes/music-lib/glass-tide/. Run with:
//   npm run sunvox:music-recipe -- generated/recipes/music/glass-tide.mjs

import { SongBuilder, Timeline } from "../../../tools/sunvox-song-builder.mjs";
import { defaultControllers } from "../../../tools/sunsynth-lab.mjs";
import { tinePiano } from "../music-lib/midnight-loop-line/instruments.mjs";
import { BPM, SECTIONS, TOTAL_BARS, arrange } from "../music-lib/glass-tide/score.mjs";

const PROJECT_PATH = "generated/music/glass-tide.sunvox";
const SUMMARY_PATH = "var/music-recipe/glass-tide.summary.json";

const LANES = [
  { key: "drums", name: "Drums", y: 0, tracks: 6, color: { foreground: "#fff0d6", background: "#3a2a12" } },
  { key: "bass", name: "Bass", y: 32, tracks: 2, color: { foreground: "#d8ffe4", background: "#12331f" } },
  { key: "keys", name: "Keys", y: 64, tracks: 4, color: { foreground: "#dcf3ff", background: "#11293a" } },
  { key: "pad", name: "Pad", y: 96, tracks: 5, color: { foreground: "#f0e4ff", background: "#25183a" } },
  { key: "lead", name: "Lead", y: 128, tracks: 1, color: { foreground: "#ffe4ee", background: "#3a1424" } },
  { key: "mod", name: "FX & Automation", y: 160, tracks: 6, color: { foreground: "#fffbd0", background: "#2e2d12" } },
];

// Sound2Ctl output controller numbers are 1-based.
const CTL = { filterFreq: 2 };
const norm = (value, max) => Math.round((value / max) * 32768);

/** FMX operator with the default controllers. @param {Record<string, string | number>} overrides */
const fmxOp = (overrides) => ({ ...Object.values(defaultControllers("FMX").operators)[0], ...overrides });

/** Bowed saw section: one FMX saw operator straight to the output (envelopes in ms). */
function bowedSaw(name, finetune, panning) {
  return {
    type: "FMX", name, finetune,
    controllers: {
      volume: 2500, panning, sampleRate: "native", polyphony: 10, channels: "mono",
      adsrSmoothTransitions: "restartVolumeChange", envelopeGain: 1000,
      operators: [
        fmxOp({ volume: 32768, attack: 520, decay: 100, sustainLevel: 32768, release: 900, sustain: "on", waveform: "saw", velocitySensitivity: 176, outputMode: 1 }),
        fmxOp({ volume: 0, outputMode: 0 }),
        fmxOp({ volume: 0, outputMode: 0 }),
        fmxOp({ volume: 0, outputMode: 0 }),
        fmxOp({ volume: 0, outputMode: 0 }),
      ],
    },
  };
}

export function buildGlassTideDocument() {
  const song = new SongBuilder({ name: "Glass Tide", bpm: BPM, speed: 6, globalVolume: 256 });

  // --- Master ----------------------------------------------------------------
  song.addModule("limiter", {
    type: "Compressor", name: "Tide Limiter",
    controllers: { volume: 256, threshold: 228, slope: 100, attack: 0, release: 60, mode: "peakZeroLatency", sideChainInput: 0 },
    to: "output",
  });
  song.addModule("glue", {
    type: "Compressor", name: "Bus Glue",
    controllers: { volume: 256, threshold: 96, slope: 28, attack: 10, release: 180, mode: "rms", sideChainInput: 0 },
    to: "limiter",
  });
  song.addModule("masterBus", { type: "Amplifier", name: "Master Bus", controllers: { volume: 130, stereoWidth: 140 }, to: "glue" });
  song.addModule("hall", {
    type: "Reverb", name: "Hall",
    controllers: { dry: 0, wet: 256, feedback: 226, damp: 150, stereoWidth: 256, mode: "hq", allpassFilter: "improved", roomSize: 44, randomSeed: 95 },
    to: "masterBus",
  });
  song.addModule("hallSend", { type: "Amplifier", name: "Hall Send", controllers: { volume: 70 }, to: "hall" });

  // --- Drums -----------------------------------------------------------------
  song.addModule("drumFilter", {
    type: "Filter", name: "Drum Bus LPF", controllers: { freq: 14000, resonance: 120, type: "lp", rolloff: "db12", mode: "hq", response: 4 },
    to: "masterBus",
  });
  song.addModule("drumBus", { type: "Amplifier", name: "Drum Bus", controllers: { volume: 256 }, to: "drumFilter" });
  // The duck is created before its music sources so the kick is input 1.
  song.addModule("duck", {
    type: "Compressor", name: "Kick Duck",
    controllers: { volume: 256, threshold: 90, slope: 50, attack: 1, release: 110, mode: "peakZeroLatency", sideChainInput: 1 },
    to: "masterBus",
  });
  song.addModule("kick", {
    type: "Kicker", name: "Kick",
    controllers: { volume: 240, waveform: "sin", attack: 0, release: 56, boost: 240, acceleration: 230, polyphony: 1, noClick: "on" },
    to: ["duck", "drumBus"],
  });
  song.addModule("snareLevel", { type: "Amplifier", name: "Snare Level", controllers: { volume: 340 }, to: ["drumBus", "hallSend"] });
  song.addModule("snareVcf", {
    type: "Filter", name: "Snare HPF", controllers: { freq: 900, resonance: 140, type: "hp", rolloff: "db12", mode: "hq" },
    to: "snareLevel",
  });
  song.addModule("snareNoise", {
    type: "Analog generator", name: "Snare Noise",
    controllers: { volume: 256, waveform: "whiteNoise", attack: 0, release: 185, sustain: "off", expEnvelope: "on", polyphony: 6, mode: "hq", osc2Volume: 0 },
    to: "snareVcf",
  });
  song.addModule("snareBody", {
    type: "Kicker", name: "Snare Body",
    controllers: { volume: 170, waveform: "triangle", attack: 0, release: 20, boost: 140, acceleration: 110, polyphony: 2 },
    to: "snareLevel",
  });
  song.addModule("hatVcf", {
    type: "Filter", name: "Hat HPF", controllers: { freq: 7500, resonance: 180, type: "hp", rolloff: "db24", mode: "hq" },
    to: "drumBus",
  });
  song.addModule("hat", {
    type: "Analog generator", name: "Hat",
    controllers: { volume: 210, waveform: "whiteNoise", attack: 0, release: 165, sustain: "off", expEnvelope: "on", polyphony: 4, panning: 150, osc2Volume: 0 },
    to: "hatVcf",
  });
  song.addModule("shakerVcf", {
    type: "Filter", name: "Shaker BPF", controllers: { freq: 5200, resonance: 500, type: "bp", rolloff: "db12", mode: "hq" },
    to: ["drumBus", "hallSend"],
  });
  song.addModule("shaker", {
    type: "Analog generator", name: "Shaker",
    controllers: { volume: 150, waveform: "whiteNoise", attack: 0, release: 150, sustain: "off", expEnvelope: "on", polyphony: 4, panning: 100, osc2Volume: 0 },
    to: "shakerVcf",
  });

  // --- Bass: sine sub + reese layer, both ducked by the kick ------------------
  song.addModule("bassBus", { type: "Amplifier", name: "Bass Bus", controllers: { volume: 256 }, to: "duck" });
  song.addModule("subTone", {
    type: "Filter", name: "Sub LPF", controllers: { freq: 900, resonance: 0, type: "lp", rolloff: "db12", mode: "hq" },
    to: "bassBus",
  });
  song.addModule("subWarmth", { type: "Distortion", name: "Sub Warmth", controllers: { volume: 150, type: "saturation4", power: 40 }, to: "subTone" });
  song.addModule("sub", {
    type: "Analog generator", name: "Sub Sine",
    controllers: { volume: 100, waveform: "sin", attack: 2, release: 110, sustain: "on", expEnvelope: "on", osc2Volume: 0, polyphony: 1, mode: "hqMono" },
    to: "subWarmth",
  });
  song.addModule("subIn", { type: "MultiSynth", name: "Sub In", to: "sub" });
  song.addModule("reeseVcf", {
    type: "Filter", name: "Reese VCF", controllers: { freq: 600, resonance: 500, type: "lp", rolloff: "db24", mode: "hq", response: 4 },
    to: "bassBus",
  });
  song.addModule("reese", {
    type: "Analog generator", name: "Reese Saws",
    controllers: { volume: 54, waveform: "saw", osc2Pitch: 1000 + 14, osc2Volume: 32768, osc2Mode: "add", attack: 20, release: 120, sustain: "on", expEnvelope: "on", polyphony: 1, mode: "hqMono" },
    to: "reeseVcf",
  });
  song.addModule("reeseIn", { type: "MultiSynth", name: "Reese In", to: "reese" });
  song.addModule("reeseS2C", {
    type: "Sound2Ctl", name: "LFO -> Reese Cutoff",
    controllers: { sampleRate: 400, channels: "mono", absolute: "on", gain: 256, smooth: 0, mode: "hq", outMin: norm(280, 14000), outMax: norm(1100, 14000), outController: CTL.filterFreq },
    to: "reeseVcf",
  });
  song.addModule("reeseLfo", {
    type: "LFO", name: "Reese LFO 2 bars",
    controllers: { volume: 256, type: "amplitude", amplitude: 256, freq: 32, frequencyUnit: "line", waveform: "sin", generator: "on", channels: "mono" },
    to: "reeseS2C",
  });

  // --- Music bus (ducked) ----------------------------------------------------
  song.addModule("musicBus", { type: "Amplifier", name: "Music Bus", controllers: { volume: 256, stereoWidth: 150 }, to: "duck" });

  // Keys: the Midnight Loop Line tine patch, softened and chorused.
  song.addModule("keysChorus", {
    type: "Flanger", name: "Keys Chorus",
    controllers: { dry: 256, wet: 120, feedback: 20, delay: 300, response: 2, lfoFreq: 70, lfoAmp: 90, lfoWaveform: "sin", lfoFreqUnit: "hz005" },
    to: ["musicBus", "hallSend"],
  });
  song.addModule("keysTone", {
    type: "Filter", name: "Keys Tone", controllers: { freq: 5200, resonance: 0, type: "lp", rolloff: "db12", mode: "hq" },
    to: "keysChorus",
  });
  const tines = tinePiano();
  song.addModule("keys", { ...tines, name: "Glass Tines", controllers: { ...tines.controllers, volume: 5800, polyphony: 16 }, to: "keysTone" });

  // Pad: two detuned bowed-saw sections.
  song.addModule("padEnsemble", {
    type: "Flanger", name: "Pad Ensemble",
    controllers: { dry: 256, wet: 160, feedback: 30, delay: 400, response: 2, lfoFreq: 40, lfoAmp: 110, lfoWaveform: "sin", lfoFreqUnit: "hz005" },
    to: ["musicBus", "hallSend"],
  });
  song.addModule("padVcf", {
    type: "Filter", name: "Pad LPF", controllers: { freq: 2600, resonance: 120, type: "lp", rolloff: "db12", mode: "hq" },
    to: "padEnsemble",
  });
  song.addModule("padA", { ...bowedSaw("Pad Saws L", 7, 90), to: "padVcf" });
  song.addModule("padB", { ...bowedSaw("Pad Saws R", -7, 166), to: "padVcf" });
  song.addModule("padIn", { type: "MultiSynth", name: "Pad In", to: ["padA", "padB"] });

  // Lead: triangle + soft octave, vibrato, dotted echo.
  song.addModule("leadEcho", {
    type: "Delay", name: "Dotted Echo",
    controllers: { dry: 256, wet: 80, delayL: 6, delayR: 9, volumeL: 230, volumeR: 200, channels: "stereo", delayUnit: "line", delayMultiplier: 1, feedback: 10000 },
    to: ["musicBus", "hallSend"],
  });
  song.addModule("leadVibrato", {
    type: "Vibrato", name: "Lead Vibrato",
    controllers: { volume: 256, amplitude: 10, freq: 300, frequencyUnit: "hz64", channels: "stereo" },
    to: "leadEcho",
  });
  song.addModule("lead", {
    type: "Analog generator", name: "Lead Voice",
    controllers: { volume: 88, waveform: "triangle", osc2Pitch: 1000 + 768, osc2Volume: 7000, osc2Mode: "add", attack: 14, release: 70, sustain: "on", expEnvelope: "on", noise: 4, polyphony: 1, mode: "hqMono", filter: "lp12db", filterFreq: 5000 },
    to: "leadVibrato",
  });
  song.addModule("leadIn", { type: "MultiSynth", name: "Lead In", to: "lead" });

  // --- FX --------------------------------------------------------------------
  song.addModule("riserVcf", {
    type: "Filter", name: "Riser BPF", controllers: { freq: 300, resonance: 900, type: "bp", rolloff: "db12", mode: "hq", response: 4 },
    to: ["masterBus", "hallSend"],
  });
  song.addModule("riser", {
    type: "Analog generator", name: "Riser Noise",
    controllers: { volume: 70, waveform: "pinkNoise", attack: 60, release: 30, sustain: "on", polyphony: 1, osc2Volume: 0 },
    to: "riserVcf",
  });
  song.addModule("crashVcf", {
    type: "Filter", name: "Crash HPF", controllers: { freq: 4200, resonance: 60, type: "hp", rolloff: "db12", mode: "hq" },
    to: ["masterBus", "hallSend"],
  });
  song.addModule("crash", {
    type: "Analog generator", name: "Crash",
    controllers: { volume: 90, waveform: "whiteNoise", attack: 0, release: 228, sustain: "off", expEnvelope: "on", polyphony: 2, osc2Volume: 0 },
    to: "crashVcf",
  });
  song.addModule("boom", {
    type: "Kicker", name: "Impact Boom",
    controllers: { volume: 200, waveform: "sin", attack: 0, release: 200, boost: 100, acceleration: 60, polyphony: 1, noClick: "on" },
    to: ["masterBus", "hallSend"],
  });

  // --- Layout ----------------------------------------------------------------
  const LAYOUT = {
    kick: [0, 0], snareNoise: [0, 90], snareBody: [0, 160], snareVcf: [150, 90], snareLevel: [300, 120], hat: [0, 240], hatVcf: [150, 240], shaker: [0, 310], shakerVcf: [150, 310], drumBus: [450, 150], drumFilter: [600, 150],
    subIn: [0, 420], sub: [150, 420], subWarmth: [300, 420], subTone: [450, 420], reeseIn: [0, 500], reese: [150, 500], reeseVcf: [300, 500], reeseLfo: [150, 570], reeseS2C: [300, 570], bassBus: [600, 460],
    keys: [0, 680], keysTone: [150, 680], keysChorus: [300, 680],
    padIn: [0, 780], padA: [150, 760], padB: [150, 820], padVcf: [300, 780], padEnsemble: [450, 780],
    leadIn: [0, 900], lead: [150, 900], leadVibrato: [300, 900], leadEcho: [450, 900],
    riser: [0, 1000], riserVcf: [150, 1000], crash: [0, 1070], crashVcf: [150, 1070], boom: [0, 1140],
    musicBus: [700, 760], duck: [850, 460], hallSend: [850, 900], hall: [1000, 900],
    masterBus: [1150, 460], glue: [1300, 460], limiter: [1450, 460], output: [1600, 460],
  };
  for (const [key, [x, y]] of Object.entries(LAYOUT)) song.place(key, x, y);

  // --- Score -----------------------------------------------------------------
  const timeline = new Timeline(song, { sections: SECTIONS, lanes: LANES });
  const M = new Proxy({}, { get: (_, key) => (song.moduleIndex(String(key)), String(key)) });
  arrange(timeline, M);

  return song.build({
    flags: { supertracks: true },
    selectedModule: song.moduleIndex("keys"),
    pruneEmptyPatterns: true,
    comments: [
      `Glass Tide: liquid drum & bass in F minor, ${BPM} BPM, ${TOTAL_BARS} bars.`,
      "Built by generated/recipes/music/glass-tide.mjs from native SunVox modules only.",
    ],
  });
}

/** @satisfies {import("../../../tools/sunvox-music-recipe.d.ts").SunVoxMusicRecipe} */
export const recipe = {
  schemaVersion: 1,
  issue: 95,
  tags: ["research:generated-music", "style:liquid-dnb", "style:drum-and-bass"],
  outputs: {
    glassTide: {
      file: PROJECT_PATH,
      title: "Glass Tide",
      summaryFile: SUMMARY_PATH,
      params: { bpm: BPM, bars: TOTAL_BARS, key: "F minor", form: SECTIONS.map((s) => `${s.name} ${s.bars}`).join(" / ") },
      verification: { durationSeconds: 104, requireAudio: true, maxClippedSamples: 0, maxLeadingSilenceSeconds: 0.1 },
      buildDocument: buildGlassTideDocument,
    },
  },
};

export default recipe;

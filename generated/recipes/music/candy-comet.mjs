#!/usr/bin/env node
// @ts-check
// "Candy Comet" (#99): a ~100-second happy hardcore track in F major at
// 176 BPM with a lift to G major for the last drop, synthesized from native
// SunVox modules only. A driven Kicker four-on-the-floor, offbeat open hats
// and an offbeat saw bass pumped by the kick sidechain, stacked detuned-saw
// "supersaw" chord stabs and hook lead, a bright FM rave piano and bowed
// FMX saw pads, all sharing one hall reverb. The score lives in
// generated/recipes/music-lib/candy-comet/. Run with:
//   npm run sunvox:music-recipe -- generated/recipes/music/candy-comet.mjs

import { SongBuilder, Timeline } from "../../../tools/sunvox-song-builder.mjs";
import { defaultControllers } from "../../../tools/sunsynth-lab.mjs";
import { tinePiano } from "../music-lib/midnight-loop-line/instruments.mjs";
import { BPM, SECTIONS, TOTAL_BARS, arrange } from "../music-lib/candy-comet/score.mjs";

const PROJECT_PATH = "generated/music/candy-comet.sunvox";
const SUMMARY_PATH = "var/music-recipe/candy-comet.summary.json";

const LANES = [
  { key: "drums", name: "Drums", y: 0, tracks: 6, color: { foreground: "#fff3d0", background: "#3d2410" } },
  { key: "bass", name: "Bass", y: 32, tracks: 1, color: { foreground: "#d6ffe0", background: "#10361e" } },
  { key: "saws", name: "Supersaw", y: 64, tracks: 4, color: { foreground: "#ffe0f6", background: "#3d1236" } },
  { key: "lead", name: "Lead", y: 96, tracks: 2, color: { foreground: "#fff0e0", background: "#3d2212" } },
  { key: "piano", name: "Piano", y: 128, tracks: 8, color: { foreground: "#dff2ff", background: "#10283d" } },
  { key: "pad", name: "Pad", y: 160, tracks: 4, color: { foreground: "#eee2ff", background: "#22163d" } },
  { key: "mod", name: "FX & Automation", y: 192, tracks: 6, color: { foreground: "#fffbd0", background: "#2e2d12" } },
];

/** FMX operator with the default controllers. @param {Record<string, string | number>} overrides */
const fmxOp = (overrides) => ({ ...Object.values(defaultControllers("FMX").operators)[0], ...overrides });

/** Bowed saw section: one FMX saw operator straight to the output (envelopes in ms). */
function bowedSaw(name, finetune, panning) {
  return {
    type: "FMX", name, finetune,
    controllers: {
      volume: 2200, panning, sampleRate: "native", polyphony: 8, channels: "mono",
      adsrSmoothTransitions: "restartVolumeChange", envelopeGain: 1000,
      operators: [
        fmxOp({ volume: 32768, attack: 260, decay: 100, sustainLevel: 32768, release: 700, sustain: "on", waveform: "saw", velocitySensitivity: 176, outputMode: 1 }),
        fmxOp({ volume: 0, outputMode: 0 }),
        fmxOp({ volume: 0, outputMode: 0 }),
        fmxOp({ volume: 0, outputMode: 0 }),
        fmxOp({ volume: 0, outputMode: 0 }),
      ],
    },
  };
}

/** Rave piano: the Midnight Loop Line tine patch with a stronger 1x hammer and 2x carrier. */
function ravePiano() {
  const base = tinePiano();
  const ops = base.controllers.operators.map((operator) => ({ ...operator }));
  Object.assign(ops[0], { volume: 6000, decay: 200 });
  Object.assign(ops[1], { volume: 15000, decay: 650, sustainLevel: 3400 });
  Object.assign(ops[2], { decay: 1500 });
  Object.assign(ops[3], { decay: 2800, sustainLevel: 3600 });
  Object.assign(ops[4], { volume: 8000, decay: 1100 });
  return { ...base, name: "Comet Piano", controllers: { ...base.controllers, volume: 7300, polyphony: 16, operators: ops } };
}

/**
 * Supersaw voice: three stereo Analog generators, each two saws with osc2
 * detuned, spread by module finetune (so equal-pitch layers do not cancel)
 * and panning, fed by one MultiSynth.
 */
function addSupersaw(song, prefix, { name, volume, release, polyphony, to }) {
  const layers = [
    { key: "A", finetune: -16, panning: 44, detune: 11 },
    { key: "B", finetune: 3, panning: 128, detune: -7 },
    { key: "C", finetune: 19, panning: 212, detune: 13 },
  ];
  const keys = layers.map((layer) => {
    const key = `${prefix}${layer.key}`;
    song.addModule(key, {
      type: "Analog generator", name: `${name} ${layer.key}`, finetune: layer.finetune,
      controllers: {
        volume, waveform: "saw", panning: layer.panning, attack: 0, release, sustain: "on", expEnvelope: "on",
        osc2Pitch: 1000 + layer.detune, osc2Volume: 32768, osc2Mode: "add", polyphony, mode: "hq",
      },
      to,
    });
    return key;
  });
  song.addModule(`${prefix}In`, { type: "MultiSynth", name: `${name} In`, to: keys });
  return keys;
}

export function buildCandyCometDocument() {
  const song = new SongBuilder({ name: "Candy Comet", bpm: BPM, speed: 6, globalVolume: 256 });

  // --- Master ----------------------------------------------------------------
  song.addModule("limiter", {
    type: "Compressor", name: "Comet Limiter",
    controllers: { volume: 256, threshold: 228, slope: 100, attack: 0, release: 60, mode: "peakZeroLatency", sideChainInput: 0 },
    to: "output",
  });
  song.addModule("glue", {
    type: "Compressor", name: "Bus Glue",
    controllers: { volume: 256, threshold: 100, slope: 30, attack: 8, release: 160, mode: "rms", sideChainInput: 0 },
    to: "limiter",
  });
  song.addModule("masterBus", { type: "Amplifier", name: "Master Bus", controllers: { volume: 92, stereoWidth: 140 }, to: "glue" });
  song.addModule("hall", {
    type: "Reverb", name: "Hall",
    controllers: { dry: 0, wet: 256, feedback: 216, damp: 140, stereoWidth: 256, mode: "hq", allpassFilter: "improved", roomSize: 40, randomSeed: 99 },
    to: "masterBus",
  });
  song.addModule("hallSend", { type: "Amplifier", name: "Hall Send", controllers: { volume: 64 }, to: "hall" });

  // --- Drums -----------------------------------------------------------------
  song.addModule("drumFilter", {
    type: "Filter", name: "Drum Bus LPF", controllers: { freq: 14000, resonance: 100, type: "lp", rolloff: "db12", mode: "hq", response: 4 },
    to: "masterBus",
  });
  song.addModule("drumBus", { type: "Amplifier", name: "Drum Bus", controllers: { volume: 256 }, to: "drumFilter" });
  // The duck is created before its music sources so the kick is input 1.
  song.addModule("duck", {
    type: "Compressor", name: "Kick Pump",
    controllers: { volume: 256, threshold: 70, slope: 70, attack: 1, release: 120, mode: "peakZeroLatency", sideChainInput: 1 },
    to: "masterBus",
  });
  song.addModule("kickTone", {
    type: "Filter", name: "Kick Tone", controllers: { freq: 7000, resonance: 0, type: "lp", rolloff: "db12", mode: "hq" },
    to: "drumBus",
  });
  song.addModule("kickDrive", { type: "Distortion", name: "Kick Drive", controllers: { volume: 120, type: "saturation3", power: 150 }, to: "kickTone" });
  song.addModule("kick", {
    type: "Kicker", name: "Kick",
    controllers: { volume: 256, waveform: "sin", attack: 0, release: 64, boost: 220, acceleration: 220, polyphony: 1, noClick: "on" },
    to: ["duck", "kickDrive"],
  });
  song.addModule("snareLevel", { type: "Amplifier", name: "Snare Level", controllers: { volume: 300 }, to: ["drumBus", "hallSend"] });
  song.addModule("snareVcf", {
    type: "Filter", name: "Snare HPF", controllers: { freq: 1100, resonance: 140, type: "hp", rolloff: "db12", mode: "hq" },
    to: "snareLevel",
  });
  song.addModule("snareNoise", {
    type: "Analog generator", name: "Snare Noise",
    controllers: { volume: 256, waveform: "whiteNoise", attack: 0, release: 180, sustain: "off", expEnvelope: "on", polyphony: 6, mode: "hq", osc2Volume: 0 },
    to: "snareVcf",
  });
  song.addModule("snareBody", {
    type: "Kicker", name: "Snare Body",
    controllers: { volume: 170, waveform: "triangle", attack: 0, release: 20, boost: 140, acceleration: 110, polyphony: 2 },
    to: "snareLevel",
  });
  song.addModule("clapVcf", {
    type: "Filter", name: "Clap BPF", controllers: { freq: 1500, resonance: 380, type: "bp", rolloff: "db12", mode: "hq" },
    to: ["drumBus", "hallSend"],
  });
  song.addModule("clap", {
    type: "Analog generator", name: "Clap",
    controllers: { volume: 220, waveform: "whiteNoise", attack: 0, release: 176, sustain: "off", expEnvelope: "on", polyphony: 2, osc2Volume: 0 },
    to: "clapVcf",
  });
  song.addModule("openHatVcf", {
    type: "Filter", name: "Open Hat HPF", controllers: { freq: 7800, resonance: 160, type: "hp", rolloff: "db24", mode: "hq" },
    to: "drumBus",
  });
  song.addModule("openHat", {
    type: "Analog generator", name: "Open Hat",
    controllers: { volume: 200, waveform: "whiteNoise", attack: 0, release: 192, sustain: "off", expEnvelope: "on", polyphony: 2, panning: 150, osc2Volume: 0 },
    to: "openHatVcf",
  });
  song.addModule("closedHatVcf", {
    type: "Filter", name: "Closed Hat HPF", controllers: { freq: 9500, resonance: 120, type: "hp", rolloff: "db24", mode: "hq" },
    to: "drumBus",
  });
  song.addModule("closedHat", {
    type: "Analog generator", name: "Closed Hat",
    controllers: { volume: 150, waveform: "whiteNoise", attack: 0, release: 150, sustain: "off", expEnvelope: "on", polyphony: 2, panning: 104, osc2Volume: 0 },
    to: "closedHatVcf",
  });

  // --- Offbeat bass (ducked) -------------------------------------------------
  song.addModule("bassBus", { type: "Amplifier", name: "Bass Bus", controllers: { volume: 360 }, to: "duck" });
  song.addModule("bassDrive", { type: "Distortion", name: "Bass Drive", controllers: { volume: 150, type: "saturation4", power: 60 }, to: "bassBus" });
  song.addModule("bassVcf", {
    type: "Filter", name: "Bass LPF", controllers: { freq: 1500, resonance: 260, type: "lp", rolloff: "db24", mode: "hq" },
    to: "bassDrive",
  });
  song.addModule("bass", {
    type: "Analog generator", name: "Offbeat Bass",
    controllers: { volume: 140, waveform: "saw", attack: 0, release: 150, sustain: "on", expEnvelope: "on", osc2Pitch: 1000 - 768 + 6, osc2Volume: 20000, osc2Mode: "add", polyphony: 1, mode: "hqMono" },
    to: "bassVcf",
  });
  song.addModule("bassIn", { type: "MultiSynth", name: "Bass In", to: "bass" });

  // --- Music bus (ducked) ----------------------------------------------------
  song.addModule("musicBus", { type: "Amplifier", name: "Music Bus", controllers: { volume: 256, stereoWidth: 150 }, to: "duck" });

  // Supersaw chord stabs.
  song.addModule("sawChorus", {
    type: "Flanger", name: "Saw Chorus",
    controllers: { dry: 256, wet: 110, feedback: 20, delay: 320, response: 2, lfoFreq: 60, lfoAmp: 90, lfoWaveform: "sin", lfoFreqUnit: "hz005" },
    to: ["musicBus", "hallSend"],
  });
  song.addModule("sawFilter", {
    type: "Filter", name: "Saw LPF", controllers: { freq: 9000, resonance: 160, type: "lp", rolloff: "db12", mode: "hq", response: 4 },
    to: "sawChorus",
  });
  addSupersaw(song, "saw", { name: "Stab Saws", volume: 36, release: 150, polyphony: 8, to: "sawFilter" });

  // Supersaw lead with a dotted-8th echo.
  song.addModule("leadEcho", {
    type: "Delay", name: "Dotted Echo",
    controllers: { dry: 256, wet: 70, delayL: 3, delayR: 6, volumeL: 220, volumeR: 200, channels: "stereo", delayUnit: "line", delayMultiplier: 1, feedback: 9000 },
    to: ["musicBus", "hallSend"],
  });
  song.addModule("leadTone", {
    type: "Filter", name: "Lead LPF", controllers: { freq: 7200, resonance: 120, type: "lp", rolloff: "db12", mode: "hq" },
    to: "leadEcho",
  });
  addSupersaw(song, "lead", { name: "Lead Saws", volume: 56, release: 168, polyphony: 4, to: "leadTone" });

  // Piano.
  song.addModule("pianoChorus", {
    type: "Flanger", name: "Piano Chorus",
    controllers: { dry: 256, wet: 80, feedback: 10, delay: 260, response: 2, lfoFreq: 80, lfoAmp: 70, lfoWaveform: "sin", lfoFreqUnit: "hz005" },
    to: ["musicBus", "hallSend"],
  });
  song.addModule("pianoTone", {
    type: "Filter", name: "Piano Tone", controllers: { freq: 8000, resonance: 0, type: "lp", rolloff: "db12", mode: "hq" },
    to: "pianoChorus",
  });
  song.addModule("piano", { ...ravePiano(), to: "pianoTone" });

  // Pad: two detuned bowed-saw sections.
  song.addModule("padEnsemble", {
    type: "Flanger", name: "Pad Ensemble",
    controllers: { dry: 256, wet: 160, feedback: 30, delay: 400, response: 2, lfoFreq: 40, lfoAmp: 110, lfoWaveform: "sin", lfoFreqUnit: "hz005" },
    to: ["musicBus", "hallSend"],
  });
  song.addModule("padVcf", {
    type: "Filter", name: "Pad LPF", controllers: { freq: 3200, resonance: 120, type: "lp", rolloff: "db12", mode: "hq" },
    to: "padEnsemble",
  });
  song.addModule("padA", { ...bowedSaw("Pad Saws L", 7, 90), to: "padVcf" });
  song.addModule("padB", { ...bowedSaw("Pad Saws R", -7, 166), to: "padVcf" });
  song.addModule("padIn", { type: "MultiSynth", name: "Pad In", to: ["padA", "padB"] });

  // --- FX --------------------------------------------------------------------
  song.addModule("riserVcf", {
    type: "Filter", name: "Riser BPF", controllers: { freq: 400, resonance: 900, type: "bp", rolloff: "db12", mode: "hq", response: 4 },
    to: ["masterBus", "hallSend"],
  });
  song.addModule("riser", {
    type: "Analog generator", name: "Riser Noise",
    controllers: { volume: 80, waveform: "pinkNoise", attack: 60, release: 30, sustain: "on", polyphony: 1, osc2Volume: 0 },
    to: "riserVcf",
  });
  song.addModule("crashVcf", {
    type: "Filter", name: "Crash HPF", controllers: { freq: 4200, resonance: 60, type: "hp", rolloff: "db12", mode: "hq" },
    to: ["masterBus", "hallSend"],
  });
  song.addModule("crash", {
    type: "Analog generator", name: "Crash",
    controllers: { volume: 96, waveform: "whiteNoise", attack: 0, release: 228, sustain: "off", expEnvelope: "on", polyphony: 2, osc2Volume: 0 },
    to: "crashVcf",
  });
  song.addModule("boom", {
    type: "Kicker", name: "Impact Boom",
    controllers: { volume: 200, waveform: "sin", attack: 0, release: 200, boost: 100, acceleration: 60, polyphony: 1, noClick: "on" },
    to: ["masterBus", "hallSend"],
  });

  // --- Layout ----------------------------------------------------------------
  const LAYOUT = {
    kick: [0, 0], kickDrive: [150, 0], kickTone: [300, 0],
    snareNoise: [0, 80], snareBody: [0, 150], snareVcf: [150, 80], snareLevel: [300, 110],
    clap: [0, 220], clapVcf: [150, 220], openHat: [0, 290], openHatVcf: [150, 290], closedHat: [0, 360], closedHatVcf: [150, 360],
    drumBus: [450, 180], drumFilter: [600, 180],
    bassIn: [0, 460], bass: [150, 460], bassVcf: [300, 460], bassDrive: [450, 460], bassBus: [600, 460],
    sawIn: [0, 580], sawA: [150, 540], sawB: [150, 590], sawC: [150, 640], sawFilter: [300, 580], sawChorus: [450, 580],
    leadIn: [0, 720], leadA: [150, 680], leadB: [150, 730], leadC: [150, 780], leadTone: [300, 720], leadEcho: [450, 720],
    piano: [0, 860], pianoTone: [150, 860], pianoChorus: [300, 860],
    padIn: [0, 960], padA: [150, 940], padB: [150, 1000], padVcf: [300, 960], padEnsemble: [450, 960],
    riser: [0, 1080], riserVcf: [150, 1080], crash: [0, 1150], crashVcf: [150, 1150], boom: [0, 1220],
    musicBus: [700, 760], duck: [850, 460], hallSend: [850, 960], hall: [1000, 960],
    masterBus: [1150, 460], glue: [1300, 460], limiter: [1450, 460], output: [1600, 460],
  };
  for (const [key, [x, y]] of Object.entries(LAYOUT)) song.place(key, x, y);

  // --- Score -----------------------------------------------------------------
  const timeline = new Timeline(song, { sections: SECTIONS, lanes: LANES });
  const M = new Proxy({}, { get: (_, key) => (song.moduleIndex(String(key)), String(key)) });
  arrange(timeline, M);

  return song.build({
    flags: { supertracks: true },
    selectedModule: song.moduleIndex("leadIn"),
    pruneEmptyPatterns: true,
    comments: [
      `Candy Comet: happy hardcore in F major (G major last drop), ${BPM} BPM, ${TOTAL_BARS} bars.`,
      "Built by generated/recipes/music/candy-comet.mjs from native SunVox modules only.",
    ],
  });
}

/** @satisfies {import("../../../tools/sunvox-music-recipe.d.ts").SunVoxMusicRecipe} */
export const recipe = {
  schemaVersion: 1,
  issue: 99,
  tags: ["research:generated-music", "style:happy-hardcore", "style:happycore"],
  outputs: {
    candyComet: {
      file: PROJECT_PATH,
      title: "Candy Comet",
      summaryFile: SUMMARY_PATH,
      params: { bpm: BPM, bars: TOTAL_BARS, key: "F major → G major", form: SECTIONS.map((s) => `${s.name} ${s.bars}`).join(" / ") },
      verification: { durationSeconds: 103, requireAudio: true, maxClippedSamples: 0, maxLeadingSilenceSeconds: 0.1 },
      buildDocument: buildCandyCometDocument,
    },
  },
};

export default recipe;

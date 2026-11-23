#!/usr/bin/env node
// @ts-check
// "Turbo Prism" (#103): a ~100-second Eurobeat instrumental in B minor at
// 156 BPM with a whole-step lift to C# minor for the last two choruses,
// synthesized from native SunVox modules only. Kicker / noise drums with a
// clap backbeat and offbeat open hats, an octave-jumping saw bass, the
// Midnight Loop Line synth brass and strings, a detuned-saw riff/hook lead,
// a mono saw verse lead, a 16th square arpeggio and an FM piano break, all
// sharing one hall reverb. The score lives in
// generated/recipes/music-lib/turbo-prism/. Run with:
//   npm run sunvox:music-recipe -- generated/recipes/music/turbo-prism.mjs

import { SongBuilder, Timeline } from "../../../tools/sunvox-song-builder.mjs";
import { leadSynth, stringPad, synthBrass, tinePiano } from "../music-lib/midnight-loop-line/instruments.mjs";
import { BPM, SECTIONS, TOTAL_BARS, arrange } from "../music-lib/turbo-prism/score.mjs";

const PROJECT_PATH = "generated/music/turbo-prism.sunvox";
const SUMMARY_PATH = "var/music-recipe/turbo-prism.summary.json";

const LANES = [
  { key: "drums", name: "Drums", y: 0, tracks: 6, color: { foreground: "#e8f4ff", background: "#102a3d" } },
  { key: "bass", name: "Bass", y: 32, tracks: 1, color: { foreground: "#d6ffe0", background: "#10361e" } },
  { key: "brass", name: "Brass", y: 64, tracks: 4, color: { foreground: "#ffeacc", background: "#3d2410" } },
  { key: "pad", name: "Strings", y: 96, tracks: 4, color: { foreground: "#ffe4ee", background: "#3a1424" } },
  { key: "lead", name: "Lead", y: 128, tracks: 2, color: { foreground: "#fff0ff", background: "#36103d" } },
  { key: "arp", name: "Arpeggio", y: 160, tracks: 1, color: { foreground: "#e0fffb", background: "#0f3a36" } },
  { key: "piano", name: "Piano", y: 192, tracks: 7, color: { foreground: "#dff2ff", background: "#10283d" } },
  { key: "mod", name: "FX & Automation", y: 224, tracks: 4, color: { foreground: "#fffbd0", background: "#2e2d12" } },
];

/** Reused patch with a new name and controller overrides. */
const patch = (base, name, overrides) => ({ ...base, name, controllers: { ...base.controllers, ...overrides } });

/**
 * Supersaw voice: three stereo Analog generators, each two saws with osc2
 * detuned, spread by module finetune (so equal-pitch layers do not cancel)
 * and panning, fed by one MultiSynth.
 */
function addSupersaw(song, prefix, { name, volume, release, polyphony, to }) {
  const layers = [
    { key: "A", finetune: -14, panning: 52, detune: 9 },
    { key: "B", finetune: 4, panning: 128, detune: -6 },
    { key: "C", finetune: 17, panning: 204, detune: 12 },
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

export function buildTurboPrismDocument() {
  const song = new SongBuilder({ name: "Turbo Prism", bpm: BPM, speed: 6, globalVolume: 256 });

  // --- Master ----------------------------------------------------------------
  song.addModule("limiter", {
    type: "Compressor", name: "Prism Limiter",
    controllers: { volume: 256, threshold: 228, slope: 100, attack: 0, release: 60, mode: "peakZeroLatency", sideChainInput: 0 },
    to: "output",
  });
  song.addModule("glue", {
    type: "Compressor", name: "Bus Glue",
    controllers: { volume: 256, threshold: 104, slope: 28, attack: 8, release: 150, mode: "rms", sideChainInput: 0 },
    to: "limiter",
  });
  song.addModule("masterBus", { type: "Amplifier", name: "Master Bus", controllers: { volume: 86, stereoWidth: 140 }, to: "glue" });
  song.addModule("hall", {
    type: "Reverb", name: "Hall",
    controllers: { dry: 0, wet: 256, feedback: 208, damp: 140, stereoWidth: 256, mode: "hq", allpassFilter: "improved", roomSize: 36, randomSeed: 103 },
    to: "masterBus",
  });
  song.addModule("hallSend", { type: "Amplifier", name: "Hall Send", controllers: { volume: 60 }, to: "hall" });

  // --- Drums -----------------------------------------------------------------
  song.addModule("drumBus", { type: "Amplifier", name: "Drum Bus", controllers: { volume: 256 }, to: "masterBus" });
  song.addModule("kickDrive", { type: "Distortion", name: "Kick Drive", controllers: { volume: 96, type: "saturation3", power: 110 }, to: "drumBus" });
  song.addModule("kick", {
    type: "Kicker", name: "Kick",
    controllers: { volume: 240, waveform: "sin", attack: 0, release: 48, boost: 190, acceleration: 200, polyphony: 1, noClick: "on" },
    to: "kickDrive",
  });
  song.addModule("snareLevel", { type: "Amplifier", name: "Snare Level", controllers: { volume: 320 }, to: ["drumBus", "hallSend"] });
  song.addModule("snareVcf", {
    type: "Filter", name: "Snare HPF", controllers: { freq: 1200, resonance: 140, type: "hp", rolloff: "db12", mode: "hq" },
    to: "snareLevel",
  });
  song.addModule("snareNoise", {
    type: "Analog generator", name: "Snare Noise",
    controllers: { volume: 256, waveform: "whiteNoise", attack: 0, release: 176, sustain: "off", expEnvelope: "on", polyphony: 6, mode: "hq", osc2Volume: 0 },
    to: "snareVcf",
  });
  song.addModule("snareBody", {
    type: "Kicker", name: "Snare Body",
    controllers: { volume: 160, waveform: "triangle", attack: 0, release: 20, boost: 130, acceleration: 110, polyphony: 2 },
    to: "snareLevel",
  });
  song.addModule("clapVcf", {
    type: "Filter", name: "Clap BPF", controllers: { freq: 1400, resonance: 400, type: "bp", rolloff: "db12", mode: "hq" },
    to: ["drumBus", "hallSend"],
  });
  song.addModule("clap", {
    type: "Analog generator", name: "Clap",
    controllers: { volume: 230, waveform: "whiteNoise", attack: 0, release: 178, sustain: "off", expEnvelope: "on", polyphony: 2, osc2Volume: 0 },
    to: "clapVcf",
  });
  song.addModule("openHatVcf", {
    type: "Filter", name: "Open Hat HPF", controllers: { freq: 7600, resonance: 160, type: "hp", rolloff: "db24", mode: "hq" },
    to: "drumBus",
  });
  song.addModule("openHat", {
    type: "Analog generator", name: "Open Hat",
    controllers: { volume: 180, waveform: "whiteNoise", attack: 0, release: 190, sustain: "off", expEnvelope: "on", polyphony: 2, panning: 150, osc2Volume: 0 },
    to: "openHatVcf",
  });
  song.addModule("closedHatVcf", {
    type: "Filter", name: "Closed Hat HPF", controllers: { freq: 9500, resonance: 120, type: "hp", rolloff: "db24", mode: "hq" },
    to: "drumBus",
  });
  song.addModule("closedHat", {
    type: "Analog generator", name: "Closed Hat",
    controllers: { volume: 140, waveform: "whiteNoise", attack: 0, release: 148, sustain: "off", expEnvelope: "on", polyphony: 2, panning: 104, osc2Volume: 0 },
    to: "closedHatVcf",
  });
  song.addModule("crashVcf", {
    type: "Filter", name: "Crash HPF", controllers: { freq: 4300, resonance: 60, type: "hp", rolloff: "db12", mode: "hq" },
    to: ["masterBus", "hallSend"],
  });
  song.addModule("crash", {
    type: "Analog generator", name: "Crash",
    controllers: { volume: 96, waveform: "whiteNoise", attack: 0, release: 226, sustain: "off", expEnvelope: "on", polyphony: 2, osc2Volume: 0 },
    to: "crashVcf",
  });

  // --- Bass ------------------------------------------------------------------
  song.addModule("bassBus", { type: "Amplifier", name: "Bass Bus", controllers: { volume: 135 }, to: "masterBus" });
  song.addModule("bassDrive", { type: "Distortion", name: "Bass Drive", controllers: { volume: 160, type: "saturation4", power: 50 }, to: "bassBus" });
  song.addModule("bass", {
    type: "Analog generator", name: "Octave Bass",
    controllers: {
      volume: 150, waveform: "saw", attack: 0, release: 120, sustain: "on", expEnvelope: "on",
      osc2Pitch: 1000 + 7, osc2Volume: 22000, osc2Mode: "add", polyphony: 1, mode: "hqMono",
      filter: "lp24db", filterFreq: 1900, filterResonance: 150, filterExpFreq: "on", filterEnvelope: "off",
    },
    to: "bassDrive",
  });

  // --- Music bus: brass, strings, leads, arpeggio, piano ---------------------
  song.addModule("musicFilter", {
    type: "Filter", name: "Music LPF", controllers: { freq: 14000, resonance: 120, type: "lp", rolloff: "db12", mode: "hq", response: 4 },
    to: "masterBus",
  });
  song.addModule("musicBus", { type: "Amplifier", name: "Music Bus", controllers: { volume: 256, stereoWidth: 150 }, to: "musicFilter" });

  song.addModule("brassTone", {
    type: "Filter", name: "Brass Tone", controllers: { freq: 7500, resonance: 0, type: "lp", rolloff: "db12", mode: "hq" },
    to: ["musicBus", "hallSend"],
  });
  song.addModule("brass", { ...patch(synthBrass(), "Prism Brass", { volume: 52, panning: 144, attack: 2, release: 40 }), to: "brassTone" });
  song.addModule("stringEnsemble", {
    type: "Flanger", name: "String Ensemble",
    controllers: { dry: 256, wet: 150, feedback: 30, delay: 380, response: 2, lfoFreq: 50, lfoAmp: 100, lfoWaveform: "sin", lfoFreqUnit: "hz005" },
    to: ["musicBus", "hallSend"],
  });
  song.addModule("strings", { ...patch(stringPad(), "Prism Strings", { volume: 40, panning: 110 }), to: "stringEnsemble" });

  song.addModule("leadEcho", {
    type: "Delay", name: "Dotted Echo",
    controllers: { dry: 256, wet: 60, delayL: 3, delayR: 6, volumeL: 220, volumeR: 200, channels: "stereo", delayUnit: "line", delayMultiplier: 1, feedback: 8000 },
    to: ["musicBus", "hallSend"],
  });
  song.addModule("leadTone", {
    type: "Filter", name: "Lead LPF", controllers: { freq: 7800, resonance: 120, type: "lp", rolloff: "db12", mode: "hq" },
    to: "leadEcho",
  });
  addSupersaw(song, "sawLead", { name: "Prism Lead", volume: 33, release: 160, polyphony: 4, to: "leadTone" });
  song.addModule("verseLead", { ...patch(leadSynth(), "Prism Verse Lead", { volume: 100 }), to: "leadEcho" });

  song.addModule("arpEcho", {
    type: "Delay", name: "Arp Echo",
    controllers: { dry: 256, wet: 70, delayL: 3, delayR: 5, volumeL: 200, volumeR: 220, channels: "stereo", delayUnit: "line", delayMultiplier: 1, feedback: 6000 },
    to: "musicBus",
  });
  song.addModule("arp", {
    type: "Analog generator", name: "Square Arp",
    controllers: {
      volume: 150, waveform: "square", panning: 128, attack: 0, release: 110, sustain: "off", expEnvelope: "on", dutyCycle: 300,
      osc2Volume: 0, filter: "lp12db", filterFreq: 5200, filterResonance: 100, polyphony: 2, mode: "hq",
    },
    to: "arpEcho",
  });

  song.addModule("pianoTone", {
    type: "Filter", name: "Piano Tone", controllers: { freq: 8000, resonance: 0, type: "lp", rolloff: "db12", mode: "hq" },
    to: ["musicBus", "hallSend"],
  });
  song.addModule("piano", { ...patch(tinePiano(), "Prism Piano", { volume: 5500, polyphony: 12 }), to: "pianoTone" });

  // --- FX --------------------------------------------------------------------
  song.addModule("riserVcf", {
    type: "Filter", name: "Riser BPF", controllers: { freq: 500, resonance: 900, type: "bp", rolloff: "db12", mode: "hq", response: 4 },
    to: ["masterBus", "hallSend"],
  });
  song.addModule("riser", {
    type: "Analog generator", name: "Riser Noise",
    controllers: { volume: 72, waveform: "pinkNoise", attack: 60, release: 30, sustain: "on", polyphony: 1, osc2Volume: 0 },
    to: "riserVcf",
  });

  // --- Layout ----------------------------------------------------------------
  const LAYOUT = {
    kick: [0, 0], kickDrive: [150, 0],
    snareNoise: [0, 80], snareBody: [0, 150], snareVcf: [150, 80], snareLevel: [300, 110],
    clap: [0, 220], clapVcf: [150, 220], openHat: [0, 290], openHatVcf: [150, 290], closedHat: [0, 360], closedHatVcf: [150, 360],
    crash: [0, 430], crashVcf: [150, 430], drumBus: [450, 180],
    bass: [0, 520], bassDrive: [150, 520], bassBus: [300, 520],
    brass: [0, 600], brassTone: [150, 600], strings: [0, 680], stringEnsemble: [150, 680],
    sawLeadIn: [0, 800], sawLeadA: [150, 760], sawLeadB: [150, 810], sawLeadC: [150, 860], leadTone: [300, 800],
    verseLead: [150, 920], leadEcho: [450, 840],
    arp: [0, 1000], arpEcho: [150, 1000], piano: [0, 1080], pianoTone: [150, 1080],
    riser: [0, 1160], riserVcf: [150, 1160],
    musicBus: [650, 840], musicFilter: [800, 840], hallSend: [800, 1000], hall: [950, 1000],
    masterBus: [1100, 520], glue: [1250, 520], limiter: [1400, 520], output: [1550, 520],
  };
  for (const [key, [x, y]] of Object.entries(LAYOUT)) song.place(key, x, y);

  // --- Score -----------------------------------------------------------------
  const timeline = new Timeline(song, { sections: SECTIONS, lanes: LANES });
  const M = new Proxy({}, { get: (_, key) => (song.moduleIndex(String(key)), String(key)) });
  arrange(timeline, M);

  return song.build({
    flags: { supertracks: true },
    selectedModule: song.moduleIndex("sawLeadIn"),
    pruneEmptyPatterns: true,
    comments: [
      `Turbo Prism: Eurobeat in B minor (C# minor last choruses), ${BPM} BPM, ${TOTAL_BARS} bars.`,
      "Built by generated/recipes/music/turbo-prism.mjs from native SunVox modules only.",
    ],
  });
}

/** @satisfies {import("../../../tools/sunvox-music-recipe.d.ts").SunVoxMusicRecipe} */
export const recipe = {
  schemaVersion: 1,
  issue: 103,
  tags: ["research:generated-music", "style:eurobeat"],
  outputs: {
    turboPrism: {
      file: PROJECT_PATH,
      title: "Turbo Prism",
      summaryFile: SUMMARY_PATH,
      params: { bpm: BPM, bars: TOTAL_BARS, key: "B minor → C# minor", form: SECTIONS.map((s) => `${s.name} ${s.bars}`).join(" / ") },
      verification: { durationSeconds: 103, requireAudio: true, maxClippedSamples: 0, maxLeadingSilenceSeconds: 0.1 },
      buildDocument: buildTurboPrismDocument,
    },
  },
};

export default recipe;

#!/usr/bin/env node
// @ts-check
// "Voltage Garden" (#90): a one-minute seamless loop built as a modular
// patch from native SunVox modules only (no samples). Modulation is patched,
// not drawn: a tempo-synced LFO sweeps the sequencer VCF through Sound2Ctl,
// an ADSR envelope opens the bass VCF, a stepped-random LFO is the sample &
// hold for the band-pass plucks, and one MultiCtl "voltage" macro fans out to
// five destinations, including the depth of the other modulators. Run with:
//   npm run sunvox:music-recipe -- recipes/research/90/voltage-garden.mjs

import { SongBuilder, Timeline } from "../../../tools/sunvox-song-builder.mjs";
import { BPM, SECTIONS, TOTAL_BARS, arrange } from "./voltage-garden-score.mjs";

const PROJECT_PATH = "var/90/voltage-garden.sunvox";
const SUMMARY_PATH = "var/90/voltage-garden.summary.json";

const LANES = [
  { key: "drums", name: "Drums", y: 0, tracks: 5, color: { foreground: "#fff0d6", background: "#3a2a12" } },
  { key: "bass", name: "Bass", y: 32, tracks: 1, color: { foreground: "#d8ffe4", background: "#12331f" } },
  { key: "seq", name: "Sequencer", y: 64, tracks: 1, color: { foreground: "#dcf3ff", background: "#11293a" } },
  { key: "chords", name: "Pad & Plucks", y: 96, tracks: 6, color: { foreground: "#f0e4ff", background: "#25183a" } },
  { key: "lead", name: "FM Lead", y: 128, tracks: 1, color: { foreground: "#ffe4ee", background: "#3a1424" } },
  { key: "mod", name: "Modulation", y: 160, tracks: 8, color: { foreground: "#fffbd0", background: "#2e2d12" } },
];

// Controller numbers for Sound2Ctl / MultiCtl outputs are 1-based (0 = none).
const CTL = { filterFreq: 2, filterResonance: 3, distortionPower: 3, delayFeedback: 11, sound2CtlOutMax: 8 };
const norm = (value, max) => Math.round((value / max) * 32768);

export function buildVoltageGardenDocument() {
  const song = new SongBuilder({ name: "Voltage Garden", bpm: BPM, speed: 6, globalVolume: 256 });

  // --- Master ----------------------------------------------------------------
  song.addModule("limiter", {
    type: "Compressor", name: "Rail Limiter",
    controllers: { volume: 256, threshold: 228, slope: 100, attack: 0, release: 60, mode: "peakZeroLatency", sideChainInput: 0 },
    to: "output",
  });
  song.addModule("glue", {
    type: "Compressor", name: "Bus Glue",
    controllers: { volume: 256, threshold: 90, slope: 30, attack: 10, release: 200, mode: "rms", sideChainInput: 0 },
    to: "limiter",
  });
  song.addModule("masterBus", { type: "Amplifier", name: "Master Bus", controllers: { volume: 150, stereoWidth: 136 }, to: "glue" });
  song.addModule("spring", {
    type: "Reverb", name: "Spring Tank",
    controllers: { dry: 0, wet: 256, feedback: 200, damp: 140, stereoWidth: 256, mode: "hq", allpassFilter: "improved", roomSize: 30, randomSeed: 90 },
    to: "masterBus",
  });
  song.addModule("springSend", { type: "Amplifier", name: "Spring Send", controllers: { volume: 80 }, to: "spring" });

  // --- Drums: Kicker + filtered noise ----------------------------------------
  song.addModule("drumBus", { type: "Amplifier", name: "Drum Bus", controllers: { volume: 256 }, to: "masterBus" });
  // The duck is created before its music sources so the kick is input 1.
  song.addModule("duck", {
    type: "Compressor", name: "Kick Duck",
    controllers: { volume: 256, threshold: 100, slope: 40, attack: 1, release: 80, mode: "peakZeroLatency", sideChainInput: 1 },
    to: "masterBus",
  });
  song.addModule("kick", {
    type: "Kicker", name: "Kick",
    controllers: { volume: 230, waveform: "sin", attack: 0, release: 70, boost: 260, acceleration: 220, polyphony: 1, noClick: "on" },
    to: ["duck", "drumBus"],
  });
  song.addModule("snareLevel", { type: "Amplifier", name: "Snare Level", controllers: { volume: 560 }, to: ["drumBus", "springSend"] });
  song.addModule("snareVcf", {
    type: "Filter", name: "Snare HPF", controllers: { freq: 1100, resonance: 160, type: "hp", rolloff: "db12", mode: "hq" },
    to: "snareLevel",
  });
  song.addModule("snareNoise", {
    type: "Analog generator", name: "Snare Noise",
    controllers: { volume: 256, waveform: "whiteNoise", attack: 0, release: 30, sustain: "off", expEnvelope: "on", polyphony: 4, mode: "hq" },
    to: "snareVcf",
  });
  song.addModule("snareBody", {
    type: "Kicker", name: "Snare Body",
    controllers: { volume: 150, waveform: "triangle", attack: 0, release: 18, boost: 120, acceleration: 120, polyphony: 2 },
    to: "snareLevel",
  });
  song.addModule("hatLevel", { type: "Amplifier", name: "Hat Level", controllers: { volume: 900 }, to: "drumBus" });
  song.addModule("hatVca", {
    // 12-line amplitude LFO on the hat bus: a 3-against-4 accent cycle.
    type: "LFO", name: "Hat VCA 12",
    controllers: { volume: 256, type: "amplitude", amplitude: 150, freq: 12, frequencyUnit: "line", waveform: "saw2", channels: "stereo", generator: "off" },
    to: "hatLevel",
  });
  song.addModule("hatVcf", {
    type: "Filter", name: "Hat HPF", controllers: { freq: 6500, resonance: 200, type: "hp", rolloff: "db24", mode: "hq" },
    to: "hatVca",
  });
  song.addModule("hat", {
    type: "Analog generator", name: "Closed Hat",
    controllers: { volume: 230, waveform: "whiteNoise", attack: 0, release: 18, sustain: "off", expEnvelope: "on", polyphony: 4, panning: 150 },
    to: "hatVcf",
  });
  song.addModule("openHat", {
    type: "Analog generator", name: "Open Hat",
    controllers: { volume: 180, waveform: "whiteNoise", attack: 0, release: 40, sustain: "off", expEnvelope: "on", polyphony: 2, panning: 110 },
    to: "hatVcf",
  });

  // --- Bass: MultiSynth splits notes to the VCO and an ADSR -> VCF patch ------
  song.addModule("bassVcf", {
    type: "Filter", name: "Bass VCF", controllers: { freq: 300, resonance: 700, type: "lp", rolloff: "db24", mode: "hq", response: 2 },
    to: "duck",
  });
  song.addModule("bassVco", {
    type: "Analog generator", name: "Bass VCO",
    controllers: { volume: 90, waveform: "saw", osc2Pitch: 1000 + 6, osc2Volume: 22000, osc2Mode: "add", attack: 0, release: 6, sustain: "on", polyphony: 1, mode: "hqMono" },
    to: "bassVcf",
  });
  song.addModule("bassEnvS2C", {
    type: "Sound2Ctl", name: "Env -> Bass Cutoff",
    controllers: { sampleRate: 2000, channels: "mono", absolute: "on", gain: 256, smooth: 0, mode: "hq", outMin: norm(140, 14000), outMax: norm(2600, 14000), outController: CTL.filterFreq },
    to: "bassVcf",
  });
  song.addModule("bassEnv", {
    type: "ADSR", name: "Bass Env",
    controllers: { attack: 0, decay: 700, sustainLevel: 3000, release: 200, decayCurve: "exp1", sustain: "on", onNoteOn: "start", onNoteOff: "stop", mode: "generator" },
    to: "bassEnvS2C",
  });
  song.addModule("bassIn", { type: "MultiSynth", name: "Bass In", to: ["bassVco", "bassEnv"] });

  // --- Sequencer: VCO -> drive -> resonant VCF swept by a synced LFO -> echo --
  song.addModule("musicBus", { type: "Amplifier", name: "Music Bus", controllers: { volume: 256, stereoWidth: 150 }, to: "duck" });
  song.addModule("seqEcho", {
    type: "Delay", name: "Dotted Echo",
    controllers: { dry: 256, wet: 90, delayL: 3, delayR: 6, volumeL: 256, volumeR: 200, channels: "stereo", delayUnit: "line", delayMultiplier: 1, feedback: 9000 },
    to: ["musicBus", "springSend"],
  });
  song.addModule("seqDrive", {
    type: "Distortion", name: "Seq Drive", controllers: { volume: 150, type: "saturation3", power: 120 },
    to: "seqEcho",
  });
  song.addModule("seqVcf", {
    type: "Filter", name: "Seq VCF", controllers: { freq: 1200, resonance: 900, type: "lp", rolloff: "db24", mode: "hq", response: 4 },
    to: "seqDrive",
  });
  song.addModule("seqVco", {
    type: "Analog generator", name: "Seq VCO",
    controllers: { volume: 200, waveform: "saw", osc2Pitch: 1000 + 9, osc2Volume: 26000, osc2Mode: "add", dutyCycle: 512, attack: 0, release: 40, sustain: "off", expEnvelope: "on", polyphony: 2, mode: "hq", panning: 128 },
    to: "seqVcf",
  });
  song.addModule("seqIn", { type: "MultiSynth", name: "Seq In", to: "seqVco" });
  song.addModule("seqLfoS2C", {
    type: "Sound2Ctl", name: "LFO -> Seq Cutoff",
    controllers: { sampleRate: 400, channels: "mono", absolute: "on", gain: 256, smooth: 0, mode: "hq", outMin: norm(260, 14000), outMax: norm(3600, 14000), outController: CTL.filterFreq },
    to: "seqVcf",
  });
  song.addModule("seqLfo", {
    // Four-bar triangle: the classic slow filter sweep, patched, not drawn.
    type: "LFO", name: "Sweep LFO 4 bars",
    controllers: { volume: 256, type: "amplitude", amplitude: 256, freq: 64, frequencyUnit: "line", waveform: "triangle", generator: "on", channels: "mono" },
    to: "seqLfoS2C",
  });

  // --- Pad -------------------------------------------------------------------
  song.addModule("padEnsemble", {
    type: "Flanger", name: "Pad Ensemble",
    controllers: { dry: 256, wet: 170, feedback: 40, delay: 380, response: 2, lfoFreq: 50, lfoAmp: 120, lfoWaveform: "sin", lfoFreqUnit: "hz005" },
    to: ["musicBus", "springSend"],
  });
  song.addModule("padVcf", {
    type: "Filter", name: "Pad VCF", controllers: { freq: 2400, resonance: 250, type: "lp", rolloff: "db12", mode: "hq", response: 8 },
    to: "padEnsemble",
  });
  song.addModule("pad", {
    type: "Analog generator", name: "Pad VCO",
    controllers: { volume: 26, waveform: "saw", osc2Pitch: 1000 - 11, osc2Volume: 30000, osc2Mode: "add", attack: 110, release: 120, sustain: "on", expEnvelope: "on", polyphony: 8, mode: "hq" },
    to: "padVcf",
  });

  // --- Plucks: band-pass "bongos" with a stepped-random sample & hold ----------
  song.addModule("pluckEcho", {
    type: "Delay", name: "Ping Pong",
    controllers: { dry: 256, wet: 120, delayL: 4, delayR: 6, volumeL: 230, volumeR: 230, channels: "stereo", delayUnit: "line", delayMultiplier: 1, feedback: 12000 },
    to: ["musicBus", "springSend"],
  });
  song.addModule("pluckVcf", {
    type: "Filter", name: "Pluck BPF", controllers: { volume: 256, freq: 1500, resonance: 1250, type: "bp", rolloff: "db12", mode: "hq", response: 0 },
    to: "pluckEcho",
  });
  song.addModule("pluck", {
    type: "Generator", name: "Pluck VCO",
    controllers: { volume: 70, waveform: "triangle", attack: 0, release: 30, sustain: "off", polyphony: 4, mode: "stereo", panning: 128 },
    to: "pluckVcf",
  });
  song.addModule("pluckSH", {
    type: "Sound2Ctl", name: "S&H -> Pluck BPF",
    controllers: { sampleRate: 400, channels: "mono", absolute: "on", gain: 256, smooth: 0, mode: "hq", outMin: norm(700, 14000), outMax: norm(5200, 14000), outController: CTL.filterFreq },
    to: "pluckVcf",
  });
  song.addModule("pluckRandom", {
    type: "LFO", name: "Random 1 line",
    controllers: { volume: 256, type: "amplitude", amplitude: 256, freq: 1, frequencyUnit: "line", waveform: "random", generator: "on", channels: "mono" },
    to: "pluckSH",
  });

  // --- FM lead: modulator VCO (+1 octave) -> wobble VCA -> carrier FM input ----
  song.addModule("leadEcho", {
    type: "Echo", name: "Lead Echo",
    controllers: { dry: 256, wet: 70, feedback: 110, delay: 3, delayUnit: "line", rightChannelOffset: "on", rightChannelOffsetValue: 4096, filter: "lp6db", filterFreq: 5000 },
    to: ["musicBus", "springSend"],
  });
  song.addModule("leadVibrato", {
    type: "Vibrato", name: "Lead Vibrato",
    controllers: { volume: 256, amplitude: 14, freq: 330, frequencyUnit: "hz64", channels: "stereo" },
    to: "leadEcho",
  });
  song.addModule("leadCarrier", {
    type: "Generator", name: "Lead Carrier",
    controllers: { volume: 70, waveform: "sin", attack: 12, release: 40, sustain: "on", polyphony: 1, mode: "mono", freqModulationByInput: 48 },
    to: "leadVibrato",
  });
  song.addModule("leadWobble", {
    type: "LFO", name: "Index LFO 2 bars",
    controllers: { volume: 256, type: "amplitude", amplitude: 180, freq: 32, frequencyUnit: "line", waveform: "sin", generator: "off", channels: "stereo" },
    to: "leadCarrier",
  });
  song.addModule("leadMod", {
    type: "Generator", name: "Lead Modulator",
    controllers: { volume: 200, waveform: "sin", attack: 0, release: 60, sustain: "on", polyphony: 1, mode: "mono" },
    to: "leadWobble",
  });
  song.addModule("leadRatio", { type: "MultiSynth", name: "Ratio x2", controllers: { transpose: 128 + 12 }, to: "leadMod" });
  song.addModule("leadIn", { type: "MultiSynth", name: "Lead In", to: ["leadCarrier", "leadRatio"] });

  // --- Riser -----------------------------------------------------------------
  song.addModule("riserVcf", {
    type: "Filter", name: "Riser BPF", controllers: { freq: 400, resonance: 900, type: "bp", rolloff: "db12", mode: "hq", response: 4 },
    to: ["masterBus", "springSend"],
  });
  song.addModule("riser", {
    type: "Analog generator", name: "Riser Noise",
    controllers: { volume: 60, waveform: "pinkNoise", attack: 40, release: 20, sustain: "on", polyphony: 1 },
    to: "riserVcf",
  });

  // --- The "voltage" macro: one knob, five destinations ----------------------
  // Output slots follow the order of the MultiCtl's output links (destination
  // module order), checked by probe-modulation.mjs song.
  const macroTargets = [
    ["bassEnvS2C", { controller: CTL.sound2CtlOutMax, min: norm(900, 14000), max: norm(5200, 14000) }],
    ["seqVcf", { controller: CTL.filterResonance, min: norm(600, 1530), max: norm(1150, 1530) }],
    ["seqEcho", { controller: CTL.delayFeedback, min: 5000, max: 17000 }],
    ["seqDrive", { controller: CTL.distortionPower, min: norm(80, 256), max: norm(220, 256) }],
    ["padVcf", { controller: CTL.filterFreq, min: norm(900, 14000), max: norm(5200, 14000) }],
  ].sort(([a], [b]) => song.moduleIndex(a) - song.moduleIndex(b));
  song.addModule("macro", {
    type: "MultiCtl", name: "Voltage Macro",
    controllers: { value: norm(0.3, 1), response: 1000, sampleRate: 150 },
    dataChunks: [{ index: 0, name: "outputSlots", slots: macroTargets.map(([, slot], index) => ({ index, ...slot })) }],
    to: macroTargets.map(([key]) => key),
  });

  // --- Layout ----------------------------------------------------------------
  const LAYOUT = {
    kick: [0, 0], snareNoise: [0, 90], snareVcf: [150, 90], snareBody: [0, 160], snareLevel: [300, 120], hat: [0, 240], openHat: [0, 310], hatVcf: [150, 270], hatVca: [300, 270], hatLevel: [450, 270], drumBus: [600, 150],
    bassIn: [0, 420], bassVco: [150, 400], bassEnv: [150, 470], bassEnvS2C: [300, 470], bassVcf: [450, 420],
    seqIn: [0, 560], seqVco: [150, 560], seqVcf: [300, 560], seqDrive: [450, 560], seqEcho: [600, 560], seqLfo: [150, 640], seqLfoS2C: [300, 640],
    pad: [0, 740], padVcf: [150, 740], padEnsemble: [300, 740],
    pluck: [0, 830], pluckVcf: [150, 830], pluckEcho: [300, 830], pluckRandom: [0, 900], pluckSH: [150, 900],
    leadIn: [0, 1000], leadRatio: [150, 1060], leadMod: [300, 1060], leadWobble: [450, 1060], leadCarrier: [600, 1000], leadVibrato: [750, 1000], leadEcho: [900, 1000],
    riser: [0, 1160], riserVcf: [150, 1160],
    macro: [750, 400],
    musicBus: [800, 700], duck: [950, 450], springSend: [950, 850], spring: [1100, 850],
    masterBus: [1250, 450], glue: [1400, 450], limiter: [1550, 450], output: [1700, 450],
  };
  for (const [key, [x, y]] of Object.entries(LAYOUT)) song.place(key, x, y);

  // --- Score -----------------------------------------------------------------
  const timeline = new Timeline(song, { sections: SECTIONS, lanes: LANES });
  const M = new Proxy({}, { get: (_, key) => (song.moduleIndex(String(key)), String(key)) });
  arrange(timeline, M);

  return song.build({
    flags: { supertracks: true },
    selectedModule: song.moduleIndex("macro"),
    pruneEmptyPatterns: true,
    comments: [
      `Voltage Garden: modular-synth loop in D Dorian, ${BPM} BPM, ${TOTAL_BARS} bars = 60 s, seamless loop.`,
      "Built by recipes/research/90/voltage-garden.mjs from native SunVox modules only.",
    ],
  });
}

/** @satisfies {import("../../../tools/sunvox-music-recipe.d.ts").SunVoxMusicRecipe} */
export const recipe = {
  schemaVersion: 1,
  issue: 90,
  tags: ["research:generated-music", "style:modular", "style:berlin-school"],
  outputs: {
    voltageGarden: {
      file: PROJECT_PATH,
      title: "Voltage Garden",
      summaryFile: SUMMARY_PATH,
      params: { bpm: BPM, bars: TOTAL_BARS, key: "D Dorian", form: SECTIONS.map((s) => `${s.name} ${s.bars}`).join(" / ") },
      verification: { durationSeconds: 64, requireAudio: true, maxClippedSamples: 0, maxLeadingSilenceSeconds: 0.1 },
      buildDocument: buildVoltageGardenDocument,
    },
  },
};

export default recipe;

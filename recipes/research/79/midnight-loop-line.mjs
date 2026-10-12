#!/usr/bin/env node
// @ts-check
// "Midnight Loop Line" (#79): a two-minute neo city pop instrumental built
// entirely from code. Drums, guitar and ambience are synthesized offline and
// embedded in Samplers; keys, bass, brass, strings and leads are native
// SunVox synths. Run with:
//   npm run sunvox:music-recipe -- recipes/research/79/midnight-loop-line.mjs

import { buildSamplerModules } from "../../../tools/sunvox-sampler-embed.mjs";
import { toWav16 } from "../../../tools/sample-synth.mjs";
import { drumKitSamples } from "./drum-kit.mjs";
import * as patches from "./instruments.mjs";
import { BAR_SECONDS, BPM, SECTIONS, arrange } from "./score.mjs";
import { SongBuilder, Timeline } from "./song-builder.mjs";

const PROJECT_PATH = "var/79/midnight-loop-line.sunvox";
const SUMMARY_PATH = "var/79/midnight-loop-line.summary.json";

const LANES = [
  { key: "drums", name: "Drums", y: 0, tracks: 8, color: { foreground: "#ffe3ea", background: "#3a1426" } },
  { key: "bass", name: "Bass", y: 32, tracks: 2, color: { foreground: "#dcffe9", background: "#123326" } },
  { key: "keys", name: "Keys", y: 64, tracks: 12, color: { foreground: "#e2f2ff", background: "#152a40" } },
  { key: "lead", name: "Lead & Brass", y: 96, tracks: 11, color: { foreground: "#ffe9f6", background: "#3b1838" } },
  { key: "twin", name: "Twin Lead", y: 160, tracks: 1, color: { foreground: "#ffe9f6", background: "#4a1a3a" } },
  { key: "fx", name: "City & Automation", y: 128, tracks: 6, color: { foreground: "#f1ecff", background: "#221d3a" } },
];

const at = (x, y) => ({ x, y, z: 0 });

async function samplerKits() {
  const kit = drumKitSamples({ barSeconds: BAR_SECONDS });
  const wav = (name) => toWav16(kit[name]);
  const guitarMute = toWav16(patches.karplusGuitar({ mute: true }));
  const guitarOpen = toWav16(patches.karplusGuitar({ seed: 203 }));
  const specs = [
    { key: "kick", name: "Loop Kick", samples: [{ wav: wav("kick") }] },
    {
      key: "snare", name: "Platform Snare",
      samples: [{ wav: wav("snare") }, { wav: wav("snareGhost"), baseNote: "D5" }],
      noteMap: [["C0", "C#5", 0], ["D5", "B9", 1]],
    },
    { key: "clap", name: "Neon Clap", samples: [{ wav: wav("clap") }] },
    {
      key: "hats", name: "Signal Hats",
      samples: [{ wav: wav("closedHat") }, { wav: wav("openHat"), baseNote: "D5" }, { wav: wav("pedalHat"), baseNote: "E5" }],
      noteMap: [["C0", "C#5", 0], ["D5", "D#5", 1], ["E5", "B9", 2]],
    },
    {
      key: "perc", name: "Shaker & Tambourine",
      samples: [
        { wav: wav("shaker") },
        { wav: wav("shakerBack"), baseNote: "D5" },
        { wav: wav("tambourine"), baseNote: "E5" },
        { wav: wav("snap"), baseNote: "F5" },
      ],
      noteMap: [["C0", "C#5", 0], ["D5", "D#5", 1], ["E5", "E5", 2], ["F5", "B9", 3]],
    },
    { key: "toms", name: "Tunnel Toms", samples: [{ wav: wav("tom") }] },
    {
      key: "cymbals", name: "Crash & Swell",
      samples: [{ wav: wav("crash") }, { wav: wav("reverseCymbal"), baseNote: "D5" }],
      noteMap: [["C0", "C#5", 0], ["D5", "B9", 1]],
    },
    {
      key: "ambience", name: "Crossing & Train",
      samples: [{ wav: wav("passingTrain") }, { wav: wav("crossingBell"), baseNote: "D5" }],
      noteMap: [["C0", "C5", 0], ["C#5", "B9", 1]],
    },
    { key: "cutMute", name: "Cutting (muted)", samples: [{ wav: guitarMute }] },
    { key: "cutOpen", name: "Cutting (open)", samples: [{ wav: guitarOpen }] },
  ];
  const modules = await buildSamplerModules(specs);
  return Object.fromEntries(specs.map((spec, index) => [spec.key, modules[index]]));
}

function sampler(module, { color, volume, panning = 128, polyphony = 8, position }) {
  return {
    ...module,
    color,
    position,
    controllers: { ...module.controllers, volume, panning, polyphony },
  };
}

export async function buildMidnightLoopLineDocument() {
  const kits = await samplerKits();
  const song = new SongBuilder({ name: "Midnight Loop Line", bpm: BPM, speed: 6, globalVolume: 256 });

  // --- Master chain ---------------------------------------------------------
  song.addModule("limiter", {
    type: "Compressor", name: "Last Train Limiter", color: "#ff6b6b", position: at(2200, 600),
    controllers: { volume: 256, threshold: 228, slope: 100, attack: 0, release: 60, mode: "peakZeroLatency", sideChainInput: 0 },
    to: "output",
  });
  song.addModule("busGlue", {
    type: "Compressor", name: "Night Bus Glue", color: "#ff9f6b", position: at(2000, 600),
    controllers: { volume: 256, threshold: 72, slope: 30, attack: 15, release: 240, mode: "rms", sideChainInput: 0 },
    to: "limiter",
  });
  song.addModule("masterEq", {
    type: "EQ", name: "Tape Tilt", color: "#ffd36b", position: at(1800, 600),
    controllers: { low: 266, middle: 248, high: 270, channels: "stereo" },
    to: "busGlue",
  });
  song.addModule("masterBus", {
    type: "Amplifier", name: "Master Bus", color: "#d6d8d8", position: at(1600, 600),
    controllers: { volume: 132, balance: 128, dcOffset: 128, inverse: "off", stereoWidth: 140, absolute: "off", fineVolume: 32768, gain: 1, bipolarDcOffset: 16384 },
    to: "masterEq",
  });

  // --- Drums ----------------------------------------------------------------
  song.addModule("drumGlue", {
    type: "Compressor", name: "Drum Glue", color: "#ff7b9c", position: at(1300, 200),
    controllers: { volume: 256, threshold: 150, slope: 40, attack: 3, release: 120, mode: "peak", sideChainInput: 0 },
    to: "masterBus",
  });
  song.addModule("drumBus", {
    type: "Amplifier", name: "Drum Bus", color: "#ff9fb7", position: at(1100, 200),
    controllers: { volume: 256, stereoWidth: 128 },
    to: "drumGlue",
  });
  song.addModule("plate", {
    type: "Reverb", name: "80s Plate", color: "#c7a8ff", position: at(1300, 380),
    controllers: { dry: 0, wet: 256, feedback: 150, damp: 96, stereoWidth: 256, freeze: "off", mode: "hq", allpassFilter: "improved", roomSize: 14, randomSeed: 79 },
    to: "masterBus",
  });
  song.addModule("plateSend", {
    type: "Amplifier", name: "Plate Send", color: "#b49aff", position: at(1100, 380),
    controllers: { volume: 72 },
    to: "plate",
  });

  const drumColor = "#ff5c8a";
  song.addModule("kick", { ...sampler(kits.kick, { color: drumColor, volume: 400, polyphony: 2, position: at(0, 0) }), to: ["drumBus", "bassDuck"] });
  song.addModule("snare", { ...sampler(kits.snare, { color: drumColor, volume: 380, polyphony: 4, position: at(0, 80) }), to: ["drumBus", "plateSend"] });
  song.addModule("clap", { ...sampler(kits.clap, { color: drumColor, volume: 400, panning: 120, polyphony: 4, position: at(0, 160) }), to: ["drumBus", "plateSend"] });
  song.addModule("hats", { ...sampler(kits.hats, { color: "#ffc2d4", volume: 300, panning: 172, polyphony: 4, position: at(0, 240) }), to: "drumBus" });
  song.addModule("perc", { ...sampler(kits.perc, { color: "#ffc2d4", volume: 310, panning: 74, polyphony: 6, position: at(0, 320) }), to: "drumBus" });
  song.addModule("toms", { ...sampler(kits.toms, { color: drumColor, volume: 170, panning: 120, polyphony: 4, position: at(0, 400) }), to: ["drumBus", "plateSend"] });
  song.addModule("cymbals", { ...sampler(kits.cymbals, { color: "#ffe08a", volume: 290, panning: 150, polyphony: 3, position: at(0, 480) }), to: "drumBus" });

  // --- Bass -----------------------------------------------------------------
  song.addModule("bassComp", {
    type: "Compressor", name: "Bass Leveler", color: "#5dd39e", position: at(1100, 560),
    controllers: { volume: 256, threshold: 140, slope: 50, attack: 2, release: 90, mode: "peak", sideChainInput: 0 },
    to: "masterBus",
  });
  song.addModule("bassDuck", {
    type: "Compressor", name: "Kick Duck", color: "#48b884", position: at(800, 560),
    controllers: { volume: 256, threshold: 110, slope: 30, attack: 1, release: 60, mode: "peakZeroLatency", sideChainInput: 1 },
    to: "bassComp",
  });
  song.addModule("bass", { ...patches.fmBass(), position: at(0, 580), to: "bassDuck" });

  // --- Music bus ------------------------------------------------------------
  song.addModule("hall", {
    type: "Reverb", name: "Midnight Hall", color: "#8fa8ff", position: at(1300, 860),
    controllers: { dry: 256, wet: 46, feedback: 206, damp: 150, stereoWidth: 256, freeze: "off", mode: "hq", allpassFilter: "improved", roomSize: 42, randomSeed: 116 },
    to: "masterBus",
  });
  song.addModule("musicBus", {
    type: "Amplifier", name: "Music Bus", color: "#a9c5ff", position: at(1100, 860),
    controllers: { volume: 256, stereoWidth: 168 },
    to: "hall",
  });
  song.addModule("epChorus", {
    type: "Flanger", name: "Tine Chorus", color: "#7fc8ff", position: at(700, 700),
    controllers: { dry: 256, wet: 150, feedback: 30, delay: 260, response: 2, lfoFreq: 70, lfoAmp: 70, lfoWaveform: "sin", setLfoPhase: 0, lfoFreqUnit: "hz005" },
    to: "tineWidth",
  });
  song.addModule("tineWidth", {
    type: "Delay", name: "Tine Width", color: "#9fd6ff", position: at(900, 700),
    controllers: { dry: 256, wet: 130, delayL: 1, delayR: 11, volumeL: 0, volumeR: 256, channels: "stereo", delayUnit: "ms", delayMultiplier: 1, feedback: 0 },
    to: "musicBus",
  });
  song.addModule("epFilter", {
    type: "Filter", name: "Dream Filter", color: "#5fb0ef", position: at(450, 700),
    controllers: { volume: 256, freq: 14000, resonance: 180, type: "lp", response: 12, mode: "hq", mix: 256, rolloff: "db12" },
    to: "epHighPass",
  });
  song.addModule("epHighPass", {
    type: "Filter", name: "Tine High-pass", color: "#4f9fdf", position: at(575, 760),
    controllers: { volume: 256, freq: 110, resonance: 0, type: "hp", response: 8, mode: "hq", mix: 256, rolloff: "db12" },
    to: "epChorus",
  });
  song.addModule("ep", { ...patches.tinePiano(), position: at(0, 700), to: "epFilter" });
  song.addModule("stringChorus", {
    type: "Flanger", name: "String Ensemble", color: "#ff8fb1", position: at(700, 800),
    controllers: { dry: 256, wet: 170, feedback: 20, delay: 420, response: 2, lfoFreq: 40, lfoAmp: 110, lfoWaveform: "sin", setLfoPhase: 64, lfoFreqUnit: "hz005" },
    to: "stringWidth",
  });
  song.addModule("stringWidth", {
    type: "Delay", name: "String Width", color: "#ff9fc0", position: at(900, 800),
    controllers: { dry: 256, wet: 150, delayL: 13, delayR: 1, volumeL: 256, volumeR: 0, channels: "stereo", delayUnit: "ms", delayMultiplier: 1, feedback: 0 },
    to: "musicBus",
  });
  song.addModule("strings", { ...patches.stringPad(), position: at(0, 800), to: "stringChorus" });
  song.addModule("brass", { ...patches.synthBrass(), controllers: { ...patches.synthBrass().controllers, panning: 188 }, position: at(0, 880), to: "musicBus" });
  song.addModule("guitarBus", {
    type: "Amplifier", name: "Cutting Bus", color: "#d0a46a", position: at(700, 960),
    controllers: { volume: 360, balance: 52, stereoWidth: 128 },
    to: "musicBus",
  });
  song.addModule("cutMute", { ...sampler(kits.cutMute, { color: "#d0a46a", volume: 300, polyphony: 8, position: at(0, 960) }), to: "guitarBus" });
  song.addModule("cutOpen", { ...sampler(kits.cutOpen, { color: "#e3b980", volume: 300, polyphony: 8, position: at(0, 1040) }), to: "guitarBus" });
  song.addModule("leadEcho", {
    type: "Delay", name: "Dotted Echo", color: "#ff5ea8", position: at(700, 1120),
    controllers: { dry: 256, wet: 64, delayL: 3, delayR: 6, volumeL: 256, volumeR: 220, channels: "stereo", inverse: "off", delayUnit: "line", delayMultiplier: 1, feedback: 9000, negativeFeedback: "off", allpassFilter: "off" },
    to: "musicBus",
  });
  song.addModule("lead", { ...patches.leadSynth(), position: at(0, 1120), to: "leadEcho" });
  song.addModule("leadHarmony", {
    ...patches.leadSynth(),
    name: "Twin Lead",
    controllers: { ...patches.leadSynth().controllers, volume: 112, panning: 104, filterFreq: 7600 },
    position: at(0, 1160),
    to: "leadEcho",
  });
  song.addModule("whistle", { ...patches.softLead(), position: at(0, 1200), to: "leadEcho" });
  song.addModule("choirChorus", {
    type: "Flanger", name: "Choir Ensemble", color: "#f5c2ff", position: at(900, 1360),
    controllers: { dry: 256, wet: 180, feedback: 10, delay: 520, response: 2, lfoFreq: 30, lfoAmp: 120, lfoWaveform: "sin", setLfoPhase: 96, lfoFreqUnit: "hz005" },
    to: "musicBus",
  });
  song.addModule("choirFormant", {
    type: "Vocal filter", name: "Aah Formant", color: "#eab0ff", position: at(700, 1360),
    controllers: { volume: 320, formantWidth: 196, intensity: 168, formants: 5, vowelPosition: 0, voiceType: "soprano", channels: "stereo", vowel1: "a", vowel2: "o", vowel3: "u", vowel4: "e", vowel5: "i" },
    to: "choirChorus",
  });
  song.addModule("choir", { ...patches.choirSource(), position: at(0, 1360), to: "choirFormant" });
  song.addModule("bell", { ...patches.glassBell(), controllers: { ...patches.glassBell().controllers, panning: 182 }, position: at(0, 1280), to: "musicBus" });

  // --- City ambience --------------------------------------------------------
  song.addModule("cityVerb", {
    type: "Reverb", name: "Platform Air", color: "#c9c2ff", position: at(1300, 1400),
    controllers: { dry: 220, wet: 90, feedback: 220, damp: 180, stereoWidth: 256, freeze: "off", mode: "hq", allpassFilter: "improved", roomSize: 70, randomSeed: 3 },
    to: "masterBus",
  });
  song.addModule("ambience", { ...sampler(kits.ambience, { color: "#b9b2ff", volume: 150, polyphony: 4, position: at(0, 1400) }), to: "cityVerb" });

  // --- Layout: one signal-flow band per instrument group --------------------
  const LAYOUT = {
    kick: [0, 0], snare: [0, 80], clap: [0, 160], hats: [0, 240], perc: [0, 320], toms: [0, 400], cymbals: [0, 480],
    drumBus: [300, 200], drumGlue: [450, 200], plateSend: [300, 380], plate: [450, 380],
    bass: [0, 640], bassDuck: [300, 640], bassComp: [450, 640],
    ep: [0, 760], epFilter: [150, 760], epHighPass: [300, 760], epChorus: [450, 760], tineWidth: [600, 760],
    strings: [0, 860], stringChorus: [300, 860], stringWidth: [450, 860],
    brass: [0, 940],
    cutMute: [0, 1020], cutOpen: [0, 1100], guitarBus: [300, 1060],
    lead: [0, 1200], leadHarmony: [0, 1280], whistle: [0, 1360], leadEcho: [300, 1280],
    bell: [0, 1460],
    choir: [0, 1560], choirFormant: [150, 1560], choirChorus: [300, 1560],
    ambience: [0, 1680], cityVerb: [300, 1680],
    musicBus: [800, 1100], hall: [950, 1100],
    masterBus: [1100, 700], masterEq: [1250, 700], busGlue: [1400, 700], limiter: [1550, 700], output: [1700, 700],
  };
  for (const [key, [x, y]] of Object.entries(LAYOUT)) song.place(key, x, y);

  // --- Score ----------------------------------------------------------------
  const timeline = new Timeline(song, { sections: SECTIONS, lanes: LANES });
  const M = Object.fromEntries(
    ["kick", "snare", "clap", "hats", "perc", "toms", "cymbals", "ambience", "bass", "ep", "epFilter", "strings", "brass", "cutMute", "cutOpen", "lead", "leadHarmony", "whistle", "bell", "choir", "choirFormant"].map((key) => [key, key]),
  );
  arrange(timeline, M);

  return song.build({
    flags: { supertracks: true },
    selectedModule: song.moduleIndex("lead"),
    pruneEmptyPatterns: true,
    comments: [
      "Midnight Loop Line: neo city pop instrumental, Eb major -> E major, 116 BPM, about two minutes.",
      "Built by recipes/research/79/midnight-loop-line.mjs; drums, guitar and city ambience are synthesized offline and embedded in Samplers.",
    ],
  });
}

/** @satisfies {import("../../../tools/sunvox-music-recipe.d.ts").SunVoxMusicRecipe} */
export const recipe = {
  schemaVersion: 1,
  issue: 79,
  tags: ["research:generated-music", "style:city-pop", "style:japanese-fusion"],
  outputs: {
    midnightLoopLine: {
      file: PROJECT_PATH,
      title: "Midnight Loop Line",
      summaryFile: SUMMARY_PATH,
      params: {
        bpm: BPM,
        form: SECTIONS.map((section) => `${section.name} ${section.bars}`).join(" / "),
        key: "Eb major, final chorus in E major",
      },
      verification: { durationSeconds: 125, requireAudio: true, maxClippedSamples: 0, maxLeadingSilenceSeconds: 0.1 },
      buildDocument: buildMidnightLoopLineDocument,
    },
  },
};

export default recipe;

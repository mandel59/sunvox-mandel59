#!/usr/bin/env node
// @ts-check
// "Pixel Sprint" (#104): a ~90-second original chiptune action-stage theme in
// E minor at 168 BPM with a lift to F# minor for the coda, synthesized from
// native SunVox modules only. A console-style voice budget: a pulse lead with
// duty-cycle changes and delayed vibrato, a second pulse for harmony and
// tick-rate arpeggios (pattern effect 0x08), a triangle bass and noise /
// pitch-drop drums, with a short echo and a small room. The score lives in
// generated/recipes/music-lib/pixel-sprint/. Run with:
//   npm run sunvox:music-recipe -- generated/recipes/music/pixel-sprint.mjs

import { SongBuilder, Timeline } from "../../../tools/sunvox-song-builder.mjs";
import { BPM, SECTIONS, TOTAL_BARS, arrange } from "../music-lib/pixel-sprint/score.mjs";

const PROJECT_PATH = "generated/music/pixel-sprint.sunvox";
const SUMMARY_PATH = "var/music-recipe/pixel-sprint.summary.json";

const LANES = [
  { key: "lead", name: "Pulse 1", y: 0, tracks: 1, color: { foreground: "#ffe0f0", background: "#3d1028" } },
  { key: "harm", name: "Pulse 2", y: 32, tracks: 1, color: { foreground: "#e0f0ff", background: "#102a3d" } },
  { key: "bass", name: "Triangle", y: 64, tracks: 1, color: { foreground: "#e0ffe4", background: "#103d18" } },
  { key: "drums", name: "Noise", y: 96, tracks: 4, color: { foreground: "#fff6d0", background: "#3d3410" } },
  { key: "mod", name: "Duty", y: 128, tracks: 1, color: { foreground: "#f0f0f0", background: "#2a2a2a" } },
];

/** Chip-style Analog generator voice. */
const chip = (overrides) => ({
  type: "Analog generator",
  controllers: {
    volume: 80, waveform: "square", panning: 128, attack: 0, release: 30, sustain: "on", expEnvelope: "on",
    dutyCycle: 512, osc2Volume: 0, filter: "lp12db", filterFreq: 14000, filterResonance: 0, polyphony: 1, mode: "hqMono",
    ...overrides,
  },
});

export function buildPixelSprintDocument() {
  const song = new SongBuilder({ name: "Pixel Sprint", bpm: BPM, speed: 6, globalVolume: 256 });

  // --- Master ----------------------------------------------------------------
  song.addModule("limiter", {
    type: "Compressor", name: "Sprint Limiter",
    controllers: { volume: 256, threshold: 228, slope: 100, attack: 0, release: 60, mode: "peakZeroLatency", sideChainInput: 0 },
    to: "output",
  });
  song.addModule("masterBus", { type: "Amplifier", name: "Master Bus", controllers: { volume: 100, stereoWidth: 128 }, to: "limiter" });
  song.addModule("room", {
    type: "Reverb", name: "Small Room",
    controllers: { dry: 0, wet: 256, feedback: 150, damp: 180, stereoWidth: 220, mode: "hq", allpassFilter: "improved", roomSize: 12, randomSeed: 104 },
    to: "masterBus",
  });
  song.addModule("roomSend", { type: "Amplifier", name: "Room Send", controllers: { volume: 40 }, to: "room" });

  // --- Pulse 1 lead with a short stereo echo ---------------------------------
  song.addModule("leadEcho", {
    type: "Delay", name: "Lead Echo",
    controllers: { dry: 256, wet: 56, delayL: 3, delayR: 4, volumeL: 200, volumeR: 220, channels: "stereo", delayUnit: "line", delayMultiplier: 1, feedback: 5000 },
    to: ["masterBus", "roomSend"],
  });
  song.addModule("lead", { ...chip({ volume: 88, dutyCycle: 256, release: 40, panning: 136 }), name: "Pulse 1", to: "leadEcho" });

  // --- Pulse 2, triangle, noise ----------------------------------------------
  song.addModule("pulse2", { ...chip({ volume: 62, dutyCycle: 512, release: 30, panning: 112 }), name: "Pulse 2", to: ["masterBus", "roomSend"] });
  song.addModule("bass", { ...chip({ volume: 119, waveform: "triangle", release: 24 }), name: "Triangle", to: "masterBus" });

  song.addModule("drumBus", { type: "Amplifier", name: "Noise Bus", controllers: { volume: 256 }, to: ["masterBus", "roomSend"] });
  song.addModule("kick", {
    type: "Kicker", name: "Drop Kick",
    controllers: { volume: 256, waveform: "triangle", attack: 0, release: 24, boost: 60, acceleration: 160, polyphony: 1, noClick: "on" },
    to: "drumBus",
  });
  song.addModule("snareLevel", { type: "Amplifier", name: "Snare Level", controllers: { volume: 400 }, to: "drumBus" });
  song.addModule("snareVcf", {
    type: "Filter", name: "Snare Tone", controllers: { freq: 5200, resonance: 100, type: "lp", rolloff: "db12", mode: "hq" },
    to: "snareLevel",
  });
  song.addModule("snare", { ...chip({ volume: 256, waveform: "whiteNoise", release: 140, sustain: "off", polyphony: 2, mode: "hq" }), name: "Noise Snare", to: "snareVcf" });
  song.addModule("hatVcf", {
    type: "Filter", name: "Hat HPF", controllers: { freq: 7000, resonance: 60, type: "hp", rolloff: "db12", mode: "hq" },
    to: "drumBus",
  });
  song.addModule("hat", { ...chip({ volume: 256, waveform: "whiteNoise", release: 110, sustain: "off", polyphony: 2, mode: "hq" }), name: "Noise Hat", to: "hatVcf" });
  song.addModule("crash", { ...chip({ volume: 70, waveform: "whiteNoise", release: 214, sustain: "off", polyphony: 2, mode: "hq" }), name: "Noise Crash", to: "hatVcf" });

  // --- Layout ----------------------------------------------------------------
  const LAYOUT = {
    lead: [0, 0], leadEcho: [150, 0], pulse2: [0, 90], bass: [0, 180],
    kick: [0, 270], snare: [0, 340], snareVcf: [150, 340], snareLevel: [300, 340], hat: [0, 410], crash: [0, 480], hatVcf: [150, 440], drumBus: [450, 370],
    roomSend: [450, 200], room: [600, 200], masterBus: [600, 60], limiter: [750, 60], output: [900, 60],
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
      `Pixel Sprint: chiptune action theme in E minor (F# minor coda), ${BPM} BPM, ${TOTAL_BARS} bars.`,
      "Built by generated/recipes/music/pixel-sprint.mjs from native SunVox modules only.",
    ],
  });
}

/** @satisfies {import("../../../tools/sunvox-music-recipe.d.ts").SunVoxMusicRecipe} */
export const recipe = {
  schemaVersion: 1,
  issue: 104,
  tags: ["research:generated-music", "style:chiptune"],
  outputs: {
    pixelSprint: {
      file: PROJECT_PATH,
      title: "Pixel Sprint",
      summaryFile: SUMMARY_PATH,
      params: { bpm: BPM, bars: TOTAL_BARS, key: "E minor → F# minor", form: SECTIONS.map((s) => `${s.name} ${s.bars}`).join(" / ") },
      verification: { durationSeconds: 96, requireAudio: true, maxClippedSamples: 0, maxLeadingSilenceSeconds: 0.1 },
      buildDocument: buildPixelSprintDocument,
    },
  },
};

export default recipe;

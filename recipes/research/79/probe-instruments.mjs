#!/usr/bin/env node
// @ts-check
// Audition probe for #79 patches: renders each instrument alone through a
// short phrase so timbre can be reviewed with tools/audio-review.mjs.
// Usage: node recipes/research/79/probe-instruments.mjs [name ...]

import { mkdir, writeFile } from "node:fs/promises";

import { buildContainer } from "../../../tools/sunvox-codec.mjs";
import { renderProjectAudio } from "../../../tools/sunvox-render-audio.mjs";
import { buildSamplerModules } from "../../../tools/sunvox-sampler-embed.mjs";
import { toWav16 } from "../../../tools/sample-synth.mjs";
import { writeWavFile } from "../../../tools/wav-io.mjs";
import { applySunVoxLibMusicDefaults } from "../../../tools/sunvox-music-recipe.mjs";
import { SongBuilder, noteNumber } from "../../../tools/sunvox-song-builder.mjs";
import * as patches from "../../../generated/recipes/music-lib/midnight-loop-line/instruments.mjs";

const OUT_DIR = "var/79/probe";

const AB_MAJ7 = ["G3", "C4", "Eb4", "Bb4"];
const BB7 = ["Ab3", "D4", "F4", "C5"];
const GM7 = ["F3", "Bb3", "D4", "A4"].map((n) => (n === "A4" ? "G4" : n));
const CM7 = ["Bb3", "D4", "Eb4", "G4"];

const PHRASE = ["Eb5", "F5", "G5", "Bb5", "C6", "Bb5", "G5", "F5"];

function chordProbe(song, module, { gate = 14, velocity = 96 } = {}) {
  const pattern = song.pattern({ name: "probe", x: 0, y: 0, lines: 64, tracks: 6 });
  [AB_MAJ7, BB7, GM7, CM7].forEach((chord, bar) => {
    chord.forEach((note, track) =>
      pattern.note({ line: bar * 16, track, note, module, velocity: velocity + (track === 3 ? 8 : 0), gate }),
    );
  });
}

function stabProbe(song, module) {
  const pattern = song.pattern({ name: "probe", x: 0, y: 0, lines: 64, tracks: 6 });
  [AB_MAJ7, BB7, GM7, CM7].forEach((chord, bar) => {
    for (const [offset, gate] of [[0, 2], [6, 1], [10, 3]]) {
      chord.forEach((note, track) =>
        pattern.note({ line: bar * 16 + offset, track, note: noteNumber(note) + 12, module, velocity: 110, gate }),
      );
    }
  });
}

function bassProbe(song, module) {
  const pattern = song.pattern({ name: "probe", x: 0, y: 0, lines: 64, tracks: 2 });
  ["Ab1", "Bb1", "G1", "C2"].forEach((root, bar) => {
    const r = noteNumber(root);
    const steps = [[0, r, 3, 120], [3, r, 1, 80], [4, r + 12, 1, 112], [6, r, 2, 100], [10, r, 1, 96], [11, r + 12, 1, 116], [12, r + 7, 2, 100], [14, r + 10, 2, 96]];
    for (const [offset, note, gate, velocity] of steps) {
      pattern.note({ line: bar * 16 + offset, track: offset % 2, note, module, velocity, gate });
    }
  });
}

function melodyProbe(song, module) {
  const pattern = song.pattern({ name: "probe", x: 0, y: 0, lines: 64, tracks: 1 });
  PHRASE.forEach((note, index) => {
    pattern.note({ line: index * 4, track: 0, note, module, velocity: 108, gate: 4 });
  });
  pattern.note({ line: 32, track: 0, note: "G5", module, velocity: 108, effect: "vibrato", parameter: { speed: 5, amplitude: 24 } });
  pattern.note({ line: 40, track: 0, note: "Bb5", module, velocity: 100, effect: "tonePortamento", parameter: { speed: 80 } });
  pattern.off({ line: 56, track: 0, module });
}

const PROBES = {
  tines: { patch: patches.tinePiano, play: (song, key) => chordProbe(song, key, { velocity: 92 }) },
  tinesHard: { patch: patches.tinePiano, play: (song, key) => chordProbe(song, key, { velocity: 124 }) },
  bass: { patch: patches.fmBass, play: bassProbe },
  brass: { patch: patches.synthBrass, play: stabProbe },
  strings: { patch: patches.stringPad, play: (song, key) => chordProbe(song, key, { gate: 16, velocity: 90 }) },
  lead: { patch: patches.leadSynth, play: melodyProbe },
  whistle: { patch: patches.softLead, play: melodyProbe },
  bell: { patch: patches.glassBell, play: melodyProbe },
};

async function guitarModule() {
  const [module] = await buildSamplerModules([
    {
      name: "KS Guitar",
      samples: [
        { wav: toWav16(patches.karplusGuitar({ mute: true })) },
        { wav: toWav16(patches.karplusGuitar({})) },
      ],
      noteMap: [["C0", "B9", 0]],
    },
  ]);
  return module;
}

async function renderProbe(name, moduleDefinition, play) {
  const song = new SongBuilder({ name: `probe ${name}`, bpm: 116 });
  song.addModule("inst", { ...moduleDefinition, position: { x: 200, y: 200, z: 0 }, to: "output" });
  play(song, "inst");
  const document = applySunVoxLibMusicDefaults(song.build());
  const bytes = buildContainer(document);
  const audio = await renderProjectAudio(bytes, { tailSeconds: 2 });
  await writeWavFile(`${OUT_DIR}/${name}.wav`, audio.samples, { sampleRate: audio.sampleRate, channels: audio.channels });
  await writeFile(`${OUT_DIR}/${name}.sunvox`, bytes);
  let peak = 0;
  for (const value of audio.samples) peak = Math.max(peak, Math.abs(value));
  console.log(`${name}: ${audio.durationSeconds.toFixed(2)}s peak=${(20 * Math.log10(peak || 1e-9)).toFixed(1)}dBFS`);
}

await mkdir(OUT_DIR, { recursive: true });
const selected = process.argv.slice(2);
for (const [name, probe] of Object.entries(PROBES)) {
  if (selected.length && !selected.includes(name)) continue;
  await renderProbe(name, probe.patch(), probe.play);
}
if (!selected.length || selected.includes("guitar")) {
  const module = await guitarModule();
  await renderProbe("guitar", module, (song, key) => {
    const pattern = song.pattern({ name: "probe", x: 0, y: 0, lines: 64, tracks: 4 });
    [["G4", "C5", "Eb5"], ["Ab4", "D5", "F5"], ["F4", "Bb4", "D5"], ["G4", "Bb4", "Eb5"]].forEach((chord, bar) => {
      for (let step = 0; step < 16; step += 1) {
        if (![0, 2, 3, 6, 8, 10, 11, 14].includes(step)) continue;
        chord.forEach((note, track) =>
          pattern.note({ line: bar * 16 + step, track, note, module: key, velocity: step % 4 === 0 ? 110 : 80, delay: track * 2 }),
        );
      }
    });
  });
}

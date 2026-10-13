#!/usr/bin/env node
// @ts-check
// Probe (#90): how LFO (generator mode) -> Sound2Ctl -> Filter.freq and a
// MultiCtl fan-out behave in SunVox Lib. Reads the target controllers while
// playing so the recipe can pick ranges from measured values.

import { buildContainer } from "../../../tools/sunvox-codec.mjs";
import { DEFAULT_SAMPLE_RATE, loadProjectFromBuffer, withSunVoxSlot, renderSlotAudio } from "../../../tools/sunvox-node.mjs";
import { SongBuilder } from "../../../tools/sunvox-song-builder.mjs";

const variant = process.argv[2] ?? "lfo";
const song = new SongBuilder({ name: "probe", bpm: 128, speed: 6 });
song.addModule("filter", { type: "Filter", name: "F", controllers: { freq: 14000 }, to: "output" });
song.addModule("gen", { type: "Analog generator", name: "G", controllers: { waveform: "saw" }, to: "filter" });
if (variant === "lfo" || variant === "random") {
  song.addModule("s2c", {
    type: "Sound2Ctl", name: "S2C",
    controllers: { sampleRate: 200, absolute: process.argv[3] ?? "off", gain: 256, smooth: 0, outMin: 2000, outMax: 30000, outController: 2 },
    to: "filter",
  });
  song.addModule("lfo", {
    type: "LFO", name: "L",
    controllers: { generator: "on", frequencyUnit: "line", freq: 16, waveform: variant === "random" ? "random" : "sin", amplitude: 256, volume: 256 },
    to: "s2c",
  });
}
if (variant === "adsr") {
  song.addModule("s2c", {
    type: "Sound2Ctl", name: "S2C",
    controllers: { sampleRate: 1000, absolute: "on", gain: 256, smooth: 0, outMin: 0, outMax: 32768, outController: 2 },
    to: "filter",
  });
  song.addModule("env", {
    type: "ADSR", name: "E",
    controllers: { attack: Number(process.argv[3] ?? 0), decay: Number(process.argv[4] ?? 100), sustainLevel: 0, release: 100, sustain: "off", decayCurve: "exp1" },
    to: "s2c",
  });
}
if (variant === "multi") {
  song.addModule("macro", {
    type: "MultiCtl", name: "M", controllers: { value: 16384 },
    dataChunks: [{ index: 0, name: "outputSlots", slots: [{ index: 0, controller: 2, min: 4000, max: 20000 }] }],
    to: "filter",
  });
}
const pattern = song.pattern({ name: "p", x: 0, y: 0, lines: 64, tracks: 2 });

pattern.note({ line: 0, track: 0, note: "C4", module: "gen" });
if (variant === "adsr") for (let line = 0; line < 64; line += 16) pattern.note({ line, track: 1, note: "C4", module: "env" });
if (variant === "multi") {
  for (let line = 0; line < 64; line += 8) pattern.ctl({ line, track: 1, module: "macro", controller: "value", value: (line / 64) * 32768 });
}
const bytes = buildContainer(song.build({}));

await withSunVoxSlot({}, async ({ module, slot }) => {
  loadProjectFromBuffer(module, bytes, { slot });
  module._sv_play_from_beginning(slot);
  const filterIndex = song.moduleIndex("filter");
  const lineSeconds = 60 / 128 / 4;
  const rows = [];
  for (let line = 0; line < 40; line += 1) {
    renderSlotAudio(module, { slot, sampleRate: DEFAULT_SAMPLE_RATE, channels: 2, durationSeconds: lineSeconds / 2, blockFrames: 128 });
    rows.push(`${line}:${module._sv_get_module_ctl_value(slot, filterIndex, 1, 0)}`);
  }
  console.log(variant, rows.join(" "));
});

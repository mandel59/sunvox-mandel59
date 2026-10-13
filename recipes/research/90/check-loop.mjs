#!/usr/bin/env node
// @ts-check
// Loop check (#90): compares pass 1 and pass 2 of a `--loop` render bar by
// bar. The loop offset is found by cross-correlation near the nominal length,
// since SunVox rounds line lengths to whole ticks.
import { readWavFile } from "../../../tools/wav-io.mjs";

const [path = "var/90/voltage-garden.loop.wav", bpm = "128", bars = "32"] = process.argv.slice(2);
const { samples: s, channels: ch, sampleRate: sr } = await readWavFile(path);
const barFrames = (sr * 60 * 4) / Number(bpm);
const nominal = Math.round(Number(bars) * barFrames);
const corr = (offset, start, length) => {
  let sum = 0;
  for (let i = start; i < start + length; i += 1) sum += s[i * ch] * s[(i + offset) * ch];
  return sum;
};
let loop = nominal;
let best = -Infinity;
for (let offset = nominal - 400; offset <= nominal + 400; offset += 1) {
  const value = corr(offset, Math.round(16 * barFrames), 8192);
  if (value > best) [best, loop] = [value, offset];
}
console.log(`loop offset ${loop} frames (${(loop / sr).toFixed(4)} s, nominal ${nominal})`);
const rows = [];
for (let bar = 0; bar < Number(bars); bar += 1) {
  let energy = 0;
  let diff = 0;
  for (let i = Math.round(bar * barFrames); i < Math.round((bar + 1) * barFrames); i += 1) {
    for (let c = 0; c < ch; c += 1) {
      const x = s[i * ch + c];
      const y = s[(i + loop) * ch + c];
      energy += x * x;
      diff += (x - y) * (x - y);
    }
  }
  rows.push(`${bar}:${(10 * Math.log10(diff / energy)).toFixed(0)}`);
}
console.log(`pass2 - pass1 difference per bar (dB re pass 1): ${rows.join(" ")}`);
const rmsDb = (a, b) => {
  let e = 0;
  for (let i = a; i < b; i += 1) e += s[i * ch] ** 2;
  return (10 * Math.log10(e / (b - a))).toFixed(1);
};
const w = Math.round(sr * 0.25);
console.log(`250 ms RMS around the loop point: ${rmsDb(loop - 2 * w, loop - w)} ${rmsDb(loop - w, loop)} | ${rmsDb(loop, loop + w)} ${rmsDb(loop + w, loop + 2 * w)} dB`);
console.log(`same windows at song start (pass 1): ${rmsDb(0, w)} ${rmsDb(w, 2 * w)} dB`);

#!/usr/bin/env node
// @ts-check
// Check (#90): plays var/90/voltage-garden.sunvox and prints the macro
// destinations' controller values at a few bars, to confirm MultiCtl output
// slot order matches the intended destinations.
import { readFile } from "node:fs/promises";
import { parseContainer } from "../../../tools/sunvox-codec.mjs";
import { DEFAULT_SAMPLE_RATE, loadProjectFromBuffer, renderSlotAudio, withSunVoxSlot } from "../../../tools/sunvox-node.mjs";

const path = process.argv[2] ?? "var/90/voltage-garden.sunvox";
const bytes = await readFile(path);
const document = parseContainer(bytes);
const probes = [
  ["Env -> Bass Cutoff", "outMax", 7],
  ["Seq VCF", "resonance", 2],
  ["Dotted Echo", "feedback", 10],
  ["Seq Drive", "power", 2],
  ["Pad VCF", "freq", 1],
];
const indices = probes.map(([name]) => document.modules.findIndex((module) => module?.name === name));
await withSunVoxSlot({}, async ({ module, slot }) => {
  loadProjectFromBuffer(module, bytes, { slot });
  module._sv_play_from_beginning(slot);
  const barSeconds = (60 / 128) * 4;
  let bar = 0;
  for (const target of [1, 8, 16, 23, 25, 31]) {
    renderSlotAudio(module, { slot, sampleRate: DEFAULT_SAMPLE_RATE, channels: 2, durationSeconds: (target - bar) * barSeconds, blockFrames: 128 });
    bar = target;
    const values = probes.map(([name, ctl, number], i) => `${name}.${ctl}=${module._sv_get_module_ctl_value(slot, indices[i], number, 2)}`);
    console.log(`bar ${bar}: ${values.join("  ")}`);
  }
});

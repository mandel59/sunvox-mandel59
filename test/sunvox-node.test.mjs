import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  DEFAULT_CHANNELS,
  DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
  DEFAULT_SAMPLE_RATE,
  DEFAULT_SLOT,
  DEFAULT_SUNVOX_JS_PATH,
  assertSunVoxOk,
  createNoteProbePattern,
  lineFramesFromTimeMap,
  loadSynthModuleFromBuffer,
  renderSlotAudio,
  sunVoxNoteValue,
  withSunVoxSlot,
} from "../tools/sunvox-node.mjs";

test("converts MIDI notes to SunVox note values", () => {
  assert.equal(sunVoxNoteValue(0), 1);
  assert.equal(sunVoxNoteValue(48), 49);
  assert.equal(sunVoxNoteValue(127), 127);
  assert.equal(sunVoxNoteValue(200), 127);
});

test("derives line duration from a time map", () => {
  assert.equal(lineFramesFromTimeMap([0, 512, 1024]), 512);
  assert.equal(lineFramesFromTimeMap([100, 100, 100], 2048), 2048);
});

test(
  "renders a synth probe through a SunVox pattern",
  { skip: existsSync(DEFAULT_SUNVOX_JS_PATH) ? false : "SunVox Lib runtime is not installed" },
  async () => {
    const bytes = await readFile("generated/instruments/Scratch FMX Tines.sunsynth");
    const rendered = await withSunVoxSlot(
      {
        sampleRate: DEFAULT_SAMPLE_RATE,
        channels: DEFAULT_CHANNELS,
        flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
        slot: DEFAULT_SLOT,
      },
      async ({ module, slot, sampleRate, channels }) => {
        const moduleIndex = loadSynthModuleFromBuffer(module, bytes, { slot });
        assertSunVoxOk(module._sv_volume(slot, 256), "sv_volume");
        const pattern = createNoteProbePattern(module, {
          slot,
          moduleIndex,
          note: 60,
          velocity: 112,
          gateSeconds: 0.25,
          sampleRate,
        });
        assert.ok(pattern.noteOffFrame > pattern.noteOnFrame);
        assertSunVoxOk(module._sv_play_from_beginning(slot), "sv_play_from_beginning");
        return renderSlotAudio(module, {
          slot,
          sampleRate,
          channels,
          durationSeconds: 1,
        });
      },
    );

    const peak = rendered.samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
    assert.ok(peak > 0.01);
  },
);

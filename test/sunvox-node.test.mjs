import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { buildContainer, TEXT_FORMAT } from "../tools/sunvox-codec.mjs";
import {
  DEFAULT_CHANNELS,
  DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
  DEFAULT_SAMPLE_RATE,
  DEFAULT_SLOT,
  DEFAULT_SUNVOX_JS_PATH,
  assertSunVoxOk,
  createPattern,
  createNoteProbePattern,
  lineFramesFromTimeMap,
  loadProjectFromBuffer,
  loadSynthModuleFromBuffer,
  readCString,
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
  "creates a fresh SunVox pattern by default instead of cloning pattern zero",
  { skip: existsSync(DEFAULT_SUNVOX_JS_PATH) ? false : "SunVox Lib runtime is not installed" },
  async () => {
    await withSunVoxSlot(
      {
        sampleRate: DEFAULT_SAMPLE_RATE,
        channels: DEFAULT_CHANNELS,
        flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
        slot: DEFAULT_SLOT,
      },
      async ({ module, slot }) => {
        const first = createPattern(module, { slot, tracks: 4, lines: 32, name: "base" });
        const second = createPattern(module, { slot, tracks: 1, lines: 256, name: "probe" });

        assert.equal(second, first + 1);
        assert.equal(module._sv_get_pattern_tracks(slot, first), 4);
        assert.equal(module._sv_get_pattern_lines(slot, first), 32);
        assert.equal(module._sv_get_pattern_tracks(slot, second), 1);
        assert.equal(module._sv_get_pattern_lines(slot, second), 256);
      },
    );
  },
);

test(
  "loads a newly codec-built semantic pattern into SunVox Lib",
  { skip: existsSync(DEFAULT_SUNVOX_JS_PATH) ? false : "SunVox Lib runtime is not installed" },
  async () => {
    const bytes = buildContainer({
      format: TEXT_FORMAT,
      magic: "SVOX",
      headerTailHex: "00000000",
      project: { name: "semantic pattern probe", bpm: 125, speed: 6 },
      patterns: [
        {
          name: "Probe",
          position: { x: 0, y: 0 },
          tracks: 1,
          lines: 4,
          events: [{ line: 0, track: 0, note: "C4", velocity: 112 }],
        },
      ],
      modules: [
        {
          flags: {
            exists: true,
            output: true,
          },
          name: "Output",
          position: { x: 0, y: 0 },
        },
      ],
      trailingChunks: [],
    });

    await withSunVoxSlot(
      {
        sampleRate: DEFAULT_SAMPLE_RATE,
        channels: DEFAULT_CHANNELS,
        flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
        slot: DEFAULT_SLOT,
      },
      async ({ module, slot }) => {
        loadProjectFromBuffer(module, bytes, { slot });

        assert.equal(module._sv_get_pattern_tracks(slot, 0), 1);
        assert.equal(module._sv_get_pattern_lines(slot, 0), 4);

        const eventPointer = module._sv_get_pattern_data(slot, 0);
        assert.notEqual(eventPointer, 0);
        assert.equal(module.HEAPU8[eventPointer], 49);
        assert.equal(module.HEAPU8[eventPointer + 1], 112);
      },
    );
  },
);

test(
  "loads a newly codec-built semantic module into SunVox Lib",
  { skip: existsSync(DEFAULT_SUNVOX_JS_PATH) ? false : "SunVox Lib runtime is not installed" },
  async () => {
    const bytes = buildContainer({
      format: TEXT_FORMAT,
      magic: "SVOX",
      headerTailHex: "00000000",
      project: { name: "semantic module probe", bpm: 125, speed: 6 },
      patterns: [],
      modules: [
        {
          flags: {
            exists: true,
            output: true,
          },
          name: "Output",
          position: { x: 0, y: 0 },
        },
        {
          type: "Generator",
          name: "Tone",
          position: { x: 128, y: 0 },
        },
      ],
      trailingChunks: [],
    });

    await withSunVoxSlot(
      {
        sampleRate: DEFAULT_SAMPLE_RATE,
        channels: DEFAULT_CHANNELS,
        flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
        slot: DEFAULT_SLOT,
      },
      async ({ module, slot }) => {
        loadProjectFromBuffer(module, bytes, { slot });

        assert.equal(module._sv_get_number_of_modules(slot), 2);
        assert.equal(readCString(module, module._sv_get_module_type(slot, 1)), "Generator");
        assert.equal(readCString(module, module._sv_get_module_name(slot, 1)), "Tone");
        assert.equal(module._sv_get_module_flags(slot, 1) & 1, 1);
      },
    );
  },
);

test(
  "renders a direct sparse Amplifier patch without DC or stuck output (#37)",
  { skip: existsSync(DEFAULT_SUNVOX_JS_PATH) ? false : "SunVox Lib runtime is not installed" },
  async () => {
    const bytes = buildContainer({
      format: TEXT_FORMAT, magic: "SVOX", headerTailHex: "00000000",
      project: { name: "Sparse amplifier audio", bpm: 125, speed: 6 },
      patterns: [{
        name: "Probe", tracks: 1, lines: 16,
        events: [{ line: 0, track: 0, module: 1, note: "C4", velocity: 112 }],
      }],
      modules: [
        { name: "Output", flags: { exists: true, output: true }, inputs: [{ slot: 0, module: 2 }] },
        { name: "Tone", type: "Generator", controllers: { volume: 64, waveform: "sin" } },
        { name: "Amp", type: "Amplifier", controllers: { fineVolume: 32768 }, inputs: [{ slot: 0, module: 1 }] },
      ],
    });
    const rendered = await withSunVoxSlot(
      { sampleRate: DEFAULT_SAMPLE_RATE, channels: DEFAULT_CHANNELS, flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS },
      async ({ module, slot, sampleRate, channels }) => {
        loadProjectFromBuffer(module, bytes, { slot });
        assert.equal(module._sv_get_module_ctl_value(slot, 2, 0, 0), 256);
        assert.equal(module._sv_get_module_ctl_value(slot, 2, 2, 0), 128);
        assertSunVoxOk(module._sv_play_from_beginning(slot), "sv_play_from_beginning");
        return renderSlotAudio(module, { slot, sampleRate, channels, durationSeconds: 1 });
      },
    );
    const { sum, squareSum, peak } = rendered.samples.reduce((stats, sample) => ({
      sum: stats.sum + sample, squareSum: stats.squareSum + sample * sample,
      peak: Math.max(stats.peak, Math.abs(sample)),
    }), { sum: 0, squareSum: 0, peak: 0 });
    assert.ok(peak > 0.01 && peak < 1, `audible, unclipped peak: ${peak}`);
    assert.ok(Math.abs(sum / rendered.samples.length) < 0.005, "mean output stays near zero");
    assert.ok(Math.sqrt(squareSum / rendered.samples.length) < peak * 0.9, "output is not constant");
  },
);

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
        assert.deepEqual(pattern.events, [
          {
            line: 0,
            track: 0,
            note: 61,
            velocity: 112,
            module: moduleIndex + 1,
            controller: 0,
            value: 0,
            frame: pattern.noteOnFrame,
          },
          {
            line: pattern.noteOffLine,
            track: 0,
            note: 128,
            velocity: 0,
            module: moduleIndex + 1,
            controller: 0,
            value: 0,
            frame: pattern.noteOffFrame,
          },
        ]);
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

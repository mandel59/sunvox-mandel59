import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { parseContainer } from "../tools/sunvox-codec.mjs";
import {
  DEFAULT_CHANNELS,
  DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
  DEFAULT_SAMPLE_RATE,
  DEFAULT_SLOT,
  DEFAULT_SUNVOX_JS_PATH,
  assertSunVoxOk,
  loadSynthModuleFromBuffer,
  readCString,
  renderSlotAudio,
  sunVoxNoteValue,
  withSunVoxSlot,
} from "../tools/sunvox-node.mjs";

const synthPath = "generated/instruments/Karplus-Strong Pluck 4ch.sunsynth";
const notes = [60, 64, 67, 71];

function amplitudeAt(samples, frequency, sampleRate, channels) {
  const begin = Math.round(0.01 * sampleRate);
  const end = Math.round(0.13 * sampleRate);
  let real = 0;
  let imaginary = 0;
  for (let frame = begin; frame < end; frame += 1) {
    const sample = samples[frame * channels];
    const angle = (2 * Math.PI * frequency * (frame - begin)) / sampleRate;
    real += sample * Math.cos(angle);
    imaginary -= sample * Math.sin(angle);
  }
  return (2 * Math.hypot(real, imaginary)) / (end - begin);
}

test("four Karplus-Strong notes retain independent pitches", {
  skip: existsSync(DEFAULT_SUNVOX_JS_PATH) ? false : "SunVox Lib runtime is not installed",
}, async () => {
  const bytes = await readFile(synthPath);
  const document = parseContainer(bytes);
  const embedded = document.module.dataChunks.find((chunk) => chunk.name === "embeddedProject").container;
  assert.equal(embedded.modules.filter((module) => module.type === "Echo").length, 4);
  const allocator = embedded.modules.find((module) => module.name === "Voice allocator");
  assert.equal(allocator.dataChunks.find((chunk) => chunk.name === "options").options.outputSlotMode, "roundRobin");
  for (const name of ["Pluck level", "String decay", "String brightness"]) {
    const control = embedded.modules.find((module) => module.name === name);
    assert.equal(control.type, "MultiCtl");
    assert.equal(control.dataChunks.find((chunk) => chunk.name === "outputSlots").slots.length, 4);
  }

  const rendered = await withSunVoxSlot({
    sampleRate: DEFAULT_SAMPLE_RATE,
    channels: DEFAULT_CHANNELS,
    flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
    slot: DEFAULT_SLOT,
  }, async ({ module, slot, sampleRate, channels }) => {
    const moduleIndex = loadSynthModuleFromBuffer(module, bytes, { slot });
    assertSunVoxOk(module._sv_volume(slot, 256), "sv_volume");
    assertSunVoxOk(module._sv_play(slot), "sv_play");
    const eventTime = module._sv_get_ticks();
    assertSunVoxOk(module._sv_set_event_t(slot, 1, eventTime), "sv_set_event_t");
    for (const [track, note] of notes.entries()) {
      assertSunVoxOk(
        module._sv_send_event(slot, track, sunVoxNoteValue(note), 129, moduleIndex + 1, 0, 0),
        "sv_send_event",
      );
    }
    const audio = renderSlotAudio(module, { slot, sampleRate, channels, durationSeconds: 0.2 });
    assertSunVoxOk(module._sv_stop(slot), "sv_stop");
    return audio;
  });

  const levels = notes.map((note) => {
    const hz = 440 * 2 ** ((note - 69) / 12);
    return Math.max(...[-8, -4, 0, 4, 8].map((offset) =>
      amplitudeAt(rendered.samples, hz + offset, rendered.sampleRate, rendered.channels)));
  });
  const peak = rendered.samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
  assert.ok(levels.every((value) => value > 0.001), `Chord fundamental levels: ${levels.join(", ")}`);
  assert.ok(peak < 1, `Four-note peak: ${peak}`);
});

test("Karplus-Strong user controls keep the instrument audible", {
  skip: existsSync(DEFAULT_SUNVOX_JS_PATH) ? false : "SunVox Lib runtime is not installed",
}, async () => {
  const bytes = await readFile(synthPath);
  const settings = [
    [null, "Baseline", 0],
    [5, "Pluck level", 18432],
    [5, "Pluck level", 23040],
    [6, "String decay", 29440],
    [7, "String brightness", 20000],
  ];
  for (const [controller, name, value] of settings) {
    const peak = await withSunVoxSlot({
      sampleRate: DEFAULT_SAMPLE_RATE,
      channels: DEFAULT_CHANNELS,
      flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
      slot: DEFAULT_SLOT,
    }, async ({ module, slot, sampleRate, channels }) => {
      const moduleIndex = loadSynthModuleFromBuffer(module, bytes, { slot });
      if (controller !== null) assert.equal(readCString(module, module._sv_get_module_ctl_name(slot, moduleIndex, controller)), name);
      assertSunVoxOk(module._sv_volume(slot, 256), "sv_volume");
      assertSunVoxOk(module._sv_play(slot), "sv_play");
      const eventTime = module._sv_get_ticks();
      assertSunVoxOk(module._sv_set_event_t(slot, 1, eventTime), "sv_set_event_t");
      if (controller !== null) assertSunVoxOk(
        module._sv_set_module_ctl_value(slot, moduleIndex, controller, value, 0),
        "sv_set_module_ctl_value",
      );
      const noteTime = eventTime + Math.round(0.05 * module._sv_get_ticks_per_second());
      assertSunVoxOk(module._sv_set_event_t(slot, 1, noteTime), "sv_set_event_t note");
      assertSunVoxOk(
        module._sv_send_event(slot, 1, sunVoxNoteValue(60), 96, moduleIndex + 1, 0, 0),
        "sv_send_event",
      );
      const audio = renderSlotAudio(module, { slot, sampleRate, channels, durationSeconds: 0.25,
        outTime: (frame) => eventTime + Math.floor(frame * module._sv_get_ticks_per_second() / sampleRate) });
      if (controller !== null) {
        assert.equal(module._sv_get_module_ctl_value(slot, moduleIndex, controller, 0), value);
      }
      assertSunVoxOk(module._sv_stop(slot), "sv_stop");
      return audio.samples.reduce((max, sample) => Math.max(max, Math.abs(sample)), 0);
    });
    assert.ok(peak > 0.05 && peak < 1, `${name}: peak ${peak}`);
  }
});

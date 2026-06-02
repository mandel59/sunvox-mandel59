import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { normalizeEventVelocity, summarizeAudio } from "../tools/sunvox-render-debug.mjs";
import { SunSynthLab } from "../tools/sunsynth-lab.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function assertRelativeClose(actual, expected, tolerance = 0.02) {
  const scale = Math.max(Math.abs(actual), Math.abs(expected), Number.EPSILON);
  assert.ok(
    Math.abs(actual - expected) / scale <= tolerance,
    `Expected ${actual} to be within ${tolerance * 100}% of ${expected}`,
  );
}

test("normalizes direct event velocity", () => {
  assert.equal(normalizeEventVelocity(1), 1);
  assert.equal(normalizeEventVelocity(65), 65);
  assert.equal(normalizeEventVelocity(112), 112);
  assert.equal(normalizeEventVelocity(128), 128);
  assert.equal(normalizeEventVelocity(129), 129);
  assert.equal(normalizeEventVelocity(130), 129);
});

test("summarizes rendered audio level and leading silence", () => {
  const samples = new Float32Array([0, 0, 0, 0, 0.25, -0.25, 0.5, -0.5, 0, 0]);
  const stats = summarizeAudio(samples, 2);

  assert.equal(stats.peak, 0.5);
  assert.equal(stats.rms, 0.25);
  assert.equal(stats.nonZeroSamples, 4);
  assert.equal(stats.nonZeroFrames, 2);
  assert.equal(stats.firstNonZeroFrame, 2);
  assert.equal(stats.lastNonZeroFrame, 3);
  assert.equal(stats.leadingSilenceFrames, 2);
});

test("summarizes silent rendered audio", () => {
  const stats = summarizeAudio(new Float32Array(8), 2);

  assert.equal(stats.peak, 0);
  assert.equal(stats.rms, 0);
  assert.equal(stats.nonZeroSamples, 0);
  assert.equal(stats.nonZeroFrames, 0);
  assert.equal(stats.firstNonZeroFrame, undefined);
  assert.equal(stats.lastNonZeroFrame, undefined);
  assert.equal(stats.leadingSilenceFrames, 4);
});

test("matches event and pattern probes for a simple line-aligned Generator synth", async () => {
  const tempDir = await mkdtemp(resolve(tmpdir(), "sunvox-render-probe-"));
  const synthPath = resolve(tempDir, "probe-generator-sine.sunsynth");

  await SunSynthLab.create("Probe Generator Sine", { color: "#05ff00" })
    .addModule("MultiSynth", { name: "Input", position: { x: 0, y: 512, z: 0 } })
    .setInputModule("Input")
    .addModule("Generator", {
      name: "Sine",
      controllers: {
        volume: 128,
        waveform: "sin",
        panning: 128,
        attack: 0,
        release: 0,
        polyphony: 1,
        mode: "mono",
        sustain: "on",
        freqModulationByInput: 0,
        dutyCycle: 511,
      },
    })
    .connect("Input", "Sine")
    .connect("Sine", "Output")
    .writeSunsynth(synthPath);

  const output = execFileSync(
    process.execPath,
    [
      "tools/sunvox-render-debug.mjs",
      "--json",
      "--mode",
      "both",
      "--note",
      "C4",
      "--velocity",
      "112",
      "--gate",
      "0.24",
      "--duration",
      "1",
      "--passes",
      "1",
      synthPath,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const [result] = JSON.parse(output);
  const eventPass = result.passes.find((pass) => pass.mode === "synth-event-probe");
  const patternPass = result.passes.find((pass) => pass.mode === "synth-pattern-probe");

  assert.equal(result.probe.velocity, 112);
  assert.equal(result.probe.eventVelocity, 112);
  assert.equal(eventPass.eventTimeline.noteOn.track, 0);
  assert.equal(eventPass.eventTimeline.noteOn.note, 61);
  assert.equal(eventPass.eventTimeline.noteOn.velocity, 112);
  assert.equal(eventPass.eventTimeline.noteOn.module, result.moduleIndex + 1);
  assert.equal(eventPass.eventTimeline.noteOff.track, 0);
  assert.equal(eventPass.eventTimeline.noteOff.note, 128);
  assert.equal(eventPass.eventTimeline.noteOff.module, result.moduleIndex + 1);
  assert.ok(eventPass.eventTimeline.noteOn.ticks >= 0);
  assert.ok(eventPass.eventTimeline.noteOff.ticks >= 0);
  assert.equal(eventPass.eventTimeline.noteOff.ticks, eventPass.eventTimeline.noteOn.ticks + eventPass.eventTimeline.gateTicks);
  assert.equal(eventPass.eventTimeline.noteOff.frame, eventPass.eventTimeline.gateFrames);
  assert.deepEqual(
    result.probePattern.events.map((event) => ({
      line: event.line,
      track: event.track,
      note: event.note,
      velocity: event.velocity,
      module: event.module,
      controller: event.controller,
      value: event.value,
    })),
    [
      { line: 0, track: 0, note: 61, velocity: 112, module: result.moduleIndex + 1, controller: 0, value: 0 },
      {
        line: result.probePattern.noteOffLine,
        track: 0,
        note: 128,
        velocity: 0,
        module: result.moduleIndex + 1,
        controller: 0,
        value: 0,
      },
    ],
  );
  assertRelativeClose(eventPass.stats.peak, patternPass.stats.peak);
  assertRelativeClose(eventPass.stats.rms, patternPass.stats.rms);
  assertRelativeClose(eventPass.stats.nonZeroSamples, patternPass.stats.nonZeroSamples, 0.05);
});

test("matches event and pattern probes for a polyphonic root FMX synth", async () => {
  const tempDir = await mkdtemp(resolve(tmpdir(), "sunvox-render-probe-"));
  const synthPath = resolve(tempDir, "probe-root-fmx.sunsynth");

  await SunSynthLab.createModule("FMX", {
    name: "Probe Root FMX",
    controllers: {
      volume: 128,
      panning: 128,
    },
  }).writeSunsynth(synthPath);

  const output = execFileSync(
    process.execPath,
    [
      "tools/sunvox-render-debug.mjs",
      "--json",
      "--mode",
      "both",
      "--note",
      "C4",
      "--velocity",
      "112",
      "--gate",
      "0.24",
      "--duration",
      "1",
      "--passes",
      "1",
      synthPath,
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const [result] = JSON.parse(output);
  const eventPass = result.passes.find((pass) => pass.mode === "synth-event-probe");
  const patternPass = result.passes.find((pass) => pass.mode === "synth-pattern-probe");

  assertRelativeClose(eventPass.stats.peak, patternPass.stats.peak);
  assertRelativeClose(eventPass.stats.rms, patternPass.stats.rms);
  assertRelativeClose(eventPass.stats.nonZeroSamples, patternPass.stats.nonZeroSamples, 0.05);
});

test("compares event and pattern probes for generated synth regression fixtures", () => {
  const output = execFileSync(
    process.execPath,
    [
      "tools/sunvox-render-debug.mjs",
      "--json",
      "--mode",
      "both",
      "--note",
      "C4",
      "--velocity",
      "128",
      "--event-track",
      "28",
      "--passes",
      "1",
      "generated/instruments/Scratch Acid Bass.sunsynth",
      "generated/instruments/Scratch FMX Tines.sunsynth",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const results = JSON.parse(output);

  for (const result of results) {
    const eventPass = result.passes.find((pass) => pass.mode === "synth-event-probe");
    const patternPass = result.passes.find((pass) => pass.mode === "synth-pattern-probe");
    assert.equal(result.probe.eventVelocity, 128);
    assert.equal(result.probe.eventTrack, 28);
    assert.equal(eventPass.eventTimeline.noteOn.track, 28);
    assert.equal(eventPass.eventTimeline.noteOn.velocity, 128);
    assert.equal(eventPass.eventTimeline.noteOn.module, result.moduleIndex + 1);
    assert.equal(eventPass.eventTimeline.noteOff.track, 28);
    assert.ok(eventPass.stats.nonZeroFrames > 0, `${result.file} event probe should not be silent`);
    assert.ok(patternPass.stats.nonZeroFrames > 0, `${result.file} pattern probe should not be silent`);
    assert.ok(eventPass.stats.peak > 0, `${result.file} event probe should have non-zero peak`);
    assert.ok(patternPass.stats.peak > 0, `${result.file} pattern probe should have non-zero peak`);
    assertRelativeClose(eventPass.stats.peak, patternPass.stats.peak, 0.05);
    assertRelativeClose(eventPass.stats.rms, patternPass.stats.rms, 0.05);
    assertRelativeClose(eventPass.stats.nonZeroSamples, patternPass.stats.nonZeroSamples, 0.08);
  }
});

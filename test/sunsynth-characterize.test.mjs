import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { tmpdir } from "node:os";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { analyzeRenderedAudio, parseNote, parseProbe } from "../tools/sunsynth-characterize.mjs";
import { SunSynthLab } from "../tools/sunsynth-lab.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function stereoSine({ frequency, sampleRate = 44100, seconds = 1, leftGain = 1, rightGain = 1 }) {
  const frameCount = Math.round(sampleRate * seconds);
  const samples = new Float32Array(frameCount * 2);
  for (let frame = 0; frame < frameCount; frame += 1) {
    const value = Math.sin((2 * Math.PI * frequency * frame) / sampleRate);
    samples[frame * 2] = value * leftGain;
    samples[frame * 2 + 1] = value * rightGain;
  }
  return {
    samples,
    sampleRate,
    channels: 2,
    noteOnFrame: 0,
    noteOffFrame: Math.round(sampleRate * 0.75),
  };
}

test("parses note names and numeric note values", () => {
  assert.equal(parseNote("48"), 48);
  assert.equal(parseNote("C3"), 48);
  assert.equal(parseNote("C#3"), 49);
  assert.equal(parseNote("Db3"), 49);
  assert.equal(parseNote("A4"), 69);
  assert.throws(() => parseNote("H2"), /Invalid note/u);
});

test("parses multi-probe specifications", () => {
  assert.deepEqual(parseProbe("C2:72:2.0"), {
    id: "C2:72:2s",
    note: 36,
    velocity: 72,
    gateSeconds: 2,
    noteOffSeconds: 2.2,
    durationSeconds: 4.2,
  });
  assert.deepEqual(parseProbe("60:140:1.5"), {
    id: "C4:129:1.5s",
    note: 60,
    velocity: 129,
    gateSeconds: 1.5,
    noteOffSeconds: 1.7,
    durationSeconds: 3.7,
  });
  assert.throws(() => parseProbe("C2:72"), /Invalid --probe/u);
});

test("extracts spectral and stereo features from rendered audio", () => {
  const features = analyzeRenderedAudio(stereoSine({ frequency: 440, seconds: 1.2 }));

  assert.ok(features.peak > 0.99);
  assert.ok(features.rms > 0.69 && features.rms < 0.72);
  assert.ok(features.spectrum.centroidHz > 430 && features.spectrum.centroidHz < 450);
  assert.ok(features.spectrum.bandwidthHz > 0);
  assert.ok(features.spectrum.rolloff85Hz > 430 && features.spectrum.rolloff85Hz < 460);
  assert.ok(features.spectrum.flatness < 0.01);
  assert.ok(features.stereo.correlation > 0.99);
  assert.ok(features.stereo.sideToMidRatio < 0.001);
  assert.ok(features.tags.includes("loud"));
  assert.ok(features.tags.includes("narrow"));
});

test("reports side energy for anti-phase stereo material", () => {
  const features = analyzeRenderedAudio(stereoSine({ frequency: 440, seconds: 1.2, rightGain: -1 }));

  assert.ok(features.stereo.correlation < -0.99);
  assert.ok(features.stereo.sideToMidRatio > 1000);
  assert.ok(features.tags.includes("wide"));
});

test("reports probe pattern metadata in JSON output", () => {
  const output = execFileSync(
    process.execPath,
    [
      "tools/sunsynth-characterize.mjs",
      "--json",
      "--probe",
      "C4:96:0.25",
      "generated/instruments/Scratch FMX Tines.sunsynth",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const [result] = JSON.parse(output);

  assert.equal(result.measurement.input.id, "C4:96:0.25s");
  assert.ok(Math.abs(result.measurement.input.noteHz - 261.63) < 0.1);
  assert.deepEqual(result.measurement.input, {
    id: "C4:96:0.25s",
    note: 60,
    noteLabel: "C4",
    noteHz: result.measurement.input.noteHz,
    velocity: 96,
    requestedGateSeconds: 0.25,
    requestedDurationSeconds: 2.45,
  });
  assert.equal(result.measurement.renderMethod, "pattern-playback");
  assert.equal(result.measurement.playback.sampleRate, 44100);
  assert.equal(result.measurement.playback.channels, 2);
  assert.equal(result.measurement.playback.masterVolume, 256);
  assert.equal(result.measurement.playback.track, 0);
  assert.equal(result.probePattern.patternIndex, 1);
  const [noteOnEvent, noteOffEvent] = result.probePattern.events;
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
      { line: 0, track: 0, note: 61, velocity: 96, module: noteOnEvent.module, controller: 0, value: 0 },
      {
        line: result.probePattern.noteOffLine,
        track: 0,
        note: 128,
        velocity: 0,
        module: noteOnEvent.module,
        controller: 0,
        value: 0,
      },
    ],
  );
  assert.equal(noteOffEvent.module, noteOnEvent.module);
  assert.ok(result.probePattern.noteOffLine >= 1);
  assert.ok(result.probePattern.lineFrames > 0);
  assert.ok(result.probePattern.noteOffFrame > result.probePattern.noteOnFrame);
  assert.equal(result.measurement.playback.noteOn.frame, result.probePattern.noteOnFrame);
  assert.equal(result.measurement.playback.noteOff.frame, result.probePattern.noteOffFrame);
  assert.equal(result.measurement.playback.noteOff.line, result.probePattern.noteOffLine);
  assert.ok(result.measurement.playback.actualGateSeconds > 0);
  for (const legacyField of ["file", "probe", "note", "noteHz", "velocity", "durationSeconds", "noteOffSeconds", "gateSeconds"]) {
    assert.equal(Object.hasOwn(result, legacyField), false, `${legacyField} should be nested under measurement`);
  }
});

test("runs note and velocity sweeps from CLI options", () => {
  const output = execFileSync(
    process.execPath,
    [
      "tools/sunsynth-characterize.mjs",
      "--json",
      "--note-sweep",
      "C3,C4",
      "--velocity-sweep",
      "64,96",
      "generated/instruments/Scratch FMX Tines.sunsynth",
    ],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const results = JSON.parse(output);

  assert.deepEqual(
    results.map((result) => [result.measurement.input.noteLabel, result.measurement.input.velocity]),
    [
      ["C3", 64],
      ["C3", 96],
      ["C4", 64],
      ["C4", 96],
    ],
  );
});

test("characterizes a source-known Generator sine as a stable harmonic peak", async () => {
  const tempDir = await mkdtemp(resolve(tmpdir(), "sunsynth-characterize-"));
  const synthPath = resolve(tempDir, "known-generator-sine.sunsynth");

  await SunSynthLab.create("Known Generator Sine")
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
    ["tools/sunsynth-characterize.mjs", "--json", "--probe", "C4:96:0.5", synthPath],
    { cwd: repoRoot, encoding: "utf8" },
  );
  const [result] = JSON.parse(output);
  const strongestPeak = result.features.spectrum.dominantPeaks[0];

  assert.ok(Math.abs(strongestPeak.frequency - result.measurement.input.noteHz * 2) < 20);
  assert.equal(strongestPeak.harmonic, 2);
  assert.ok(result.features.spectrum.inharmonicityCents < 80);
  assert.ok(result.features.tags.includes("dark") || result.features.tags.includes("warm"));
});

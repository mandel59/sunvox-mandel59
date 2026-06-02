import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { analyzeRenderedAudio, parseNote, parseProbe } from "../tools/sunsynth-characterize.mjs";

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
    id: "C2:72:2.0s",
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
  assert.ok(features.spectrum.rolloff85Hz > 430 && features.spectrum.rolloff85Hz < 460);
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

  assert.equal(result.probe, "C4:96:0.3s");
  assert.equal(result.probePattern.patternIndex, 1);
  assert.ok(result.probePattern.noteOffLine >= 1);
  assert.ok(result.probePattern.lineFrames > 0);
  assert.ok(result.probePattern.noteOffFrame > result.probePattern.noteOnFrame);
});

import assert from "node:assert/strict";
import test from "node:test";

import { summarizeAudio } from "../tools/sunvox-render-debug.mjs";

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

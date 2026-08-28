import assert from "node:assert/strict";
import test from "node:test";

import { assessPartWindows, classifyPartRole } from "../tools/analyze-sunvox-balance.mjs";
import {
  AUDITORY_BALANCE_MODEL,
  analyzeAuditoryFrames,
  buildPairwiseRelations,
  centerBalanceLevels,
  computePartialLoudnessFrames,
  summarizePartialLoudnessWindow,
} from "../tools/auditory-balance-metrics.mjs";

const SAMPLE_RATE = 48000;

function tone(frequency, amplitude = 0.1, seconds = 1) {
  return Float32Array.from(
    { length: SAMPLE_RATE * seconds },
    (_, index) => amplitude * Math.sin((2 * Math.PI * frequency * index) / SAMPLE_RATE),
  );
}

function add(left, right) {
  return Float32Array.from(left, (value, index) => value + right[index]);
}

function scale(samples, gain) {
  return Float32Array.from(samples, (value) => value * gain);
}

function perceptualSummary(target, masker) {
  const options = { fftSize: 2048, hopSize: 512, bandCount: 32 };
  const full = analyzeAuditoryFrames(add(target, masker), 1, SAMPLE_RATE, options);
  const maskerAnalysis = analyzeAuditoryFrames(masker, 1, SAMPLE_RATE, options);
  const solo = analyzeAuditoryFrames(target, 1, SAMPLE_RATE, options);
  const frames = computePartialLoudnessFrames(full, maskerAnalysis, solo);
  return summarizePartialLoudnessWindow(frames, 0, 1);
}

test("classifies common music-part module names", () => {
  assert.equal(classifyPartRole("Aurora Kick", "Kicker"), "kick");
  assert.equal(classifyPartRole("Sunrise Chords", "Analog generator"), "chords");
  assert.equal(classifyPartRole("Crystal Arp", "Analog generator"), "arp");
  assert.equal(classifyPartRole("White Lift", "Analog generator"), "transition");
});

test("assesses part balance per window against audible peers", () => {
  const parts = [
    { name: "Kick", role: "kick", windows: [{ activeLufs: -22 }, { activeLufs: -21 }] },
    { name: "Bass", role: "bass", windows: [{ activeLufs: -21 }, { activeLufs: -20 }] },
    { name: "Chords", role: "chords", windows: [{ activeLufs: -22 }, { activeLufs: -21.5 }] },
    { name: "Arp", role: "arp", windows: [{ activeLufs: -30 }, { activeLufs: -29 }] },
  ];

  assessPartWindows(parts);

  assert.equal(parts[2].balance.assessment, "balanced");
  assert.equal(parts[3].balance.assessment, "balanced");
  assert.equal(parts[0].windows[0].peerMedianLufs, -22);
  assert.equal(parts[2].windows[1].relativeToPeerMedianDb, -0.25);
});

test("flags a foreground part that is consistently below its peers", () => {
  const parts = [
    { name: "Kick", role: "kick", windows: [{ activeLufs: -21 }, { activeLufs: -21 }] },
    { name: "Bass", role: "bass", windows: [{ activeLufs: -20 }, { activeLufs: -20 }] },
    { name: "Chords", role: "chords", windows: [{ activeLufs: -31 }, { activeLufs: -30 }] },
  ];

  assessPartWindows(parts);

  assert.equal(parts[2].balance.assessment, "low");
  assert.ok(parts[2].balance.medianRelativeToPeerDb < -4);
});

test("excludes reverb-tail windows far below a part's active level", () => {
  const parts = [
    { name: "Kick", role: "kick", windows: [{ activeLufs: -21 }, { activeLufs: Number.NEGATIVE_INFINITY }] },
    { name: "Chords", role: "chords", windows: [{ activeLufs: -22 }, { activeLufs: -45 }] },
  ];

  assessPartWindows(parts);

  assert.equal(parts[1].windows[0].includedInBalance, true);
  assert.equal(parts[1].windows[1].includedInBalance, false);
  assert.equal(parts[1].balance.activeWindowCount, 1);
});

test("same-band masking reduces partial loudness more than off-band masking", () => {
  const target = tone(1000, 0.08);
  const sameBand = perceptualSummary(target, tone(1000, 0.32));
  const offBand = perceptualSummary(target, tone(6000, 0.32));

  assert.ok(sameBand.partialLoudnessProxy < offBand.partialLoudnessProxy);
  assert.ok(sameBand.maskingLossDb > offBand.maskingLossDb);
  assert.ok(sameBand.audibilityFraction < offBand.audibilityFraction);
});

test("a stronger same-band masker increases masking loss", () => {
  const target = tone(1000, 0.08);
  const quietMasker = perceptualSummary(target, tone(1000, 0.08));
  const loudMasker = perceptualSummary(target, tone(1000, 0.4));

  assert.ok(loudMasker.partialLoudnessProxy < quietMasker.partialLoudnessProxy);
  assert.ok(loudMasker.maskingLossDb > quietMasker.maskingLossDb);
});

test("centered perceptual balance is invariant to common level offsets", () => {
  const original = centerBalanceLevels([
    { moduleIndex: 1, activeFrameCount: 4, partialLevelDb: -18 },
    { moduleIndex: 2, activeFrameCount: 4, partialLevelDb: -23 },
  ]);
  const shifted = centerBalanceLevels([
    { moduleIndex: 1, activeFrameCount: 4, partialLevelDb: -11 },
    { moduleIndex: 2, activeFrameCount: 4, partialLevelDb: -16 },
  ]);

  assert.deepEqual(
    shifted.map((item) => item.balanceBetaDb),
    original.map((item) => item.balanceBetaDb),
  );
});

test("auditory balance coordinates remain stable under common waveform gain", () => {
  const low = tone(500, 0.08);
  const high = tone(3000, 0.04);
  const balanceAtGain = (gain) => {
    const lowSummary = perceptualSummary(scale(low, gain), scale(high, gain));
    const highSummary = perceptualSummary(scale(high, gain), scale(low, gain));
    return centerBalanceLevels([
      { moduleIndex: 1, activeFrameCount: lowSummary.activeFrameCount, partialLevelDb: lowSummary.partialLevelDb },
      { moduleIndex: 2, activeFrameCount: highSummary.activeFrameCount, partialLevelDb: highSummary.partialLevelDb },
    ]).map((item) => item.balanceBetaDb);
  };

  const unity = balanceAtGain(1);
  const louder = balanceAtGain(2);
  assert.ok(Math.abs(unity[0] - louder[0]) < 1e-5);
  assert.ok(Math.abs(unity[1] - louder[1]) < 1e-5);
});

test("perceptual output identifies proxy calibration and preserves pairwise ordering", () => {
  assert.equal(AUDITORY_BALANCE_MODEL.standardConformance, "none");
  assert.equal(AUDITORY_BALANCE_MODEL.calibration.calibrated, false);
  const centered = centerBalanceLevels([
    { moduleIndex: 1, name: "Lead", activeFrameCount: 8, partialLevelDb: -12 },
    { moduleIndex: 2, name: "Pad", activeFrameCount: 8, partialLevelDb: -18 },
  ]);
  const relations = buildPairwiseRelations(centered);

  assert.equal(relations.length, 1);
  assert.equal(relations[0].leftName, "Lead");
  assert.equal(relations[0].rightName, "Pad");
  assert.equal(relations[0].deltaDb, 6);
});

import assert from "node:assert/strict";
import test from "node:test";

import { assessPartWindows, classifyPartRole } from "../tools/analyze-sunvox-balance.mjs";

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

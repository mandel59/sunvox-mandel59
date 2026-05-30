import assert from "node:assert/strict";
import test from "node:test";

import { collectDiffLabels, diffDocuments, formatDiff } from "../tools/sunvox-diff.mjs";

test("diffs semantic SunVox document fields while ignoring auxiliary properties", () => {
  const before = {
    magic: "SVOX",
    _sourceName: "before.sunvox",
    project: {
      name: "Before",
      bpm: 125,
    },
    modules: [
      {
        name: "Amp",
        type: "Amplifier",
        _moduleType: "Amplifier",
        controllers: {
          volume: 256,
        },
      },
    ],
  };
  const after = {
    magic: "SVOX",
    _sourceName: "after.sunvox",
    project: {
      name: "After",
      bpm: 125,
    },
    modules: [
      {
        name: "Amp",
        type: "Amplifier",
        _moduleType: "Changed helper text",
        controllers: {
          volume: 300,
        },
      },
    ],
  };

  assert.deepEqual(diffDocuments(before, after), [
    { type: "changed", path: "modules[0].controllers.volume", before: 256, after: 300 },
    { type: "changed", path: "project.name", before: "Before", after: "After" },
  ]);
});

test("can include auxiliary properties in semantic diffs", () => {
  const changes = diffDocuments({ _sourceName: "before" }, { _sourceName: "after" }, { includeAux: true });

  assert.deepEqual(changes, [{ type: "changed", path: "_sourceName", before: "before", after: "after" }]);
});

test("formats semantic diff output", () => {
  const text = formatDiff({
    before: "before.sunvox",
    after: "after.sunvox",
    labels: {
      "modules[0]": "Module #0 \"Amp\" [Amplifier]",
      "patterns[1]": "Pattern #1 \"Lead\"",
    },
    changes: [
      { type: "changed", path: "project.name", before: "Before", after: "After" },
      { type: "changed", path: "modules[0].controllers.volume", before: 256, after: 300 },
      { type: "changed", path: "patterns[1].events[3].note", before: "C4", after: "D4" },
    ],
  });

  assert.match(text, /SunVox semantic diff/u);
  assert.match(text, /Changes: 3/u);
  assert.match(text, /Project/u);
  assert.match(text, /Module #0 "Amp" \[Amplifier\] controllers/u);
  assert.match(text, /Pattern #1 "Lead" events/u);
  assert.match(text, /~ project\.name: "Before" -> "After"/u);
});

test("collects diff labels from module and pattern metadata", () => {
  assert.deepEqual(
    collectDiffLabels(
      {
        modules: [{ name: "Before Amp", type: "Amplifier" }],
        patterns: [{ name: "Old" }],
      },
      {
        modules: [{ name: "After Amp", type: "Amplifier" }],
        patterns: [{ name: "New" }],
      },
    ),
    {
      "modules[0]": "Module #0 \"After Amp\" [Amplifier]",
      "patterns[0]": "Pattern #0 \"New\"",
    },
  );
});

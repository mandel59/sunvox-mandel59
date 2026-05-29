import assert from "node:assert/strict";
import test from "node:test";

import { diffDocuments, formatDiff } from "../tools/sunvox-diff.mjs";

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
    changes: [{ type: "changed", path: "project.name", before: "Before", after: "After" }],
  });

  assert.match(text, /SunVox semantic diff/u);
  assert.match(text, /Changes: 1/u);
  assert.match(text, /~ project\.name: "Before" -> "After"/u);
});

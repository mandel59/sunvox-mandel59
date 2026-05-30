import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { collectSiteData } from "../tools/generate-site-data.mjs";

const SITE_DATA_PATH = "site-data/sunvox-projects.json";

test("site data is regenerated deterministically from checked-in SunVox files", async () => {
  const expected = JSON.parse(readFileSync(SITE_DATA_PATH, "utf8"));
  const actual = await collectSiteData();

  assert.deepEqual(actual, expected);
});

test("site data summarizes project structure without embedding full event grids", async () => {
  const data = await collectSiteData();
  const project = data.projects.find((candidate) => candidate.path === "music/2022-04-17.sunvox");
  const synth = data.projects.find((candidate) => candidate.path === "instruments/mandel59 shepard.sunsynth");

  assert.equal(data.schemaVersion, 1);
  assert.deepEqual(data.sourceRoots, ["music", "instruments"]);
  assert.equal(data.projects.length, 6);
  assert.ok(project);
  assert.equal(project.type, "project");
  assert.equal(project.stats.activeModules, 9);
  assert.equal(project.stats.patterns, 1);
  assert.equal(project.patterns[0].eventCount, 28);
  assert.equal(project.patterns[0].eventPreview.length, 4);
  assert.equal(Object.hasOwn(project.patterns[0], "events"), false);
  assert.equal(project.links.some((link) => link.fromName === "DrumSynth" && link.toName === "Reverb"), true);
  assert.ok(synth);
  assert.equal(synth.type, "synth");
  assert.equal(synth.embedded.length, 1);
  assert.equal(synth.embedded[0].document.type, "project");
});

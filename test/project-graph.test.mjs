import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildGraphLayout, graphNodeSize, shortLabel } from "../src/project-graph.js";

const siteData = JSON.parse(readFileSync("site-data/sunvox-projects.json", "utf8"));

test("builds graph layout from SunVox module positions and links", () => {
  const project = siteData.projects.find((candidate) => candidate.path === "music/2022-04-17.sunvox");
  const graph = buildGraphLayout(project);

  assert.ok(graph);
  assert.equal(graph.nodes.length, 9);
  assert.equal(graph.edges.length, 10);
  const [, , width, height] = graph.viewBox.split(" ").map(Number);
  assert.equal(Number((width / height).toFixed(3)), 1.778);
  assert.equal(graph.edges.some((link) => link.fromName === "DrumSynth" && link.toName === "Reverb"), true);
});

test("skips graph layout when a document has no positioned links", () => {
  const synth = siteData.projects.find((candidate) => candidate.path === "instruments/mandel59 shepard.sunsynth");

  assert.equal(buildGraphLayout(synth), undefined);
});

test("preserves module scale for graph node sizing", () => {
  const graph = buildGraphLayout({
    modules: [
      { index: 0, name: "Output", kind: "output", position: { x: 0, y: 0 }, scale: 512 },
      { index: 1, name: "Generator", kind: "module", position: { x: 100, y: 0 }, scale: 128 },
    ],
    links: [{ from: 1, to: 0, fromName: "Generator", toName: "Output" }],
    project: { view: { moduleScale: 512 } },
  });

  assert.ok(graph);
  assert.equal(graph.moduleScale, 512);
  assert.deepEqual(graph.nodes.map((module) => graphNodeSize(module, graph.moduleScale).halfWidth), [156, 39]);
});

test("shortens long graph labels to a fixed display budget", () => {
  assert.equal(shortLabel("SawZer EPiano2", 13), "SawZer EPi...");
  assert.equal(shortLabel("Output", 13), "Output");
});

import assert from "node:assert/strict";
import test from "node:test";

import { buildOutlineFromFile, formatOutline } from "../tools/sunvox-outline.mjs";

test("builds a readable outline for SunVox projects", async () => {
  const outline = await buildOutlineFromFile("music/2022-04-17.sunvox", { eventLimit: 3 });
  const text = formatOutline(outline, { eventLimit: 3 });

  assert.equal(outline.magic, "SVOX");
  assert.equal(outline.project.name, "2022-04-17 03-24");
  assert.equal(outline.project.patternCount, 1);
  assert.equal(outline.modules.some((module) => module.name === "DrumSynth"), true);
  assert.equal(outline.modules.some((module) => module.inputLinkSlots?.length), true);
  assert.equal(outline.links.some((edge) => edge._toName === "Output"), true);
  assert.equal(outline.links.some((edge) => edge.kind === "auxInput" || edge.kind === "auxOutput"), false);
  assert.equal(outline.patterns[0].events[0].note, "C4");
  assert.match(text, /SunVox Outline: music[\\/]2022-04-17\.sunvox/u);
  assert.match(text, /#2 DrumSynth \[DrumSynth\]/u);
  assert.match(text, /L000 T0 note=C4 module=#2 DrumSynth/u);
});

test("builds a readable outline for SunSynth modules and embedded containers", async () => {
  const outline = await buildOutlineFromFile("instruments/mandel59 shepard.sunsynth", { eventLimit: 1 });
  const text = formatOutline(outline, { eventLimit: 1 });

  assert.equal(outline.magic, "SSYN");
  assert.equal(outline.synth.type, "MetaModule");
  assert.equal(outline.embedded.length, 1);
  assert.equal(outline.embedded[0].document.magic, "SVOX");
  assert.match(text, /SunSynth Outline: instruments[\\/]mandel59 shepard\.sunsynth/u);
  assert.match(text, /Synth Module/u);
  assert.match(text, /Embedded Containers/u);
});

import assert from "node:assert/strict";
import test from "node:test";

import { buildOutline, buildOutlineFromFile, formatOutline } from "../tools/sunvox-outline.mjs";

test("builds a readable outline for SunVox projects", async () => {
  const outline = await buildOutlineFromFile("music/2022-04-17.sunvox", { eventLimit: 3 });
  const text = formatOutline(outline, { eventLimit: 3 });

  assert.equal(outline.magic, "SVOX");
  assert.equal(outline.project.name, "2022-04-17 03-24");
  assert.equal(outline.project.patternCount, 1);
  assert.deepEqual(outline.graph, {
    modules: 9,
    activeModules: 9,
    edges: 10,
    inputEdges: 10,
    outputEdges: 0,
    danglingEdges: 0,
  });
  assert.equal(outline.modules.some((module) => module.name === "DrumSynth"), true);
  assert.equal(outline.modules.some((module) => module.inputs?.some((link) => Number.isInteger(link.peerSlot))), true);
  assert.equal(outline.links.some((edge) => edge._toName === "Output"), true);
  assert.equal(outline.links.some((edge) => edge.kind === "auxInput" || edge.kind === "auxOutput"), false);
  assert.equal(outline.patterns[0].events[0].note, "C4");
  assert.match(text, /SunVox Outline: music[\\/]2022-04-17\.sunvox/u);
  assert.match(text, /Graph: active=9 edges=10 dangling=0/u);
  assert.match(text, /#2 DrumSynth \[DrumSynth\]/u);
  assert.match(text, /#8 MultiCtl -> #1 SuperSaw \(input fromSlot=1 toSlot=0\)/u);
  assert.match(text, /L000 T0 note=C4 module=#2 DrumSynth/u);
});

test("builds a readable outline for SunSynth modules and embedded containers", async () => {
  const outline = await buildOutlineFromFile("instruments/mandel59 shepard.sunsynth", { eventLimit: 1 });
  const text = formatOutline(outline, { eventLimit: 1 });

  assert.equal(outline.magic, "SSYN");
  assert.equal(outline.synth.type, "MetaModule");
  assert.equal(outline.graph.edges, 0);
  assert.equal(outline.embedded.length, 1);
  assert.equal(outline.embedded[0].document.magic, "SVOX");
  assert.match(text, /SunSynth Outline: instruments[\\/]mandel59 shepard\.sunsynth/u);
  assert.match(text, /Synth Module/u);
  assert.match(text, /Embedded Containers/u);
});

test("treats Sampler effect modules as nested embedded containers", () => {
  const outline = buildOutline(
    {
      magic: "SVOX",
      project: { name: "Sampler host" },
      modules: [
        { name: "Output", flags: { exists: true, output: true } },
        {
          name: "Sampler",
          type: "Sampler",
          flags: { exists: true, generator: true },
          dataChunks: [
            {
              index: 266,
              name: "effectModule",
              container: {
                magic: "SSYN",
                module: {
                  name: "Sampler Effect",
                  type: "MetaModule",
                  flags: { exists: true, generator: true },
                  dataChunks: [
                    {
                      index: 0,
                      name: "embeddedProject",
                      container: {
                        magic: "SVOX",
                        project: { name: "Nested Effect Project" },
                        modules: [],
                        patterns: [],
                      },
                    },
                  ],
                },
              },
            },
          ],
        },
      ],
      patterns: [],
    },
    { sourceName: "sampler-effect.sunvox" },
  );
  const text = formatOutline(outline);

  assert.equal(outline.embedded.length, 1);
  assert.equal(outline.embedded[0].dataChunkName, "effectModule");
  assert.equal(outline.embedded[0].document.magic, "SSYN");
  assert.equal(outline.embedded[0].document.embedded.length, 1);
  assert.equal(outline.embedded[0].document.embedded[0].dataChunkName, "embeddedProject");
  assert.equal(outline.embedded[0].document.embedded[0].document.project.name, "Nested Effect Project");
  assert.match(text, /#1 Sampler: dataChunk#266 effectModule/u);
  assert.match(text, /#0 root: dataChunk#0 embeddedProject/u);
});

test("summarizes MetaModule user controllers in outlines", async () => {
  const outline = await buildOutlineFromFile("instruments/mandel59 SuperSaw.sunsynth", {
    embedded: false,
    eventLimit: 0,
  });
  const text = formatOutline(outline, { eventLimit: 0 });

  assert.equal(outline.synth.userControllers.length, 9);
  assert.deepEqual(outline.synth.userControllers[0], {
    index: 0,
    label: "Detune 1",
    group: 2,
    value: 8192,
    link: {
      module: 16,
      controller: 0,
      _moduleName: "Detune 1",
      _moduleType: "MultiCtl",
      _controllerName: "value",
      _controllerLabel: "Value",
    },
  });
  assert.match(text, /userControllers=9/u);
  assert.match(text, /user#0 "Detune 1" group=2 value=8192 -> #16 Detune 1 \[MultiCtl\] controller=value/u);
  assert.doesNotMatch(text, /Embedded Containers/u);
});

test("formats pattern effect parameters distinctly from controller values", () => {
  const outline = buildOutline(
    {
      magic: "SVOX",
      project: { name: "effect outline", bpm: 125, speed: 6, globalVolume: 256 },
      modules: [
        { name: "Output", flags: { exists: true, output: true } },
        { name: "Synth", type: "Generator", flags: { exists: true, generator: true } },
      ],
      patterns: [
        {
          name: "Fx",
          lines: 4,
          tracks: 1,
          position: { x: 0, y: 0 },
          events: [
            { line: 0, track: 0, module: 1, effect: "vibrato", parameter: { speed: 3, amplitude: 4 } },
            { line: 1, track: 0, module: 1, controller: "volume", value: 321 },
          ],
        },
      ],
    },
    { sourceName: "synthetic.sunvox" },
  );
  const text = formatOutline(outline, { eventLimit: 4 });

  assert.match(text, /L000 T0 module=#1 effect=vibrato parameter=\{speed=3,amplitude=4\}/u);
  assert.match(text, /L001 T0 module=#1 controller=volume value=321/u);
});

test("numbers patterns from array order, not editable object fields", () => {
  const outline = buildOutline({
    magic: "SVOX",
    project: { name: "pattern numbers" },
    modules: [],
    patterns: [
      { index: 99, name: "First", lines: 1, tracks: 1, events: [] },
      { name: "Second", lines: 1, tracks: 1, events: [] },
    ],
  });
  const text = formatOutline(outline);

  assert.deepEqual(outline.patterns.map((pattern) => [pattern.index, pattern.name]), [
    [0, "First"],
    [1, "Second"],
  ]);
  assert.match(text, /#0 "First"/u);
  assert.match(text, /#1 "Second"/u);
  assert.doesNotMatch(text, /#99 "First"/u);
});

test("keeps clone pattern metadata in outlines", () => {
  const outline = buildOutline({
    magic: "SVOX",
    project: { name: "clone patterns" },
    modules: [],
    patterns: [
      { name: "Source", lines: 16, tracks: 1, events: [] },
      { lines: 16, tracks: 1, parent: 0, parentId: 12345, infoFlags: { clone: true }, events: [] },
    ],
  });

  assert.deepEqual(outline.patterns[1].infoFlags, { clone: true });
  assert.equal(outline.patterns[1].parent, 0);
  assert.equal(outline.patterns[1].parentId, 12345);
});

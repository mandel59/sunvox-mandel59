import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import { inflateSync } from "node:zlib";

import { buildContainer, TEXT_FORMAT } from "../tools/sunvox-codec.mjs";
import {
  collectSiteData,
  DEFAULT_ROOTS,
  mergeRootLists,
  parsePreviewRoots,
} from "../tools/generate-site-data.mjs";

const SITE_DATA_PATH = "site-data/sunvox-projects.json";

function pngRows(dataUrl) {
  const buffer = Buffer.from(dataUrl.split(",")[1], "base64");
  const idatChunks = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.toString("ascii", offset + 4, offset + 8);
    const data = buffer.subarray(offset + 8, offset + 8 + length);
    if (type === "IDAT") {
      idatChunks.push(data);
    }
    offset += 12 + length;
  }
  return inflateSync(Buffer.concat(idatChunks));
}

test("site data is regenerated deterministically from checked-in SunVox files", async () => {
  const expected = JSON.parse(readFileSync(SITE_DATA_PATH, "utf8"));
  const actual = await collectSiteData();

  assert.deepEqual(actual, expected);
});

test("site data summarizes project structure without embedding full event grids", async () => {
  const data = await collectSiteData();
  const project = data.projects.find((candidate) => candidate.path === "music/2022-04-17.sunvox");
  const projectWithEmptyPatterns = data.projects.find((candidate) => candidate.path === "music/2022-04-18.sunvox");
  const iconProject = data.projects.find((candidate) => candidate.path === "music/2022-04-20.sunvox");
  const synth = data.projects.find((candidate) => candidate.path === "instruments/mandel59 shepard.sunsynth");
  const synthWithNamedPatterns = data.projects.find(
    (candidate) => candidate.path === "instruments/mandel59 SuperSaw.sunsynth",
  );
  const generatedRootFmx = data.projects.find(
    (candidate) => candidate.path === "generated/instruments/Scratch FMX Tines.sunsynth",
  );
  const generatedRootFmxPluck = data.projects.find(
    (candidate) => candidate.path === "generated/instruments/Scratch FMX Pluck.sunsynth",
  );
  const generatedMetaModule = data.projects.find(
    (candidate) => candidate.path === "generated/instruments/Scratch Layered Pad.sunsynth",
  );

  assert.equal(data.schemaVersion, 1);
  assert.deepEqual(data.sourceRoots, ["music", "instruments", "generated/music", "generated/instruments"]);
  assert.equal(data.projects.length, 14);
  assert.ok(project);
  assert.equal(project.type, "project");
  assert.deepEqual(project.project.flags, {});
  assert.deepEqual(project.project.timeline, { grid: 4, grid2: 4 });
  assert.equal(project.stats.activeModules, 9);
  assert.equal(project.stats.patterns, 1);
  assert.equal(project.patterns[0].eventCount, 28);
  assert.match(project.patterns[0].icon.src, /^data:image\/png;base64,/u);
  assert.equal(Buffer.from(project.patterns[0].icon.src.split(",")[1], "base64")[25], 3);
  assert.deepEqual(
    project.patterns[0].moduleReferences.map((module) => [
      module.index,
      module.name,
      module.type,
      module.color,
      module.eventCount,
    ]),
    [
      [1, "SuperSaw", "MetaModule", "#ff00b8", 4],
      [2, "DrumSynth", "DrumSynth", "#00cbff", 24],
    ],
  );
  assert.equal(Object.hasOwn(project.patterns[0], "events"), false);
  assert.equal(Object.hasOwn(project.patterns[0], "eventPreview"), false);
  assert.equal(project.links.some((link) => link.fromName === "DrumSynth" && link.toName === "Reverb"), true);
  assert.ok(projectWithEmptyPatterns);
  assert.deepEqual(projectWithEmptyPatterns.project.flags, { supertracks: true });
  assert.equal(projectWithEmptyPatterns.stats.patterns, 6);
  assert.deepEqual(projectWithEmptyPatterns.patterns.map((pattern) => pattern.index), [0, 1, 2, 3, 4, 5]);
    assert.deepEqual(projectWithEmptyPatterns.patterns[3].infoFlags, { clone: true });
    assert.equal(projectWithEmptyPatterns.patterns[3].parent, 1);
    assert.equal(projectWithEmptyPatterns.patterns[3].lines, projectWithEmptyPatterns.patterns[1].lines);
    assert.equal(projectWithEmptyPatterns.patterns[3].tracks, projectWithEmptyPatterns.patterns[1].tracks);
    assert.equal(projectWithEmptyPatterns.patterns[3].icon.src, projectWithEmptyPatterns.patterns[1].icon.src);
  assert.ok(iconProject);
  assert.deepEqual([...pngRows(iconProject.patterns[0].icon.src).subarray(0, 17)], [
    0, 0, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 0, 1, 1, 0, 0,
  ]);
  assert.ok(synth);
  assert.equal(synth.type, "synth");
  assert.equal(synth.embedded.length, 1);
  assert.equal(synth.embedded[0].document.type, "project");
  assert.ok(generatedRootFmx);
  assert.equal(generatedRootFmx.type, "synth");
  assert.equal(generatedRootFmx.synth.type, "FMX");
  assert.deepEqual(generatedRootFmx.sourceRecipe, {
    path: "generated/recipes/sunvox-edit/scratch-fmx.mjs",
    name: "scratch-fmx.mjs",
  });
  assert.equal(generatedRootFmx.embedded.length, 0);
  assert.ok(generatedRootFmxPluck);
  assert.deepEqual(
    generatedRootFmxPluck.synth.controllers.find((controller) => controller.path === "volume"),
    { index: 0, path: "volume", label: "Volume", value: 13200, min: 0, max: 32768 },
  );
  assert.ok(generatedMetaModule);
  assert.equal(generatedMetaModule.type, "synth");
  assert.equal(generatedMetaModule.synth.type, "MetaModule");
  assert.deepEqual(generatedMetaModule.sourceRecipe, {
    path: "generated/recipes/sunvox-edit/scratch-layered-pad.mjs",
    name: "scratch-layered-pad.mjs",
  });
  assert.equal(generatedMetaModule.embedded.length, 1);
  assert.equal(generatedMetaModule.embedded[0].document.stats.activeModules, 9);
  assert.ok(synthWithNamedPatterns);
  assert.deepEqual(
    synthWithNamedPatterns.embedded[0].document.patterns.map((pattern) => [pattern.name, pattern.eventCount]),
    [
      ["Created by mandel59", 0],
      ["CC0 No Rights Reserved", 0],
    ],
  );
  assert.equal(Object.hasOwn(synthWithNamedPatterns.embedded[0].document.patterns[0], "icon"), false);
});

test("site data includes clone patterns and inherits display metadata from the parent", async () => {
  const fixtureDir = join("var", "site-data-clone-fixture");
  await rm(fixtureDir, { recursive: true, force: true });
  await mkdir(fixtureDir, { recursive: true });

  try {
    await writeFile(
      join(fixtureDir, "clone.sunvox"),
      buildContainer({
        format: TEXT_FORMAT,
        magic: "SVOX",
        headerTailHex: "00000000",
        project: {
          name: "clone fixture",
          flags: { supertracks: true },
        },
        modules: [
          { name: "Output", flags: { exists: true, output: true }, color: "#888888" },
          { name: "Tone", type: "Generator", flags: { exists: true, generator: true }, color: "#44aaff" },
        ],
        patterns: [
          {
            name: "Source",
            position: { x: 0, y: 32 },
            lines: 16,
            tracks: 1,
            iconBase64: Buffer.alloc(32, 0xff).toString("base64"),
            foreground: "#111111",
            background: "#eeeeee",
            events: [{ line: 0, track: 0, note: "C4", module: 1 }],
          },
          {
            position: { x: 16, y: 64 },
            lines: 16,
            tracks: 1,
            parent: 0,
            parentId: 12345,
            infoFlags: { clone: true },
            events: [],
          },
        ],
      }),
    );

    const data = await collectSiteData([fixtureDir]);
    const project = data.projects[0];
    assert.equal(project.stats.patterns, 2);
    assert.deepEqual(project.patterns.map((pattern) => pattern.index), [0, 1]);
    assert.deepEqual(project.patterns[1].infoFlags, { clone: true });
    assert.equal(project.patterns[1].parent, 0);
    assert.equal(project.patterns[1].parentId, 12345);
    assert.equal(project.patterns[1].lines, project.patterns[0].lines);
    assert.equal(project.patterns[1].tracks, project.patterns[0].tracks);
    assert.equal(project.patterns[1].icon.src, project.patterns[0].icon.src);
    assert.deepEqual(
      project.patterns[1].moduleReferences.map((module) => [module.index, module.name, module.type, module.color]),
      [[1, "Tone", "Generator", "#44aaff"]],
    );
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});

test("preview roots merge defaults and explicit extras without duplicates", () => {
  assert.deepEqual(parsePreviewRoots("var/private-preview; var/custom \nvar/synth-lab"), [
    "var/private-preview",
    "var/custom",
    "var/synth-lab",
  ]);
  assert.deepEqual(
    mergeRootLists(DEFAULT_ROOTS, ["var/synth-lab", "var/private-preview", "music", "var/synth-lab"]),
    ["music", "instruments", "generated/music", "generated/instruments", "var/synth-lab", "var/private-preview"],
  );
});

test("explicit preview roots include non-deploy synths without changing the default index", async () => {
  const defaultData = await collectSiteData();
  const previewData = await collectSiteData(mergeRootLists(DEFAULT_ROOTS, ["var/synth-lab"]));

  assert.equal(defaultData.projects.length, 14);
  assert.equal(defaultData.sourceRoots.includes("var/synth-lab"), false);
  assert.equal(
    defaultData.projects.some((project) => project.path.startsWith("var/synth-lab/")),
    false,
  );

  assert.equal(previewData.sourceRoots.includes("var/synth-lab"), true);
  assert.ok(previewData.projects.length > defaultData.projects.length);
  assert.ok(
    previewData.projects.some((project) => project.path === "var/synth-lab/mandel59 Scratch Acid Bass.sunsynth"),
  );
});

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
  findSunVoxFiles,
  mergeRootLists,
  parsePreviewRoots,
} from "../tools/generate-site-data.mjs";
import { runMusicRecipe } from "../tools/sunvox-music-recipe.mjs";

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
  const expectedProjectCount = (await findSunVoxFiles(DEFAULT_ROOTS)).length;
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
  const generatedRootFmxBell = data.projects.find(
    (candidate) => candidate.path === "generated/instruments/Scratch FMX Bell.sunsynth",
  );
  const generatedRootFmxBass = data.projects.find(
    (candidate) => candidate.path === "generated/instruments/Scratch FMX Bass.sunsynth",
  );
  const generatedGlassBell = data.projects.find(
    (candidate) => candidate.path === "generated/instruments/Scratch Glass Bell.sunsynth",
  );
  const generatedPwmOrgan = data.projects.find(
    (candidate) => candidate.path === "generated/instruments/Scratch PWM Organ.sunsynth",
  );
  const generatedMetaModule = data.projects.find(
    (candidate) => candidate.path === "generated/instruments/Scratch Layered Pad.sunsynth",
  );
  const waKotoPluck = data.projects.find(
    (candidate) => candidate.path === "generated/instruments/Wa Koto Pluck.sunsynth",
  );
  const podcastBed = data.projects.find(
    (candidate) => candidate.path === "generated/music/podcast-bed-loop.sunvox",
  );
  const podcastTransition = data.projects.find(
    (candidate) => candidate.path === "generated/music/podcast-section-transition.sunvox",
  );
  const firstHookLoop = data.projects.find(
    (candidate) => candidate.path === "generated/music/first-hook-loop.sunvox",
  );
  const altShepardChipBumper = data.projects.find(
    (candidate) => candidate.path === "generated/music/alt-shepard-chip-bumper.sunvox",
  );
  const polyVocoderSyllableGrid = data.projects.find(
    (candidate) => candidate.path === "generated/music/poly-vocoder-syllable-grid.sunvox",
  );
  const waBgmSketch = data.projects.find((candidate) => candidate.path === "generated/music/wa-bgm-sketch.sunvox");

  assert.equal(data.schemaVersion, 2);
  assert.deepEqual(data.sourceRoots, ["music", "instruments", "generated/music", "generated/instruments"]);
  assert.equal(data.assetCatalog.schemaVersion, 1);
  assert.equal(data.assetCatalog.entries.length, data.projects.filter((candidate) => candidate.catalog).length);
  assert.equal(data.assetCatalog.entries.every((entry) => entry.measurement), true);
  assert.ok(data.assetCatalog.entries.some((entry) => entry.path === "instruments/mandel59 shepard.sunsynth"));
  assert.ok(data.assetCatalog.entries.some((entry) => entry.path === "generated/instruments/Scratch Analog.sunsynth"));
  assert.ok(data.assetCatalog.entries.some((entry) => entry.path === "generated/instruments/Scratch FMX Bell.sunsynth"));
  assert.equal(data.projects.length, expectedProjectCount);
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
  assert.deepEqual(synth.catalog.deployment, {
    status: "deploy",
    deploy: true,
    previewOnly: false,
    root: "instruments",
  });
  assert.equal(synth.catalog.measurement.input.id, "C4:96:0.25s");
  assert.equal(synth.catalog.measurement.level.loudness, "medium");
  assert.deepEqual(synth.catalog.measurement.tags, ["medium"]);
  assert.equal(synth.embedded.length, 1);
  assert.equal(synth.embedded[0].document.type, "project");
  assert.ok(generatedRootFmx);
  assert.equal(generatedRootFmx.type, "synth");
  assert.equal(generatedRootFmx.synth.type, "FMX");
  assert.equal(Object.hasOwn(generatedRootFmx, "sourceRecipe"), false);
  assert.equal(generatedRootFmx.catalog.path, generatedRootFmx.path);
  assert.deepEqual(generatedRootFmx.catalog.deployment, {
    status: "deploy",
    deploy: true,
    previewOnly: false,
    root: "generated/instruments",
  });
  assert.deepEqual(generatedRootFmx.catalog.sourceRecipe, {
    path: "generated/recipes/sunvox-edit/scratch-fmx.mjs",
    name: "scratch-fmx.mjs",
  });
  assert.deepEqual(generatedRootFmx.catalog.measurement.input, {
    id: "C4:96:0.25s",
    noteLabel: "C4",
    velocity: 96,
    gateSeconds: 0.25,
  });
  assert.equal(generatedRootFmx.catalog.measurement.tool, "sunsynth-characterize");
  assert.equal(generatedRootFmx.catalog.measurement.renderMethod, "pattern-playback");
  assert.equal(generatedRootFmx.catalog.measurement.playback.sampleRate, 44100);
  assert.equal(generatedRootFmx.catalog.measurement.spectrum.bodyCentroidHz, 597);
  assert.ok(generatedRootFmx.catalog.measurement.tags.includes("fast-attack"));
  assert.equal(generatedRootFmx.embedded.length, 0);
  assert.ok(generatedRootFmxPluck);
  assert.deepEqual(
    generatedRootFmxPluck.synth.controllers.find((controller) => controller.path === "volume"),
    { index: 0, path: "volume", label: "Volume", value: 13200, min: 0, max: 32768 },
  );
  assert.ok(generatedRootFmxBell);
  assert.equal(generatedRootFmxBell.synth.type, "FMX");
  assert.equal(Object.hasOwn(generatedRootFmxBell, "sourceRecipe"), false);
  assert.deepEqual(generatedRootFmxBell.catalog.sourceRecipe, {
    path: "generated/recipes/sunvox-edit/scratch-fmx.mjs",
    name: "scratch-fmx.mjs",
  });
  assert.equal(generatedRootFmxBell.catalog.measurement.spectrum.bodyInharmonicityCents, 74.1);
  assert.ok(generatedRootFmxBell.catalog.measurement.tags.includes("metallic"));
  assert.ok(generatedRootFmxBass);
  assert.equal(generatedRootFmxBass.synth.type, "FMX");
  assert.equal(generatedRootFmxBass.catalog.measurement.spectrum.bodyCentroidHz, 1408);
  assert.ok(generatedGlassBell);
  assert.equal(generatedGlassBell.catalog.measurement.level.loudness, "loud");
  assert.deepEqual(generatedGlassBell.catalog.measurement.tags, ["loud"]);
  assert.ok(generatedPwmOrgan);
  assert.equal(generatedPwmOrgan.catalog.measurement.level.loudness, "medium");
  assert.deepEqual(generatedPwmOrgan.catalog.measurement.tags, ["medium"]);
  assert.ok(generatedMetaModule);
  assert.equal(generatedMetaModule.type, "synth");
  assert.equal(generatedMetaModule.synth.type, "MetaModule");
  assert.equal(Object.hasOwn(generatedMetaModule, "sourceRecipe"), false);
  assert.deepEqual(generatedMetaModule.catalog.sourceRecipe, {
    path: "generated/recipes/sunvox-edit/scratch-layered-pad.mjs",
    name: "scratch-layered-pad.mjs",
  });
  assert.deepEqual(generatedMetaModule.catalog.deployment, {
    status: "deploy",
    deploy: true,
    previewOnly: false,
    root: "generated/instruments",
  });
  assert.equal(generatedMetaModule.catalog.measurement.level.loudness, "medium");
  assert.deepEqual(generatedMetaModule.catalog.measurement.tags, ["medium"]);
  assert.equal(generatedMetaModule.embedded.length, 1);
  assert.equal(generatedMetaModule.embedded[0].document.stats.activeModules, 9);
  assert.ok(waKotoPluck);
  assert.equal(waKotoPluck.type, "synth");
  assert.deepEqual(waKotoPluck.catalog.sourceRecipe, {
    path: "generated/recipes/sunvox-edit/wa-instruments.mjs",
    name: "wa-instruments.mjs",
  });
  assert.equal(waKotoPluck.synth.name, "Wa Koto Pluck");
  assert.ok(synthWithNamedPatterns);
  assert.deepEqual(
    synthWithNamedPatterns.embedded[0].document.patterns.map((pattern) => [pattern.name, pattern.eventCount]),
    [
      ["Created by mandel59", 0],
      ["CC0 No Rights Reserved", 0],
    ],
  );
  assert.equal(Object.hasOwn(synthWithNamedPatterns.embedded[0].document.patterns[0], "icon"), false);
  assert.ok(podcastBed);
  assert.equal(podcastBed.type, "project");
  assert.deepEqual(podcastBed.sourceRecipe, {
    path: "generated/recipes/music/podcast-bed-loop.mjs",
    name: "podcast-bed-loop.mjs",
  });
  assert.equal(podcastBed.project.bpm, 96);
  assert.equal(podcastBed.stats.patterns, 1);
  assert.ok(podcastTransition);
  assert.deepEqual(podcastTransition.sourceRecipe, {
    path: "generated/recipes/music/podcast-purpose-pack.mjs",
    name: "podcast-purpose-pack.mjs",
  });
  assert.ok(firstHookLoop);
  assert.equal(firstHookLoop.type, "project");
  assert.deepEqual(firstHookLoop.sourceRecipe, {
    path: "generated/recipes/music/short-video-bgm.mjs",
    name: "short-video-bgm.mjs",
  });
  assert.equal(firstHookLoop.project.bpm, 128);
  assert.equal(firstHookLoop.stats.patterns, 1);
  assert.ok(altShepardChipBumper);
  assert.equal(altShepardChipBumper.type, "project");
  assert.deepEqual(altShepardChipBumper.sourceRecipe, {
    path: "generated/recipes/music/short-video-alt-palette.mjs",
    name: "short-video-alt-palette.mjs",
  });
  assert.equal(altShepardChipBumper.project.bpm, 132);
  assert.equal(altShepardChipBumper.stats.patterns, 1);
  assert.ok(polyVocoderSyllableGrid);
  assert.equal(polyVocoderSyllableGrid.type, "project");
  assert.deepEqual(polyVocoderSyllableGrid.sourceRecipe, {
    path: "generated/recipes/music/short-video-poly-vocoder.mjs",
    name: "short-video-poly-vocoder.mjs",
  });
  assert.equal(polyVocoderSyllableGrid.project.bpm, 128);
  assert.equal(polyVocoderSyllableGrid.stats.patterns, 1);
  assert.ok(waBgmSketch);
  assert.equal(waBgmSketch.type, "project");
  assert.deepEqual(waBgmSketch.sourceRecipe, {
    path: "generated/recipes/music/wa-bgm-sketch.mjs",
    name: "wa-bgm-sketch.mjs",
  });
  assert.equal(waBgmSketch.project.bpm, 92);
  assert.equal(waBgmSketch.stats.patterns, 2);
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

test("site data records source recipes for generated music projects", async () => {
  const fixtureDir = join("var", "site-data-music-recipe-fixture");
  const recipeDir = join(fixtureDir, "generated", "recipes", "music");
  const musicDir = join(fixtureDir, "generated", "music");
  const recipePath = join(recipeDir, "minimal-music.mjs");
  const outputPath = join(musicDir, "minimal-music.sunvox").replaceAll("\\", "/");
  await rm(fixtureDir, { recursive: true, force: true });
  await mkdir(recipeDir, { recursive: true });

  await writeFile(
    recipePath,
    `const recipe = {
  schemaVersion: 1,
  outputs: {
    minimal: {
      file: ${JSON.stringify(outputPath)},
      buildDocument() {
        return {
          format: "sunvox-structured-text-v1",
          magic: "SVOX",
          headerTailHex: "00000000",
          project: { name: "Generated Music Source Probe", bpm: 110, speed: 6 },
          patterns: [{ name: "Probe", tracks: 1, lines: 4, events: [] }],
          modules: [{ flags: { exists: true, output: true }, name: "Output" }],
          trailingChunks: []
        };
      }
    }
  }
};

export default recipe;
`,
    "utf8",
  );

  try {
    await runMusicRecipe(recipePath);
    const data = await collectSiteData([musicDir], { musicRecipeRoots: [recipeDir], editRecipeRoots: [] });
    assert.equal(data.projects.length, 1);
    assert.equal(data.projects[0].path, outputPath);
    assert.deepEqual(data.projects[0].sourceRecipe, {
      path: recipePath.replaceAll("\\", "/"),
      name: "minimal-music.mjs",
    });
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
  const fixtureRoot = "var/site-data-preview-fixture";
  const fixturePath = "Preview Fixture.sunsynth";
  await rm(fixtureRoot, { recursive: true, force: true });
  await mkdir(fixtureRoot, { recursive: true });

  try {
    await writeFile(
      join(fixtureRoot, fixturePath),
      buildContainer({
        format: TEXT_FORMAT,
        magic: "SSYN",
        headerTailHex: "00000000",
        module: {
          name: "Preview Fixture",
          type: "FMX",
          flags: { exists: true, generator: true },
        },
      }),
    );

    const defaultData = await collectSiteData();
    const previewData = await collectSiteData(mergeRootLists(DEFAULT_ROOTS, [fixtureRoot]));
    const expectedDefaultProjectCount = (await findSunVoxFiles(DEFAULT_ROOTS)).length;
    const projectPath = `${fixtureRoot}/${fixturePath}`;

    assert.equal(defaultData.projects.length, expectedDefaultProjectCount);
    assert.equal(defaultData.sourceRoots.includes(fixtureRoot), false);
    assert.equal(defaultData.projects.some((project) => project.path === projectPath), false);

    assert.equal(previewData.sourceRoots.includes(fixtureRoot), true);
    assert.equal(previewData.projects.length, defaultData.projects.length + 1);
    const previewProject = previewData.projects.find((project) => project.path === projectPath);
    assert.ok(previewProject);
    assert.equal(previewProject.type, "synth");
    assert.equal(previewProject.synth.name, "Preview Fixture");
    assert.deepEqual(previewProject.catalog.deployment, {
      status: "preview-only",
      deploy: false,
      previewOnly: true,
      root: fixtureRoot,
    });
    assert.equal(previewProject.catalog.measurement.input.id, "C4:96:0.25s");
    assert.equal(previewProject.catalog.measurement.sourceFile, projectPath);
  } finally {
    await rm(fixtureRoot, { recursive: true, force: true });
  }
});

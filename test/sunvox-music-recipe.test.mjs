import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { parseContainer } from "../tools/sunvox-codec.mjs";
import { loadMusicRecipe, runMusicRecipe } from "../tools/sunvox-music-recipe.mjs";

function recipeSource(outputPath, summaryPath) {
  return `// @ts-check

/** @satisfies {import("${resolve("tools/sunvox-music-recipe.d.ts").replaceAll("\\", "/")}").SunVoxMusicRecipe} */
const recipe = {
  schemaVersion: 1,
  tags: ["research:test-music"],
  issue: 38,
  outputs: {
    minimal: {
      file: ${JSON.stringify(outputPath)},
      summaryFile: ${JSON.stringify(summaryPath)},
      buildDocument() {
        return {
          format: "sunvox-structured-text-v1",
          magic: "SVOX",
          headerTailHex: "00000000",
          project: { name: "Music Recipe Probe", bpm: 100, speed: 6 },
          patterns: [
            {
              name: "Probe",
              position: { x: 0, y: 0 },
              tracks: 1,
              lines: 4,
              events: [{ line: 0, track: 0, note: "C4", module: 1, velocity: 112 }]
            }
          ],
          modules: [
            { flags: { exists: true, output: true }, name: "Output", inputs: [{ slot: 0, module: 1 }] },
            { type: "Generator", name: "Tone", position: { x: 128, y: 0 } }
          ],
          trailingChunks: []
        };
      }
    }
  }
};

export default recipe;
`;
}

test("SunVox Music Recipe creates a validated SunVox project and summary", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sunvox-music-recipe-"));
  const outputPath = join(tempDir, "music-recipe-probe.sunvox");
  const summaryPath = join(tempDir, "music-recipe-probe.summary.json");
  const recipePath = join(tempDir, "recipe.mjs");
  await writeFile(recipePath, recipeSource(outputPath, summaryPath), "utf8");

  assert.deepEqual(Object.keys((await loadMusicRecipe(recipePath)).outputs), ["minimal"]);

  const outputs = await runMusicRecipe(recipePath);
  assert.deepEqual(outputs.map((output) => output.outputPath), [outputPath]);
  assert.deepEqual(outputs.map((output) => output.summaryPath), [summaryPath]);

  const document = parseContainer(await readFile(outputPath));
  assert.equal(document.project.name, "Music Recipe Probe");
  assert.equal(document.project.bpm, 100);
  assert.equal(document.modules[1].name, "Tone");
  assert.equal(document.patterns[0].events.length, 1);

  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  assert.equal(summary.recipe.issue, 38);
  assert.deepEqual(summary.recipe.tags, ["research:test-music"]);
  assert.equal(summary.project.events, 1);
  assert.deepEqual(summary.validation, { ok: true, issues: [] });
});

test("checked-in SunVox Music Recipes reproduce generated music byte-for-byte", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sunvox-music-recipe-generated-"));
  const recipeFiles = [
    "generated/recipes/music/short-video-bgm.mjs",
    "generated/recipes/music/podcast-bed-loop.mjs",
    "generated/recipes/music/podcast-purpose-pack.mjs",
  ];
  const outputs = [];
  for (const recipeFile of recipeFiles) {
    outputs.push(...await runMusicRecipe(recipeFile, { outDir: tempDir }));
  }

  assert.deepEqual(
    outputs.map((output) => output.outputPath.replaceAll("\\", "/").replace(`${tempDir.replaceAll("\\", "/")}/`, "")).sort(),
    [
      "generated/music/first-hook-loop.sunvox",
      "generated/music/narration-lofi-bed.sunvox",
      "generated/music/podcast-ad-read-bed.sunvox",
      "generated/music/podcast-bed-loop.sunvox",
      "generated/music/podcast-cold-open-title.sunvox",
      "generated/music/podcast-outro-credits.sunvox",
      "generated/music/podcast-section-transition.sunvox",
      "generated/music/tech-demo-stinger.sunvox",
    ],
  );

  for (const output of outputs) {
    const relativeOutput = output.outputPath
      .replaceAll("\\", "/")
      .replace(`${tempDir.replaceAll("\\", "/")}/`, "");
    assert.deepEqual(await readFile(output.outputPath), await readFile(relativeOutput), relativeOutput);
    assert.ok(output.summaryPath, `${relativeOutput} writes a summary`);
    const summary = JSON.parse(await readFile(output.summaryPath, "utf8"));
    assert.equal(summary.recipe.issue, 38);
    assert.equal(summary.validation.ok, true);
    assert.ok(summary.project.events > 0);
  }
});

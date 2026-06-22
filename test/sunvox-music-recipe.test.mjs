import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { parseContainer } from "../tools/sunvox-codec.mjs";
import { loadMusicRecipe, runMusicRecipe, runMusicRecipes } from "../tools/sunvox-music-recipe.mjs";

const execFileAsync = promisify(execFile);

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
  assert.equal(document.patterns[0].ySize, 32);
  assert.deepEqual(document.patterns[0].flags, {});
  assert.equal(document.patterns[0].foreground, "#000000");
  assert.equal(document.patterns[0].background, "#ffffff");
  assert.deepEqual(document.patterns[0].infoFlags, {});
  assert.equal(document.patterns[0].events.length, 1);

  const summary = JSON.parse(await readFile(summaryPath, "utf8"));
  assert.equal(summary.recipe.issue, 38);
  assert.deepEqual(summary.recipe.tags, ["research:test-music"]);
  assert.equal(summary.project.events, 1);
  assert.deepEqual(summary.validation, { ok: true, issues: [] });
});

test("SunVox Music Recipe CLI accepts multiple recipe files", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sunvox-music-recipe-cli-"));
  const outputA = join(tempDir, "music-recipe-cli-a.sunvox");
  const outputB = join(tempDir, "music-recipe-cli-b.sunvox");
  const recipeA = join(tempDir, "recipe-a.mjs");
  const recipeB = join(tempDir, "recipe-b.mjs");
  await writeFile(recipeA, recipeSource(outputA, join(tempDir, "music-recipe-cli-a.summary.json")), "utf8");
  await writeFile(recipeB, recipeSource(outputB, join(tempDir, "music-recipe-cli-b.summary.json")), "utf8");

  const { stdout } = await execFileAsync(process.execPath, [
    resolve("tools/sunvox-music-recipe.mjs"),
    recipeA,
    recipeB,
  ]);

  assert.deepEqual(
    stdout.trim().split(/\r?\n/).sort(),
    [outputA, outputB].map((outputPath) => relative(process.cwd(), outputPath).replaceAll("\\", "/")).sort(),
  );
  assert.equal(parseContainer(await readFile(outputA)).project.name, "Music Recipe Probe");
  assert.equal(parseContainer(await readFile(outputB)).project.name, "Music Recipe Probe");
});

test("checked-in SunVox Music Recipes reproduce generated music byte-for-byte", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sunvox-music-recipe-generated-"));
  const recipeDir = "generated/recipes/music";
  const recipeFiles = (await readdir(recipeDir))
    .filter((file) => file.endsWith(".mjs"))
    .sort()
    .map((file) => join(recipeDir, file));
  assert.ok(recipeFiles.length > 0);

  const expectedOutputPaths = [];
  const expectedIssueByOutputPath = new Map();
  for (const recipeFile of recipeFiles) {
    const recipe = await loadMusicRecipe(recipeFile, { cacheBust: true });
    expectedOutputPaths.push(...Object.values(recipe.outputs).map((output) => output.file.replaceAll("\\", "/")));
    for (const output of Object.values(recipe.outputs)) {
      expectedIssueByOutputPath.set(output.file.replaceAll("\\", "/"), recipe.issue);
    }
  }
  const outputs = await runMusicRecipes(recipeFiles, { outDir: tempDir, cacheBust: true });

  assert.deepEqual(
    outputs.map((output) => output.outputPath.replaceAll("\\", "/").replace(`${tempDir.replaceAll("\\", "/")}/`, "")).sort(),
    expectedOutputPaths.sort(),
  );

  for (const output of outputs) {
    const relativeOutput = output.outputPath
      .replaceAll("\\", "/")
      .replace(`${tempDir.replaceAll("\\", "/")}/`, "");
    assert.deepEqual(await readFile(output.outputPath), await readFile(relativeOutput), relativeOutput);
    assert.ok(output.summaryPath, `${relativeOutput} writes a summary`);
    const summary = JSON.parse(await readFile(output.summaryPath, "utf8"));
    assert.equal(summary.recipe.issue, expectedIssueByOutputPath.get(relativeOutput));
    assert.equal(summary.validation.ok, true);
    assert.ok(summary.project.events > 0);
  }
});

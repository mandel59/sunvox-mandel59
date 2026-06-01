import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { runEditRecipe } from "../tools/sunvox-edit-recipe.mjs";
import { parseContainer } from "../tools/sunvox-codec.mjs";

async function parseFile(filePath) {
  return parseContainer(await readFile(filePath));
}

test("SunVox Edit Recipe creates a SunSynth with type-only recipe imports", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sunvox-edit-recipe-create-"));
  const outputPath = join(tempDir, "edit-recipe-scratch.sunsynth");
  const recipePath = join(tempDir, "recipe.mjs");
  const recipeSource = `// @ts-check

/** @satisfies {import("${resolve("tools/sunvox-edit-recipe.d.ts").replaceAll("\\", "/")}").SunVoxEditRecipe} */
const recipe = {
  schemaVersion: 1,
  outputs: {
    scratch: {
      kind: "sunsynth",
      file: ${JSON.stringify(outputPath)},
      create: { kind: "metaModule", name: "Edit Recipe Scratch", color: "#ffaa44" },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput({ position: { x: 640, y: 512, z: 0 } });
        const input = project.addModule("MultiSynth", {
          id: "noteInput",
          name: "Note Input",
          position: { x: 0, y: 512, z: 0 }
        });
        synth.setInputModule(input);
        const tone = project.addModule("Analog generator", {
          id: "tone",
          name: "Tone",
          controllers: { waveform: "saw", volume: 120, release: 24 }
        });
        project.connect(input, tone);
        project.connect(tone, project.output);
        synth.expose("Tone volume", tone, "volume");
      }
    }
  }
};

export default recipe;
`;
  await writeFile(recipePath, recipeSource, "utf8");

  assert.doesNotMatch(recipeSource, /^import\s/u);
  assert.deepEqual(await runEditRecipe(recipePath), [outputPath]);

  const document = await parseFile(outputPath);
  const project = document.module.dataChunks.find((chunk) => chunk.name === "embeddedProject").container;

  assert.equal(document.module.name, "Edit Recipe Scratch");
  assert.equal(document.module.color, "#ffaa44");
  assert.equal(document.module.controllers.inputModule, 1);
  assert.equal(project.modules[0].name, "Output");
  assert.deepEqual(project.modules[0].position, { x: 640, y: 512, z: 0 });
  assert.equal(project.modules[1].type, "MultiSynth");
  assert.equal(project.modules[1].name, "Note Input");
  assert.equal(project.modules[2].name, "Tone");
  assert.deepEqual(project.modules[0].inputs.map((link) => [link.slot, link.module]), [[0, 2]]);
  assert.deepEqual(project.modules[2].inputs.map((link) => [link.slot, link.module]), [[0, 1]]);
  assert.equal(document.module.controllers.user[0]._label, "Tone volume");
  assert.equal(document.module.controllers.user[0].value, 120);
});

test("SunVox Edit Recipe edits a SunSynth input asset", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sunvox-edit-recipe-edit-"));
  const outputPath = join(tempDir, "edited-supersaw.sunsynth");
  const recipePath = join(tempDir, "recipe.mjs");
  await writeFile(
    recipePath,
    `// @ts-check

/** @satisfies {import("${resolve("tools/sunvox-edit-recipe.d.ts").replaceAll("\\", "/")}").SunVoxEditRecipe} */
const recipe = {
  schemaVersion: 1,
  inputs: {
    superSaw: { kind: "sunsynth", path: ${JSON.stringify(resolve("instruments/mandel59 SuperSaw.sunsynth"))} }
  },
  outputs: {
    edited: {
      kind: "sunsynth",
      file: ${JSON.stringify(outputPath)},
      from: "superSaw",
      apply(synth) {
        synth.rootModule.controllers.set({ volume: 192 });
        synth.embeddedProject()
          .findModule({ name: "Filter Pro", type: "Filter Pro" })
          .controllers.set({ freq: 6600, q: 9000 });
      }
    }
  }
};

export default recipe;
`,
    "utf8",
  );

  assert.deepEqual(await runEditRecipe(recipePath), [outputPath]);

  const document = await parseFile(outputPath);
  const project = document.module.dataChunks.find((chunk) => chunk.name === "embeddedProject").container;

  assert.equal(document.module.controllers.volume, 192);
  assert.equal(project.modules[2].name, "Filter Pro");
  assert.equal(project.modules[2].controllers.freq, 6600);
  assert.equal(project.modules[2].controllers.q, 9000);
});

test("checked-in SunVox Edit Recipe scratch example generates a SunSynth", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sunvox-edit-recipe-example-"));
  const outputPath = join(tempDir, "var/synth-lab/Scratch Analog Edit Recipe.sunsynth");

  assert.deepEqual(
    await runEditRecipe("generated/recipes/sunvox-edit/scratch-analog.mjs", { outDir: tempDir }),
    [outputPath],
  );

  const document = await parseFile(outputPath);
  const project = document.module.dataChunks.find((chunk) => chunk.name === "embeddedProject").container;

  assert.equal(document.module.name, "Scratch Analog Edit Recipe");
  assert.equal(document.module.color, "#ff9a4a");
  assert.equal(document.module.controllers.inputModule, 1);
  assert.equal(project.modules[0].name, "Output");
  assert.equal(project.modules[1].name, "Note Input");
  assert.equal(project.modules[1].type, "MultiSynth");
  assert.equal(project.modules[2].name, "Tone");
  assert.equal(project.modules[2].controllers.waveform, "saw");
  assert.deepEqual(project.modules[0].inputs.map((link) => [link.slot, link.module]), [[0, 2]]);
});

test("SunVox Edit Recipe disconnects module links", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sunvox-edit-recipe-disconnect-"));
  const outputPath = join(tempDir, "disconnect.sunsynth");
  const recipePath = join(tempDir, "recipe.mjs");
  await writeFile(
    recipePath,
    `// @ts-check

/** @satisfies {import("${resolve("tools/sunvox-edit-recipe.d.ts").replaceAll("\\", "/")}").SunVoxEditRecipe} */
const recipe = {
  schemaVersion: 1,
  outputs: {
    disconnect: {
      kind: "sunsynth",
      file: ${JSON.stringify(outputPath)},
      create: { kind: "metaModule", name: "Disconnect Probe" },
      apply(synth) {
        const project = synth.embeddedProject();
        const noteInput = project.addModule("MultiSynth", { id: "noteInput", name: "Note Input" });
        synth.setInputModule(noteInput);
        const tone = project.addModule("Analog generator", { id: "tone", name: "Tone" });
        const amp = project.addModule("Amplifier", { id: "amp", name: "Amp" });
        project.connect(noteInput, tone);
        project.connect(tone, project.output, { slot: 0 });
        project.connect(tone, amp);
        project.connect(amp, project.output, { slot: 1 });
        const removed = project.disconnect(tone, project.output);
        if (removed !== 1) {
          throw new Error("Expected one removed link, got " + removed);
        }
      }
    }
  }
};

export default recipe;
`,
    "utf8",
  );

  assert.deepEqual(await runEditRecipe(recipePath), [outputPath]);

  const document = await parseFile(outputPath);
  const project = document.module.dataChunks.find((chunk) => chunk.name === "embeddedProject").container;

  assert.deepEqual(project.modules[0].inputs.map((link) => [link.slot, link.module]), [[1, 3]]);
  assert.deepEqual(project.modules[2].inputs.map((link) => [link.slot, link.module]), [[0, 1]]);
  assert.deepEqual(project.modules[3].inputs.map((link) => [link.slot, link.module]), [[0, 2]]);
});

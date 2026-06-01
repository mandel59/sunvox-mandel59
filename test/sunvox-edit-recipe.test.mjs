import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import { runEditRecipe } from "../tools/sunvox-edit-recipe.mjs";
import { migrateSunSynthRecipe } from "../tools/sunvox-edit-recipe-migrate.mjs";
import { runRecipe } from "../tools/sunsynth-generate.mjs";
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
      create: { module: "MetaModule", name: "Edit Recipe Scratch", color: "#ffaa44" },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput({ position: { x: 640, y: 512, z: 0 } });
        const input = project.addModule("MultiSynth", {
          name: "Note Input",
          position: { x: 0, y: 512, z: 0 }
        });
        synth.setInputModule(input);
        const tone = project.addModule("Analog generator", {
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
  const outputPath = join(tempDir, "var/synth-lab/Scratch Analog.sunsynth");

  assert.deepEqual(
    await runEditRecipe("generated/recipes/sunvox-edit/scratch-analog.mjs", { outDir: tempDir }),
    [outputPath],
  );

  const document = await parseFile(outputPath);
  const project = document.module.dataChunks.find((chunk) => chunk.name === "embeddedProject").container;

  assert.equal(document.module.name, "Scratch Analog");
  assert.equal(document.module.color, "#ff9a4a");
  assert.equal(document.module.controllers.inputModule, 1);
  assert.equal(project.modules[0].name, "Output");
  assert.equal(project.modules[1].name, "Note Input");
  assert.equal(project.modules[1].type, "MultiSynth");
  assert.equal(project.modules[2].name, "Tone");
  assert.equal(project.modules[2].controllers.waveform, "saw");
  assert.deepEqual(project.modules[0].inputs.map((link) => [link.slot, link.module]), [[0, 2]]);
});

test("checked-in SunVox Edit Recipes generate SunSynth outputs", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sunvox-edit-recipe-checked-in-"));
  const recipeDir = "generated/recipes/sunvox-edit";
  const recipeFiles = (await readdir(recipeDir))
    .filter((file) => file.endsWith(".mjs"))
    .sort()
    .map((file) => join(recipeDir, file));

  assert.deepEqual(
    recipeFiles.map((file) => file.replaceAll("\\", "/")),
    [
      "generated/recipes/sunvox-edit/scratch-analog.mjs",
      "generated/recipes/sunvox-edit/scratch-assorted-instruments.mjs",
      "generated/recipes/sunvox-edit/scratch-fmx.mjs",
      "generated/recipes/sunvox-edit/scratch-layered-pad.mjs",
      "generated/recipes/sunvox-edit/supersaw-variants.mjs",
    ],
  );

  const outputs = [];
  for (const recipeFile of recipeFiles) {
    outputs.push(...await runEditRecipe(recipeFile, { outDir: tempDir }));
  }

  assert.deepEqual(
    outputs.map((output) => output.replaceAll("\\", "/").replace(`${tempDir.replaceAll("\\", "/")}/`, "")).sort(),
    [
      "var/synth-lab/mandel59 Lab Bright SuperSaw F6400 Q12288.sunsynth",
      "var/synth-lab/mandel59 Lab Bright SuperSaw F7600 Q12288.sunsynth",
      "var/synth-lab/mandel59 Lab Soft SuperSaw F3200 R2400.sunsynth",
      "var/synth-lab/mandel59 Lab Soft SuperSaw F3200 R3600.sunsynth",
      "var/synth-lab/mandel59 Lab Soft SuperSaw F4200 R2400.sunsynth",
      "var/synth-lab/mandel59 Lab Soft SuperSaw F4200 R3600.sunsynth",
      "var/synth-lab/Scratch Acid Bass.sunsynth",
      "var/synth-lab/Scratch Analog.sunsynth",
      "var/synth-lab/Scratch FMX Pluck.sunsynth",
      "var/synth-lab/Scratch FMX Tines.sunsynth",
      "var/synth-lab/Scratch Glass Bell.sunsynth",
      "var/synth-lab/Scratch Kick Snap.sunsynth",
      "var/synth-lab/Scratch Layered Pad.sunsynth",
      "var/synth-lab/Scratch PWM Organ.sunsynth",
    ].sort(),
  );

  const layeredPad = await parseFile(join(tempDir, "var/synth-lab/Scratch Layered Pad.sunsynth"));
  const layeredProject = layeredPad.module.dataChunks.find((chunk) => chunk.name === "embeddedProject").container;
  assert.equal(layeredPad.module.name, "Scratch Layered Pad");
  assert.equal(layeredProject.modules[1].name, "Note Input");
  assert.equal(layeredProject.modules.at(-1).name, "Soft Glue");
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
      create: { module: "MetaModule", name: "Disconnect Probe" },
      apply(synth) {
        const project = synth.embeddedProject();
        const noteInput = project.addModule("MultiSynth", { name: "Note Input" });
        synth.setInputModule(noteInput);
        const tone = project.addModule("Analog generator", { name: "Tone" });
        const amp = project.addModule("Amplifier", { name: "Amp" });
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

test("SunVox Edit Recipe removes a module without compacting slots", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sunvox-edit-recipe-remove-module-"));
  const outputPath = join(tempDir, "remove-module.sunsynth");
  const recipePath = join(tempDir, "recipe.mjs");
  await writeFile(
    recipePath,
    `// @ts-check

/** @satisfies {import("${resolve("tools/sunvox-edit-recipe.d.ts").replaceAll("\\", "/")}").SunVoxEditRecipe} */
const recipe = {
  schemaVersion: 1,
  outputs: {
    removeModule: {
      kind: "sunsynth",
      file: ${JSON.stringify(outputPath)},
      create: { module: "MetaModule", name: "Remove Module Probe" },
      apply(synth) {
        const project = synth.embeddedProject();
        const noteInput = project.addModule("MultiSynth", { name: "Note Input" });
        synth.setInputModule(noteInput);
        const tone = project.addModule("Analog generator", { name: "Tone" });
        const amp = project.addModule("Amplifier", { name: "Amp" });
        project.connect(noteInput, tone);
        project.connect(tone, amp);
        project.connect(amp, project.output);
        const removed = project.removeModule(amp);
        if (removed !== 3) {
          throw new Error("Expected slot 3 to be removed, got " + removed);
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

  assert.equal(project.modules.length, 4);
  assert.equal(project.modules[3].name, undefined);
  assert.equal(project.modules[3].type, undefined);
  assert.equal(project.modules[0].inputs, undefined);
  assert.deepEqual(project.modules[2].inputs.map((link) => [link.slot, link.module]), [[0, 1]]);
});

test("migrates a scratch SunSynthRecipe to SunVox Edit Recipe", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sunvox-edit-recipe-migrate-"));
  const migratedRecipePath = join(tempDir, "scratch-analog.edit-recipe.mjs");
  const legacyDir = join(tempDir, "legacy");
  const editDir = join(tempDir, "edit");
  const outputPath = join(editDir, "var/synth-lab/Scratch Analog.sunsynth");

  assert.equal(
    await migrateSunSynthRecipe("generated/recipes/sunsynth/scratch-analog.mjs", { out: migratedRecipePath }),
    migratedRecipePath,
  );
  const migratedSource = await readFile(migratedRecipePath, "utf8");
  assert.doesNotMatch(migratedSource, /^import\s/u);
  assert.match(migratedSource, /SunVoxEditRecipe/u);
  assert.match(migratedSource, /setInputModule/u);

  const legacyOutputs = await runRecipe("generated/recipes/sunsynth/scratch-analog.mjs", { outDir: legacyDir });
  assert.deepEqual(await runEditRecipe(migratedRecipePath, { outDir: editDir }), [outputPath]);
  assert.deepEqual(await readFile(outputPath), await readFile(legacyOutputs[0]), "Scratch Analog.sunsynth binary");

  const document = await parseFile(outputPath);
  const project = document.module.dataChunks.find((chunk) => chunk.name === "embeddedProject").container;

  assert.equal(document.module.name, "Scratch Analog");
  assert.equal(document.module.color, "#ff9a4a");
  assert.equal(document.module.controllers.inputModule, 1);
  assert.equal(project.modules[1].name, "Note Input");
  assert.equal(project.modules[2].name, "Tone");
  assert.equal(project.modules[2].controllers.volume, 128);
  assert.deepEqual(project.modules[0].inputs.map((link) => [link.slot, link.module]), [[0, 2]]);
});

test("migrated checked-in Edit Recipes preserve legacy recipe output", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sunvox-edit-recipe-equivalence-"));
  const pairs = [
    "scratch-analog.mjs",
    "scratch-assorted-instruments.mjs",
    "scratch-fmx.mjs",
    "scratch-layered-pad.mjs",
    "supersaw-variants.mjs",
  ];

  for (const fileName of pairs) {
    const legacyDir = join(tempDir, "legacy", fileName);
    const editDir = join(tempDir, "edit", fileName);
    const legacyOutputs = await runRecipe(join("generated/recipes/sunsynth", fileName), { outDir: legacyDir });
    const editOutputs = await runEditRecipe(join("generated/recipes/sunvox-edit", fileName), { outDir: editDir });

    assert.deepEqual(
      editOutputs.map((filePath) => filePath.split(/[\\/]/u).at(-1)).sort(),
      legacyOutputs.map((filePath) => filePath.split(/[\\/]/u).at(-1)).sort(),
      fileName,
    );

    for (const legacyOutput of legacyOutputs) {
      const outputName = legacyOutput.split(/[\\/]/u).at(-1);
      const editOutput = editOutputs.find((filePath) => filePath.split(/[\\/]/u).at(-1) === outputName);
      const editBytes = await readFile(editOutput);
      const legacyBytes = await readFile(legacyOutput);
      assert.deepEqual(editBytes, legacyBytes, `${outputName} binary`);
      assert.deepEqual(
        parseContainer(editBytes),
        parseContainer(legacyBytes),
        outputName,
      );
    }
  }
});

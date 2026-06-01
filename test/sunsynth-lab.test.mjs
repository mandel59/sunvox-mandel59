import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { loadSunsynthTemplate, SunSynthLab } from "../tools/sunsynth-lab.mjs";
import { parseContainer } from "../tools/sunvox-codec.mjs";

async function parseFile(filePath) {
  return parseContainer(await readFile(filePath));
}

test("edits a SunSynth template through lab helpers", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sunsynth-lab-"));
  const outputPath = join(tempDir, "lab-pad.sunsynth");
  const template = await loadSunsynthTemplate("instruments/mandel59 SuperSaw.sunsynth");

  await template
    .clone()
    .rename("Lab Pad")
    .setRootControllers({ volume: 192 })
    .module("Filter Pro")
    .set({ freq: 6400, q: 9200 })
    .setModulesByType("Analog generator", (_module, _index, ordinal) => ({ volume: 80 + ordinal }))
    .userController("Detune 1")
    .set({ label: "Lab spread", value: 7777, group: 6 })
    .writeSunsynth(outputPath);

  const document = await parseFile(outputPath);
  const project = document.module.dataChunks.find((chunk) => chunk.name === "embeddedProject").container;

  assert.equal(document.module.name, "Lab Pad");
  assert.equal(document.module.controllers.volume, 192);
  assert.equal(document.module.controllers.user[0].value, 7777);
  assert.equal(document.module.controllers.user[0]._label, "Lab spread");
  assert.equal(document.module.dataChunks.find((chunk) => chunk.name === "userControllerName").label, "Lab spread");
  assert.equal(project.project.name, "Lab Pad");
  assert.equal(project.modules[2].controllers.freq, 6400);
  assert.equal(project.modules[2].controllers.q, 9200);
  assert.equal(project.modules[3].controllers.volume, 80);
  assert.equal(project.modules[4].controllers.volume, 81);
});

test("uses fluent module and user-controller handles", async () => {
  const template = await loadSunsynthTemplate("instruments/mandel59 SuperSaw.sunsynth");
  const synth = template.clone();

  synth
    .module("Filter Pro")
    .set({ freq: 6500 })
    .userController("Filter freq")
    .set(6500)
    .userController("Release")
    .set({ value: 2400 });

  assert.equal(synth.module("Filter Pro").get("freq"), 6500);
  assert.equal(synth.userController("Filter freq").get(), 6500);
  assert.equal(synth.userController("Release").get(), 2400);
});

test("creates a playable SunSynth from scratch", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sunsynth-scratch-"));
  const outputPath = join(tempDir, "scratch.sunsynth");

  await SunSynthLab.create("Scratch Analog", { color: "#ff9a4a" })
    .addModule("MultiSynth", { name: "Note Input", position: { x: 0, y: 512, z: 0 } })
    .setInputModule("Note Input")
    .addModule("Analog generator", {
      name: "Tone",
      controllers: { waveform: "saw", volume: 128, release: 32, polyphony: 8 },
    })
    .connect("Note Input", "Tone")
    .connect("Tone", "Output")
    .exposeController("Tone volume", "Tone", "volume")
    .exposeController("Tone release", "Tone", "release")
    .writeSunsynth(outputPath);

  const document = await parseFile(outputPath);
  const project = document.module.dataChunks.find((chunk) => chunk.name === "embeddedProject").container;
  const controllerLinks = document.module.dataChunks.find((chunk) => chunk.name === "controllerLinks");
  const options = document.module.dataChunks.find((chunk) => chunk.name === "options");

  assert.equal(document.module.name, "Scratch Analog");
  assert.equal(document.module.color, "#ff9a4a");
  assert.equal(document.module.controllers.inputModule, 1);
  assert.equal(document.module.controllers.user[0]._label, "Tone volume");
  assert.equal(document.module.controllers.user[0].value, 128);
  assert.equal(document.module.controllers.user[1]._label, "Tone release");
  assert.equal(document.module.controllers.user[1].value, 32);
  assert.equal(document.module.dataChunkCount, 10);
  assert.equal(options.options.userControllers, 2);
  assert.deepEqual(controllerLinks.links.map((link) => [link.index, link.module, link.controller]), [
    [0, 2, 0],
    [1, 2, 4],
  ]);
  assert.equal(project.modules[0].name, "Output");
  assert.equal(project.modules[1].type, "MultiSynth");
  assert.equal(project.modules[1].name, "Note Input");
  assert.equal(project.modules[2].type, "Analog generator");
  assert.deepEqual(project.modules[0].inputs.map((link) => [link.slot, link.module]), [[0, 2]]);
  assert.deepEqual(project.modules[2].inputs.map((link) => [link.slot, link.module]), [[0, 1]]);
});

test("configures the default scratch Output module instead of adding one", () => {
  const synth = SunSynthLab.create("Scratch Output", {
    output: { position: { x: 640, y: 512, z: 0 }, color: "#222222" },
  });

  synth.setOutput({ position: { x: 1024, y: 512, z: 0 }, color: "#444444" }).setOutput();
  const project = synth.embeddedProject();

  assert.equal(project.modules.length, 1);
  assert.equal(project.modules[0].name, "Output");
  assert.deepEqual(project.modules[0].flags, { exists: true, output: true, initialized: true });
  assert.deepEqual(project.modules[0].position, { x: 1024, y: 512, z: 0 });
  assert.equal(project.modules[0].color, "#444444");
});

test("creates a root module SunSynth from scratch", async () => {
  const tempDir = await mkdtemp(join(tmpdir(), "sunsynth-root-module-"));
  const outputPath = join(tempDir, "root-fmx.sunsynth");

  await SunSynthLab.createModule("FMX", {
    name: "Root FMX",
    controllers: {
      volume: 12000,
      sampleRate: "native",
      channels: "stereo",
      polyphony: 8,
      operators: [
        { volume: 32768, release: 420, outputMode: 0 },
        { volume: 12000, decay: 1800, release: 220, freqMul: 2000, outputMode: 8 },
      ],
    },
  }).writeSunsynth(outputPath);

  const document = await parseFile(outputPath);

  assert.equal(document.magic, "SSYN");
  assert.equal(document.module.name, "Root FMX");
  assert.equal(document.module.type, "FMX");
  assert.equal(document.module.dataChunks?.find((chunk) => chunk.name === "embeddedProject"), undefined);
  assert.equal(document.module.controllers.volume, 12000);
  assert.equal(document.module.controllers.operators[0].release, 420);
  assert.equal(document.module.controllers.operators[1].freqMul, 2000);
  assert.equal(document.module.controllers.operators[4].waveform, "sin");
});

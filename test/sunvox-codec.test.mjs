import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  buildContainer,
  decode,
  decodeChunkData,
  encode,
  parseContainer,
  parseEditableContainer,
  parseVerboseContainer,
  sha256,
} from "../tools/sunvox-codec.mjs";

test("parses project into structured metadata", async () => {
  const buffer = await readFile("music/2022-04-17.sunvox");
  const document = parseContainer(buffer);

  assert.equal(document.magic, "SVOX");
  assert.equal(document.format, "sunvox-structured-text-v1");
  assert.equal(document.project.name, "2022-04-17 03-24");
  assert.equal(document.project.version, 33554437);
  assert.equal(document.project.bpm, 125);
  assert.equal(document.project.speed, 6);
  assert.equal(document.project.chunks, undefined);
  assert.ok(document.patterns.length > 0);
  assert.ok(document.modules.length > 0);
  assert.equal(document.patterns.some((pattern) => Array.isArray(pattern.chunks)), false);
  assert.equal(document.modules.some((module) => Array.isArray(module.chunks)), false);
});

test("parses synth into a structured module", async () => {
  const buffer = await readFile("instruments/mandel59 shepard.sunsynth");
  const document = parseContainer(buffer);

  assert.equal(document.magic, "SSYN");
  assert.equal(document.module.name, "Shepard tone");
  assert.equal(document.module.type, "MetaModule");
  assert.match(document.module.color ?? "", /^#[0-9a-f]{6}$/);
  assert.equal(document.module.chunks, undefined);
  assert.equal(document.module.dataChunks[0].name, "embeddedProject");
  assert.equal(document.module.dataChunks[0].container.magic, "SVOX");
  assert.equal(document.module.dataChunks[0].container.project.name, "Shepard tone");
  assert.deepEqual(document.module.midi, {
    inputIndex: 0,
    inputChannel: 0,
    inputBank: -1,
    inputProgram: 4294967295,
  });
  assert.equal(document.module.dataChunks.length, 3);
  assert.deepEqual(document.module.controllers, {
    volume: 160,
    inputModule: 3,
    playPatterns: "off",
    bpm: 125,
    tpl: 6,
  });
  assert.deepEqual(document.module.midiBindings?.[0], {
    type: "none",
    channel: 0,
    mode: "linear",
    parameter: 0,
    min: 0,
    max: 255,
  });
});

test("round-trips editable parsed documents", async () => {
  const buffer = await readFile("music/2022-04-18.sunvox");
  const document = parseContainer(buffer);
  const rebuilt = buildContainer(document);

  assert.equal(sha256(rebuilt), sha256(buffer));
});

test("decodes pattern note data", async () => {
  const buffer = await readFile("music/2022-04-17.sunvox");
  const document = parseContainer(buffer);
  const pattern = document.patterns.find((candidate) => candidate.events);

  assert.ok(Array.isArray(pattern?.events));
  assert.ok(pattern.events.length > 0);
  assert.equal(pattern.events[0].length, 5);
});

test("can still build editable chunk documents", async () => {
  const buffer = await readFile("music/2022-04-17.sunvox");
  const document = parseEditableContainer(buffer);
  const rebuilt = buildContainer(document);

  assert.equal(document.format, "sunvox-editable-text-v1");
  assert.equal(document.chunks[0].value, 33554437);
  assert.equal(sha256(rebuilt), sha256(buffer));
});

test("can still build verbose documents", async () => {
  const buffer = await readFile("music/2022-04-17.sunvox");
  const document = parseVerboseContainer(buffer);
  const rebuilt = buildContainer(document);

  assert.equal(document.format, "sunvox-container-text-v1");
  assert.equal(document.chunks[0]._decoded.kind, "uint32");
  assert.equal(sha256(rebuilt), sha256(buffer));
});

test("encode and decode files through JSON", async () => {
  const source = "instruments/mandel59 SuperSaw.sunsynth";
  const jsonPath = join("var", "test-supersaw.sunsynth.json");
  const roundtripPath = join("var", "test-supersaw.roundtrip.sunsynth");

  await encode(source, jsonPath);
  await decode(jsonPath, roundtripPath);

  const [original, rebuilt] = await Promise.all([readFile(source), readFile(roundtripPath)]);
  assert.equal(sha256(rebuilt), sha256(original));

  await rm(jsonPath, { force: true });
  await rm(roundtripPath, { force: true });
});

test("encodes named MetaModule controller and MIDI binding values", async () => {
  const buffer = await readFile("instruments/mandel59 shepard.sunsynth");
  const document = parseContainer(buffer);

  document.module.controllers.volume = 200;
  document.module.controllers.playPatterns = "repeat";
  document.module.midiBindings[0] = {
    type: "controlChange",
    channel: 2,
    mode: "linear",
    parameter: 74,
    min: 0,
    max: 200,
  };

  const rebuilt = buildContainer(document);
  const reparsed = parseContainer(rebuilt);

  assert.equal(reparsed.module.controllers.volume, 200);
  assert.equal(reparsed.module.controllers.playPatterns, "repeat");
  assert.deepEqual(reparsed.module.midiBindings[0], {
    type: "controlChange",
    channel: 2,
    mode: "linear",
    parameter: 74,
    min: 0,
    max: 200,
  });
});

test("decodes MetaModule controller link and option data chunks", async () => {
  const buffer = await readFile("instruments/mandel59 SuperSaw.sunsynth");
  const document = parseContainer(buffer);
  const links = document.module.dataChunks.find((chunk) => chunk.name === "controllerLinks");
  const options = document.module.dataChunks.find((chunk) => chunk.name === "options");
  const firstName = document.module.dataChunks.find((chunk) => chunk.name === "userControllerName");

  assert.deepEqual(links.links[0], { index: 0, module: 16, controller: 0 });
  assert.equal(options.options.userControllers, 9);
  assert.equal(options.options.eventOutput, true);
  assert.deepEqual(firstName, {
    index: 8,
    name: "userControllerName",
    controller: 0,
    group: 2,
    label: "Detune 1",
  });
});

test("decodes MultiCtl controllers, output slots, and curve", async () => {
  const buffer = await readFile("music/2022-04-17.sunvox");
  const document = parseContainer(buffer);
  const multiCtl = document.modules.find((module) => module.type === "MultiCtl");
  const slots = multiCtl.dataChunks.find((chunk) => chunk.name === "outputSlots");
  const curve = multiCtl.dataChunks.find((chunk) => chunk.name === "curve");

  assert.equal(multiCtl.controllers.value, 958);
  assert.deepEqual(slots.slots, [
    { index: 0, controller: 1 },
    { index: 1, max: 20000, controller: 1 },
  ]);
  assert.equal(curve.values.length, 257);
  assert.deepEqual(curve.values.slice(0, 4), [0, 128, 256, 384]);
});

test("decodes Sound2Ctl controllers and options", async () => {
  const buffer = await readFile("music/2022-04-17.sunvox");
  const document = parseContainer(buffer);
  const sound2Ctl = document.modules.find((module) => module.type === "Sound2Ctl");

  assert.equal(sound2Ctl.controllers.channels, "mono");
  assert.equal(sound2Ctl.controllers.absolute, "off");
  assert.equal(sound2Ctl.controllers.mode, "hq");
  assert.deepEqual(sound2Ctl.dataChunks[0], {
    index: 0,
    name: "options",
    options: {
      recordValues: false,
      sendChangesOnly: true,
    },
  });
});

test("decodes primitive chunk payloads", () => {
  const intData = Buffer.alloc(4);
  intData.writeInt32LE(-12);
  assert.deepEqual(decodeChunkData("SXXX", intData), {
    _description: "module x position",
    kind: "int32",
    value: -12,
  });

  assert.deepEqual(decodeChunkData("SCOL", Buffer.from([1, 2, 3])), {
    _description: "module color",
    kind: "rgb",
    value: { r: 1, g: 2, b: 3, hex: "#010203" },
  });
});

import assert from "node:assert/strict";
import test from "node:test";
import { buildContainer, parseContainer, SUNVOX_DB, TEXT_FORMAT, validateContainer } from "../tools/sunvox-codec.mjs";

function project(type, controllers) {
  return {
    format: TEXT_FORMAT, magic: "SVOX", headerTailHex: "00000000",
    project: { name: "Controller defaults", bpm: 125, speed: 6 }, patterns: [],
    modules: [
      { name: "Output", flags: { exists: true, output: true } },
      { type, name: "Sparse module", controllers },
    ],
  };
}

function roundTrip(type, controllers) {
  return parseContainer(buildContainer(project(type, controllers))).modules[1].controllers;
}

test("direct build fills Amplifier controller gaps from defaults without mutating the patch", () => {
  const controllers = { fineVolume: 32768 };
  assert.deepEqual(roundTrip("Amplifier", controllers), {
    volume: 256, balance: 128, dcOffset: 128, inverse: "off",
    stereoWidth: 128, absolute: "off", fineVolume: 32768,
  });
  assert.deepEqual(controllers, { fineVolume: 32768 });
  assert.equal(validateContainer(project("Amplifier", controllers)).ok, true);
});

test("direct build preserves Delay nonzero and enum defaults before feedback", () => {
  assert.deepEqual(roundTrip("Delay", { feedback: 1000 }), {
    dry: 256, wet: 256, delayL: 128, delayR: 160, volumeL: 256, volumeR: 256,
    channels: "stereo", inverse: "off", delayUnit: "sec16384", delayMultiplier: 1, feedback: 1000,
  });
});

test("direct build expands repeated FMX defaults before a nested operator patch", () => {
  const controllers = roundTrip("FMX", { operators: { 4: { noise: 0 } } });
  assert.equal(controllers.volume, 16384);
  assert.equal(controllers.sampleRate, "hz44100");
  assert.equal(controllers.operators[0].attack, 100);
  assert.equal(controllers.operators[0].sustain, "off");
  assert.equal(controllers.operators[4].sustain, "on");
  assert.equal(controllers.operators[4].noise, 0);
});

test("explicit zero, dense raw arrays and empty controller patches retain their meaning", () => {
  assert.equal(roundTrip("Amplifier", { dcOffset: 0, fineVolume: 0 }).dcOffset, 0);
  assert.equal(roundTrip("Amplifier", { dcOffset: 0, fineVolume: 0 }).fineVolume, 0);
  assert.deepEqual(roundTrip("Amplifier", [0, 0, 0]), { volume: 0, balance: 0, dcOffset: 0 });
  assert.deepEqual(roundTrip("Future module", [0, 128, 42]), [0, 128, 42]);
  assert.equal(roundTrip("Amplifier", {}), undefined);
  assert.equal(roundTrip("Amplifier", undefined), undefined);
});

test("extra indexes fill known defaults and preserve explicit raw zero", () => {
  const controllers = roundTrip("Amplifier", { extra: { 9: 0 } });
  assert.equal(controllers.dcOffset, 128);
  assert.equal(controllers.bipolarDcOffset, 16384);
  assert.deepEqual(controllers.extra, { 9: 0 });
  assert.deepEqual(roundTrip("Future module", { extra: { 0: 0, 1: 42 } }), [0, 42]);
});

test("sparse raw arrays and unknown default gaps fail both validation and encoding", () => {
  for (const [type, controllers, index, highest] of [
    ["Amplifier", [, 128], 0, 1],
    ["Amplifier", [256, undefined, 128], 1, 2],
    ["Amplifier", [256, null, 128], 1, 2],
    ["Future module", { extra: { 2: 0 } }, 0, 2],
    ["Amplifier", { extra: { 10: 0 } }, 9, 10],
    ["MetaModule", { user: [{ index: 1, value: 42 }] }, 5, 6],
  ]) {
    const document = project(type, controllers);
    const result = validateContainer(document);
    assert.equal(result.ok, false);
    const issue = result.issues.find((issue) => issue.trackingIssue === 37);
    assert.equal(issue.severity, "error");
    assert.equal(issue.moduleType, type);
    assert.equal(issue.controllerIndex, index);
    assert.equal(issue.materializedThrough, highest);
    assert.match(issue.message, /modules\[1\].*Sparse module/u);
    assert.throws(() => buildContainer(document), { message: issue.message });
  }
});

test("MetaModule first user controller fills built-in defaults and keeps zero", () => {
  const controllers = roundTrip("MetaModule", { user: [{ index: 0, value: 0 }] });
  assert.equal(controllers.volume, 256);
  assert.equal(controllers.bpm, 125);
  assert.equal(controllers.tpl, 6);
  assert.deepEqual(controllers.extra, { 5: 0 });
});

test("known controller without a DB default fails with its semantic path", () => {
  const type = "__Issue37MissingDefault";
  SUNVOX_DB.modules[type] = { controllers: [
    { index: 0, name: "missingDefault", type: "int32" },
    { index: 1, name: "high", type: "int32", default: 42 },
  ] };
  try {
    const document = project(type, { high: 1 });
    const result = validateContainer(document);
    assert.equal(result.ok, false);
    assert.equal(result.issues[0].path, "modules[1].controllers.missingDefault");
    assert.throws(() => buildContainer(document), /index 0.*through index 1.*no DB default/u);
    assert.deepEqual(roundTrip(type, { missingDefault: 0, high: 1 }), { missingDefault: 0, high: 1 });
  } finally {
    delete SUNVOX_DB.modules[type];
  }
});

test("raw extra, user and positional values reject ambiguous or noninteger input", () => {
  for (const [type, controllers] of [
    ["Amplifier", ["256"]], ["Amplifier", [NaN]], ["Amplifier", [1.5]],
    ["Amplifier", [Infinity]], ["Amplifier", [0x80000000]],
    ["Amplifier", { extra: { 6: null } }], ["Amplifier", { extra: { 6: undefined } }],
    ["Amplifier", { extra: { "-1": 0 } }], ["Amplifier", { extra: { foo: 0 } }],
    ["MetaModule", { user: [{ index: -1, value: 0 }] }],
    ["MetaModule", { user: [{ index: 0 }] }],
  ]) {
    const document = project(type, controllers);
    assert.equal(validateContainer(document).ok, false);
    assert.throws(() => buildContainer(document), /Sparse module.*(?:int32|nonnegative)/u);
  }
});

test("SSYN controller patches use the same default and raw gap semantics", () => {
  const document = {
    format: TEXT_FORMAT, magic: "SSYN", headerTailHex: "00000000",
    module: { name: "Sparse synth", type: "Amplifier", controllers: { fineVolume: 0 } },
  };
  assert.equal(parseContainer(buildContainer(document)).module.controllers.dcOffset, 128);
  document.module.controllers = { extra: { 10: 0 } };
  assert.equal(validateContainer(document).issues[0].path, "module.controllers.extra.9");
  assert.throws(() => buildContainer(document), /module.controllers.extra.9.*Sparse synth/u);
});

test("nested containers report their full controller diagnostic path", () => {
  const document = project("MetaModule", {});
  document.modules[1].dataChunks = [{
    name: "embeddedProject", container: project("Amplifier", { extra: { 10: 1 } }),
  }];
  const result = validateContainer(document);
  assert.equal(result.ok, false);
  assert.match(result.issues[0].path, /^modules\[1\].dataChunks\[0\].container.modules\[1\].controllers/u);
});

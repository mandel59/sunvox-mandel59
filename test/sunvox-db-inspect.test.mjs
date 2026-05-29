import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { buildCoverageFixture } from "../tools/generate-sunvox-coverage-fixtures.mjs";
import {
  collectControllerDiff,
  collectCoverage,
  collectDbCheck,
  collectProjectMetrics,
  collectScaffold,
  collectSourceReport,
} from "../tools/sunvox-db-inspect.mjs";
import { SUNVOX_DB } from "../tools/sunvox-codec.mjs";

test("coverage reports DB module types not exercised by samples", () => {
  const coverage = collectCoverage(["instruments/mandel59 shepard.sunsynth"]);
  const sampledDbTypes = new Set(
    coverage.moduleTypes.map(([moduleType]) => moduleType).filter((moduleType) => SUNVOX_DB.modules[moduleType]),
  );

  for (const moduleType of Object.keys(SUNVOX_DB.modules)) {
    assert.equal(coverage.unusedDbModuleTypes.includes(moduleType), !sampledDbTypes.has(moduleType), moduleType);
  }
});

test("project metrics summarize current coverage and gate state", () => {
  const metrics = collectProjectMetrics();

  assert.equal(metrics.summary.dbModules, Object.keys(SUNVOX_DB.modules).length);
  assert.equal(metrics.summary.sourceModulesMissingFromDb, 0);
  assert.equal(metrics.summary.dbModulesMissingFromSource, 0);
  assert.equal(metrics.summary.controllerMetadataMismatches, 0);
  assert.equal(metrics.summary.dbCheckErrors, 0);
  assert.equal(metrics.summary.moduleLinkIssues, 0);
  assert.equal(metrics.summary.coverageGateFailures, 0);
  assert.equal(metrics.summary.unsampledDbModules, 0);
  assert.equal(metrics.summary.sampleCoveragePercent, 100);
  assert.equal(metrics.summary.chunks, SUNVOX_DB.chunks.length);
  assert.equal(metrics.summary.reviewedChunks, metrics.summary.chunks);
  assert.equal(metrics.summary.chunkStorageReviewPercent, 100);
  assert.ok(metrics.summary.scalarChunks > 0);
  assert.equal(metrics.summary.reviewedScalarChunks, metrics.summary.scalarChunks);
  assert.equal(metrics.summary.scalarChunkStorageReviewPercent, 100);
  assert.ok(metrics.summary.dataChunkLayouts > 0);
  assert.equal(metrics.summary.reviewedDataChunkLayouts, metrics.summary.dataChunkLayouts);
  assert.equal(metrics.summary.dataChunkLayoutReviewPercent, 100);
  assert.deepEqual(
    ["CHFR", "PDTA", "PPAR", "SLnK", "SMIB", "SMIC", "SMIP"].every((chunkId) =>
      metrics.chunkStorage.reviewedChunkIds.includes(chunkId),
    ),
    true,
  );
  assert.equal(metrics.gates.ok, true);
  assert.deepEqual(metrics.unsampledDbModuleTypes, []);
});

test("synthetic coverage fixture is up to date", () => {
  assert.deepEqual(readFileSync("test/fixtures/sunvox/unsampled-modules.sunvox"), buildCoverageFixture());
});

test("controller diff has no metadata mismatches", () => {
  const diff = collectControllerDiff();

  assert.deepEqual(diff.mismatches, []);
});

test("source report summarizes module catalog metadata gaps", () => {
  const report = collectSourceReport();
  const colorGap = report.moduleCatalogGaps.find((gap) => gap.field === "color");
  const amplifier = report.sourceModules.find((module) => module.module === "Amplifier");

  assert.equal(report.sourceModules.length, 42);
  assert.equal(colorGap.sourceModules, 42);
  assert.equal(colorGap.dbModules, 42);
  assert.equal(colorGap.missingDbModules, 0);
  assert.equal(amplifier.color, "#E47FFF");
  assert.equal(amplifier.inputs, 2);
  assert.equal(amplifier.outputs, 2);
  assert.deepEqual(amplifier.flags, ["effect"]);
});

test("scaffold preserves signed, unit, empty, and suffix enum value names", () => {
  const scaffold = collectScaffold("ADSR");

  assert.deepEqual(scaffold.enums.adsr_curve_type, {
    0: "linear",
    1: "exp1",
    2: "exp2",
    3: "negExp1",
    4: "negExp2",
    5: "sin",
    6: "rect",
    7: "smoothRect",
    8: "bit2",
    9: "bit3",
    10: "bit4",
    11: "bit5",
  });

  assert.deepEqual(collectScaffold("Ctl2Note").enums.noteon_mode, {
    0: "none",
    1: "onPitchChange",
  });

  assert.deepEqual(collectScaffold("Modulator").enums.pm_delay_lens, {
    0: "sec004",
    1: "sec008",
    2: "sec02",
    3: "sec05",
    4: "sec1",
    5: "sec2",
    6: "sec4",
    7: "sec8",
    8: "sec16",
    9: "sec32",
  });

  assert.equal(collectScaffold("SpectraVoice").enums.harmonic_type[14], "overtones1Wide");
});

test("DB check validates data chunk ranges and metadata references", () => {
  const moduleName = "__BrokenDbCheckFixture";
  const previousModule = SUNVOX_DB.modules[moduleName];
  const projectFields = SUNVOX_DB.grammar.scopes.project.fields;
  const previousProjectFieldCount = projectFields.length;
  const linkSlotChunk = SUNVOX_DB.chunks.find((chunk) => chunk.id === "SLnK");
  const previousLinkSlots = linkSlotChunk.linkSlots;
  const bitfield = SUNVOX_DB.bitfields.psynth_midi_input_flags;
  const previousBitfieldFields = bitfield.fields;
  const storageChunk = SUNVOX_DB.chunks.find((chunk) => chunk.id === "SMIC");
  const previousStorageMetadata = {
    sourceType: storageChunk.sourceType,
    valueKind: storageChunk.valueKind,
    signedRoundTrip: storageChunk.signedRoundTrip,
  };
  const amplifier = SUNVOX_DB.modules.Amplifier;
  const previousAmplifierColor = amplifier.color;
  SUNVOX_DB.modules[moduleName] = {
    controllers: [],
    dataChunks: [
      {
        index: 0,
        name: "brokenChunk",
        type: "struct",
        sourceType: "__missing_data_source_type",
        valueKind: "__missing_data_value_kind",
        flagBitfield: "__missing_flag_bits",
        fields: [{ name: "mode", type: "uint8", offset: 0, enum: "__missing_enum" }],
      },
    ],
    dataChunkRanges: [
      {
        start: 0,
        end: 1,
        name: "brokenRange",
        type: "bytes",
        flagBitflags: "__missing_flag_names",
        indexEnum: "__missing_index_enum",
      },
    ],
  };
  projectFields.push({
    chunk: "NOPE",
    path: "brokenGrammarField",
    field: "value",
    enum: "__missing_grammar_enum",
    bitfield: "__missing_grammar_bitfield",
    bitflags: "__missing_grammar_bitflags",
  });
  linkSlotChunk.linkSlots = { linkChunk: "NOPE" };
  bitfield.fields = [...bitfield.fields, { name: "broken", shift: 7, bits: 1, bitflags: "__missing_bitfield_bitflags" }];
  storageChunk.sourceType = "__missing_source_type";
  storageChunk.valueKind = "__missing_value_kind";
  storageChunk.signedRoundTrip = true;
  storageChunk.type = "uint32";
  amplifier.color = "#000000";

  try {
    const check = collectDbCheck();
    const errors = check.errors.join("\n");

    assert.equal(check.ok, false);
    assert.match(errors, /__BrokenDbCheckFixture: data chunk brokenChunk#0 references missing flag bitfield __missing_flag_bits/u);
    assert.match(
      errors,
      /__BrokenDbCheckFixture: data chunk brokenChunk#0 has invalid sourceType __missing_data_source_type/u,
    );
    assert.match(
      errors,
      /__BrokenDbCheckFixture: data chunk brokenChunk#0 has invalid valueKind __missing_data_value_kind/u,
    );
    assert.match(
      errors,
      /__BrokenDbCheckFixture: data chunk brokenChunk#0 field mode references missing enum __missing_enum/u,
    );
    assert.match(
      errors,
      /__BrokenDbCheckFixture: data chunk brokenRange#0-1 references missing flag bitflags __missing_flag_names/u,
    );
    assert.match(
      errors,
      /__BrokenDbCheckFixture: data chunk brokenRange#0-1 references missing index enum __missing_index_enum/u,
    );
    assert.match(
      errors,
      /__BrokenDbCheckFixture: data chunk index 0 is defined by both data chunk brokenChunk#0 and data chunk range brokenRange#0-1/u,
    );
    assert.match(errors, /grammar scope project references missing chunk NOPE/u);
    assert.match(errors, /grammar:project: field brokenGrammarField references missing enum __missing_grammar_enum/u);
    assert.match(errors, /grammar:project: field brokenGrammarField references missing bitfield __missing_grammar_bitfield/u);
    assert.match(errors, /grammar:project: field brokenGrammarField references missing bitflags __missing_grammar_bitflags/u);
    assert.match(errors, /chunk SLnK linkSlots references missing link chunk NOPE/u);
    assert.match(
      errors,
      /bitfield:psynth_midi_input_flags: packed field field broken references missing bitflags __missing_bitfield_bitflags/u,
    );
    assert.match(errors, /chunk SMIC has invalid sourceType __missing_source_type/u);
    assert.match(errors, /chunk SMIC has invalid valueKind __missing_value_kind/u);
    assert.match(errors, /chunk SMIC is marked signedRoundTrip but uses uint32 payload type/u);
    assert.match(errors, /Amplifier: module catalog color mismatch source=#E47FFF db=#000000/u);
  } finally {
    projectFields.length = previousProjectFieldCount;
    linkSlotChunk.linkSlots = previousLinkSlots;
    bitfield.fields = previousBitfieldFields;
    Object.assign(storageChunk, previousStorageMetadata, { type: "int32" });
    amplifier.color = previousAmplifierColor;
    if (previousModule) {
      SUNVOX_DB.modules[moduleName] = previousModule;
    } else {
      delete SUNVOX_DB.modules[moduleName];
    }
  }
});

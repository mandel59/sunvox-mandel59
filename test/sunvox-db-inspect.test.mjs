import assert from "node:assert/strict";
import test from "node:test";

import { collectControllerDiff, collectCoverage, collectDbCheck, collectScaffold } from "../tools/sunvox-db-inspect.mjs";
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

test("controller diff has no scalar metadata mismatches", () => {
  const diff = collectControllerDiff();
  const scalarMismatches = diff.mismatches.filter((mismatch) => mismatch.field !== "enumValues");

  assert.deepEqual(scalarMismatches, []);
});

test("scaffold preserves signed and leading-number enum value names", () => {
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
});

test("DB check validates data chunk ranges and metadata references", () => {
  const moduleName = "__BrokenDbCheckFixture";
  const previousModule = SUNVOX_DB.modules[moduleName];
  SUNVOX_DB.modules[moduleName] = {
    controllers: [],
    dataChunks: [
      {
        index: 0,
        name: "brokenChunk",
        type: "struct",
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

  try {
    const check = collectDbCheck("__missing_source_root__");
    const errors = check.errors.join("\n");

    assert.equal(check.ok, false);
    assert.match(errors, /__BrokenDbCheckFixture: data chunk brokenChunk#0 references missing flag bitfield __missing_flag_bits/u);
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
  } finally {
    if (previousModule) {
      SUNVOX_DB.modules[moduleName] = previousModule;
    } else {
      delete SUNVOX_DB.modules[moduleName];
    }
  }
});

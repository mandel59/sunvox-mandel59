#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

import { COVERAGE_MODULE_TYPES } from "./generate-sunvox-coverage-fixtures.mjs";

const DEFAULT_INPUT_PATH = "test/fixtures/sunvox/unsampled-modules.sunvox";
const SUNVOX_JS_PATH = "sunvox_lib/sunvox_lib/js/lib/sunvox.js";
const SLOT = 0;
const SV_INIT_FLAG_NO_DEBUG_OUTPUT = 1 << 0;
const SV_INIT_FLAG_OFFLINE = 1 << 1;
const SV_INIT_FLAG_ONE_THREAD = 1 << 4;
const SV_INIT_FLAGS = SV_INIT_FLAG_NO_DEBUG_OUTPUT | SV_INIT_FLAG_OFFLINE | SV_INIT_FLAG_ONE_THREAD;

async function loadSunVoxLib() {
  const sunvoxJsPath = resolve(SUNVOX_JS_PATH);
  const sunvoxJsDir = dirname(sunvoxJsPath);
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require: createRequire(pathToFileURL(sunvoxJsPath)),
    __filename: sunvoxJsPath,
    __dirname: sunvoxJsDir,
    clearTimeout,
    console,
    Date,
    performance,
    process,
    setTimeout,
    TextDecoder,
    TextEncoder,
    URL,
    WebAssembly,
  };
  context.globalThis = context;

  vm.runInNewContext(readFileSync(sunvoxJsPath, "utf8"), context, { filename: sunvoxJsPath });

  const SunVoxLib = module.exports.default ?? module.exports;
  return SunVoxLib({
    locateFile: (fileName) => resolve(sunvoxJsDir, fileName),
    print: () => {},
    printErr: () => {},
  });
}

function readCString(module, pointer) {
  return pointer ? module.UTF8ToString(pointer) : undefined;
}

export async function inspectWithSunVoxLib(inputPath = DEFAULT_INPUT_PATH) {
  const filePath = resolve(inputPath);
  const buffer = readFileSync(filePath);
  const module = await loadSunVoxLib();
  const initResult = module._sv_init(0, 44100, 2, SV_INIT_FLAGS);
  if (initResult < 0) {
    throw new Error(`sv_init failed with ${initResult}`);
  }

  try {
    const openResult = module._sv_open_slot(SLOT);
    if (openResult !== 0) {
      throw new Error(`sv_open_slot(${SLOT}) failed with ${openResult}`);
    }

    let dataPointer;
    try {
      dataPointer = module._malloc(buffer.length);
      if (!dataPointer) {
        throw new Error(`malloc failed for ${buffer.length} bytes`);
      }
      module.HEAPU8.set(buffer, dataPointer);
      const loadResult = module._sv_load_from_memory(SLOT, dataPointer, buffer.length);
      const moduleCount = module._sv_get_number_of_modules(SLOT);
      const modules = [];
      for (let index = 0; index < moduleCount; index += 1) {
        modules.push({
          index,
          type: readCString(module, module._sv_get_module_type(SLOT, index)),
          name: readCString(module, module._sv_get_module_name(SLOT, index)),
          flags: module._sv_get_module_flags(SLOT, index),
        });
      }
      return {
        filePath,
        engineVersion: initResult,
        loadResult,
        moduleCount,
        modules,
        songName: readCString(module, module._sv_get_song_name(SLOT)),
      };
    } finally {
      if (dataPointer !== undefined) {
        module._free(dataPointer);
      }
      module._sv_close_slot(SLOT);
    }
  } finally {
    module._sv_deinit();
  }
}

function validateDefaultCoverageFixture(report) {
  if (report.loadResult !== 0) {
    throw new Error(`SunVox lib rejected ${report.filePath}: sv_load_from_memory returned ${report.loadResult}`);
  }

  const expectedTypes = ["Output", ...COVERAGE_MODULE_TYPES];
  const actualTypes = report.modules.map((candidate) => candidate.type);
  const missingTypes = expectedTypes.filter((expected) => !actualTypes.includes(expected));
  if (missingTypes.length) {
    throw new Error(
      `SunVox lib did not expose expected fixture modules: ${missingTypes.join(", ")}. ` +
        `Actual types: ${actualTypes.join(", ")}`,
    );
  }

  if (report.moduleCount !== expectedTypes.length) {
    throw new Error(`Expected ${expectedTypes.length} modules in fixture, SunVox lib exposed ${report.moduleCount}`);
  }
}

async function main() {
  const inputPath = process.argv[2] ?? DEFAULT_INPUT_PATH;
  const report = await inspectWithSunVoxLib(inputPath);

  if (resolve(inputPath) === resolve(DEFAULT_INPUT_PATH)) {
    validateDefaultCoverageFixture(report);
  } else if (report.loadResult !== 0) {
    throw new Error(`SunVox lib rejected ${report.filePath}: sv_load_from_memory returned ${report.loadResult}`);
  }

  console.log(
    `SunVox lib loaded ${inputPath}: engine=0x${report.engineVersion.toString(16)}, ` +
      `load=${report.loadResult}, modules=${report.moduleCount}`,
  );
  console.log(`Module types: ${report.modules.map((candidate) => candidate.type ?? "<empty>").join(", ")}`);
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

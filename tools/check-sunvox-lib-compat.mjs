#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

import { COVERAGE_MODULE_TYPES } from "./generate-sunvox-coverage-fixtures.mjs";
import { buildContainer, parseContainer, SUNVOX_DB } from "./sunvox-codec.mjs";

const DEFAULT_INPUT_PATH = "test/fixtures/sunvox/unsampled-modules.sunvox";
const DEFAULT_INPUTS = ["music", "instruments", "test/fixtures/sunvox"];
const SAMPLE_EXTENSIONS = new Set([".sunvox", ".sunsynth"]);
const SUNVOX_JS_PATH = "sunvox_lib/sunvox_lib/js/lib/sunvox.js";
const SLOT = 0;
const EDITED_PROJECT_NAME = "Codec compat project";
const EDITED_MODULE_NAME = "CodecCompatModule";
const EDITED_PATTERN_NAME = "Codec compat pattern";
const EDITED_SYNTH_NAME = "CodecCompatSynth";
const EDITED_CONTROLLER_VALUE = 123;
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

function readMagic(buffer) {
  return buffer.subarray(0, 4).toString("latin1");
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

async function findFiles(paths) {
  const files = [];
  for (const input of paths) {
    const path = resolve(input);
    let info;
    try {
      info = await stat(path);
    } catch {
      continue;
    }
    if (info.isDirectory()) {
      const entries = await readdir(path, { withFileTypes: true });
      files.push(...(await findFiles(entries.map((entry) => join(path, entry.name)))));
      continue;
    }
    if (info.isFile() && SAMPLE_EXTENSIONS.has(extname(path).toLowerCase())) {
      files.push(path);
    }
  }
  return files.sort((a, b) => a.localeCompare(b, "en"));
}

function moduleControllerDefinitions(type) {
  return SUNVOX_DB.modules[type]?.controllers ?? [];
}

function controllerIndex(type, name) {
  return moduleControllerDefinitions(type).find((controller) => controller.name === name)?.index;
}

function inspectLoadedState(module, moduleCount, magic) {
  const modules = [];
  for (let index = 0; index < moduleCount; index += 1) {
    const controllerCount = module._sv_get_number_of_module_ctls(SLOT, index);
    const controllers = [];
    for (let controllerIndex = 0; controllerIndex < controllerCount; controllerIndex += 1) {
      controllers.push({
        index: controllerIndex,
        name: readCString(module, module._sv_get_module_ctl_name(SLOT, index, controllerIndex)),
        value: module._sv_get_module_ctl_value(SLOT, index, controllerIndex, 0),
      });
    }
    modules.push({
      index,
      type: readCString(module, module._sv_get_module_type(SLOT, index)),
      name: readCString(module, module._sv_get_module_name(SLOT, index)),
      flags: module._sv_get_module_flags(SLOT, index),
      controllers,
    });
  }

  const patternCount = magic === "SVOX" ? module._sv_get_number_of_patterns(SLOT) : 0;
  const patterns = [];
  for (let index = 0; index < patternCount; index += 1) {
    patterns.push({
      index,
      name: readCString(module, module._sv_get_pattern_name(SLOT, index)),
      tracks: module._sv_get_pattern_tracks(SLOT, index),
      lines: module._sv_get_pattern_lines(SLOT, index),
    });
  }
  return { modules, patterns };
}

export async function inspectBufferWithSunVoxLib(buffer, options = {}) {
  const magic = readMagic(buffer);
  const expectedModuleType = options.expectedModuleType ?? (magic === "SSYN" ? parseContainer(buffer).module.type : undefined);
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
      const loadApi = magic === "SSYN" ? "sv_load_module_from_memory" : "sv_load_from_memory";
      const loadResult =
        loadApi === "sv_load_module_from_memory"
          ? module._sv_load_module_from_memory(SLOT, dataPointer, buffer.length, 0, 0, 0)
          : module._sv_load_from_memory(SLOT, dataPointer, buffer.length);
      const moduleCount = module._sv_get_number_of_modules(SLOT);
      const state = inspectLoadedState(module, moduleCount, magic);
      return {
        filePath: options.filePath ? resolve(options.filePath) : undefined,
        label: options.label,
        magic,
        engineVersion: initResult,
        expectedModuleType,
        loadApi,
        loadResult,
        moduleCount,
        modules: state.modules,
        patterns: state.patterns,
        songName: readCString(module, module._sv_get_song_name(SLOT)),
        bpm: magic === "SVOX" ? module._sv_get_song_bpm(SLOT) : undefined,
        tpl: magic === "SVOX" ? module._sv_get_song_tpl(SLOT) : undefined,
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

export async function inspectWithSunVoxLib(inputPath = DEFAULT_INPUT_PATH) {
  const filePath = resolve(inputPath);
  const buffer = readFileSync(filePath);
  return inspectBufferWithSunVoxLib(buffer, { filePath });
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

function validateLoad(report) {
  if (!report.filePath || !SAMPLE_EXTENSIONS.has(extname(report.filePath).toLowerCase())) {
    throw new Error(`Unsupported SunVox sample extension for ${report.filePath}`);
  }
  if (resolve(report.filePath) === resolve(DEFAULT_INPUT_PATH)) {
    validateDefaultCoverageFixture(report);
    return;
  }
  if (report.loadResult < 0) {
    throw new Error(`SunVox lib rejected ${report.filePath}: ${report.loadApi} returned ${report.loadResult}`);
  }
  if (report.moduleCount < 1) {
    throw new Error(`SunVox lib exposed no modules for ${report.filePath}`);
  }
  if (report.magic === "SSYN") {
    const loadedModule = report.modules[report.loadResult];
    if (loadedModule?.type !== report.expectedModuleType) {
      throw new Error(
        `SunVox lib loaded ${report.filePath} as ${loadedModule?.type ?? "<missing>"}; ` +
          `expected ${report.expectedModuleType}`,
      );
    }
  } else if (report.loadResult !== 0) {
    throw new Error(`SunVox lib rejected ${report.filePath}: ${report.loadApi} returned ${report.loadResult}`);
  }
}

function controllerValue(report, moduleIndex, controllerIndex) {
  return report.modules[moduleIndex]?.controllers?.find((controller) => controller.index === controllerIndex)?.value;
}

function validateEditedCompatibility(report, expectations) {
  validateLoad(report);
  if (expectations.songName !== undefined && report.songName !== expectations.songName) {
    throw new Error(`SunVox lib exposed song name ${report.songName}; expected ${expectations.songName}`);
  }
  if (expectations.moduleName) {
    const { index, name } = expectations.moduleName;
    if (report.modules[index]?.name !== name) {
      throw new Error(`SunVox lib exposed module #${index} name ${report.modules[index]?.name}; expected ${name}`);
    }
  }
  if (expectations.patternName) {
    const { index, name } = expectations.patternName;
    if (report.patterns[index]?.name !== name) {
      throw new Error(`SunVox lib exposed pattern #${index} name ${report.patterns[index]?.name}; expected ${name}`);
    }
  }
  if (expectations.controllerValue) {
    const { moduleIndex, controllerIndex, value } = expectations.controllerValue;
    const actual = controllerValue(report, moduleIndex, controllerIndex);
    if (actual !== value) {
      throw new Error(
        `SunVox lib exposed module #${moduleIndex} controller #${controllerIndex} value ${actual}; expected ${value}`,
      );
    }
  }
}

function firstEditableModule(modules) {
  return modules.findIndex((module) => module?.type && module.type !== "Output");
}

function firstNamedPattern(patterns) {
  return patterns.findIndex((pattern) => pattern?.name !== undefined);
}

function applyControllerEdit(module, moduleIndex, expectations) {
  const controllers = module?.controllers;
  if (!module?.type || !controllers || typeof controllers !== "object" || Array.isArray(controllers)) {
    return;
  }
  const index = controllerIndex(module.type, "volume");
  if (!Number.isInteger(index) || typeof controllers.volume !== "number") {
    return;
  }
  controllers.volume = EDITED_CONTROLLER_VALUE;
  expectations.controllerValue = {
    moduleIndex,
    controllerIndex: index,
    value: EDITED_CONTROLLER_VALUE,
  };
}

function makeEditedCompatibilityCase(filePath, buffer) {
  const document = cloneJson(parseContainer(buffer));
  const expectations = {};

  if (document.magic === "SVOX") {
    document.project ??= {};
    document.project.name = EDITED_PROJECT_NAME;
    expectations.songName = EDITED_PROJECT_NAME;

    const moduleIndex = firstEditableModule(document.modules ?? []);
    if (moduleIndex >= 0) {
      document.modules[moduleIndex].name = EDITED_MODULE_NAME;
      expectations.moduleName = { index: moduleIndex, name: EDITED_MODULE_NAME };
      applyControllerEdit(document.modules[moduleIndex], moduleIndex, expectations);
    }

    const patternIndex = firstNamedPattern(document.patterns ?? []);
    if (patternIndex >= 0) {
      document.patterns[patternIndex].name = EDITED_PATTERN_NAME;
      expectations.patternName = { index: patternIndex, name: EDITED_PATTERN_NAME };
    }
  } else if (document.magic === "SSYN") {
    document.module ??= {};
    document.module.name = EDITED_SYNTH_NAME;
    expectations.moduleName = { index: "$loaded", name: EDITED_SYNTH_NAME };
    applyControllerEdit(document.module, "$loaded", expectations);
  } else {
    return undefined;
  }

  return {
    filePath,
    label: `${relative(process.cwd(), filePath)} (codec edit)`,
    buffer: buildContainer(document),
    expectations,
  };
}

function resolveLoadedModuleExpectations(report, expectations) {
  const resolved = cloneJson(expectations);
  if (resolved.moduleName?.index === "$loaded") {
    resolved.moduleName.index = report.loadResult;
  }
  if (resolved.controllerValue?.moduleIndex === "$loaded") {
    resolved.controllerValue.moduleIndex = report.loadResult;
  }
  return resolved;
}

function printReport(report) {
  console.log(
    `${report.label ?? relative(process.cwd(), report.filePath)}: engine=0x${report.engineVersion.toString(16)}, ` +
      `magic=${report.magic}, api=${report.loadApi}, load=${report.loadResult}, modules=${report.moduleCount}`,
  );
}

async function main() {
  const inputs = process.argv.slice(2);
  const files = await findFiles(inputs.length ? inputs : DEFAULT_INPUTS);
  if (files.length === 0) {
    console.error("No SunVox sample files found.");
    process.exitCode = 1;
    return;
  }

  let failures = 0;
  for (const file of files) {
    try {
      const report = await inspectWithSunVoxLib(file);
      validateLoad(report);
      printReport(report);

      const edited = makeEditedCompatibilityCase(file, readFileSync(file));
      if (edited) {
        const editedReport = await inspectBufferWithSunVoxLib(edited.buffer, {
          filePath: edited.filePath,
          label: edited.label,
        });
        validateEditedCompatibility(editedReport, resolveLoadedModuleExpectations(editedReport, edited.expectations));
        printReport(editedReport);
      }
    } catch (error) {
      failures += 1;
      console.error(`${relative(process.cwd(), file)}: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (failures > 0) {
    process.exitCode = 1;
    return;
  }
  console.log(`SunVox lib compatibility passed for ${files.length} files and codec edit variants.`);
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseContainer, SUNVOX_DB } from "./sunvox-codec.mjs";

const DEFAULT_SAMPLE_ROOTS = ["music", "instruments"];
const DEFAULT_SOURCE_ROOT = "var/sunvox_lib/lib_sunvox/psynth";
const DEFAULT_STRINGS_FILE = "var/sunvox_lib/lib_sunvox/psynth/psynth_strings.cpp";
const SAMPLE_EXTENSIONS = new Set([".sunvox", ".sunsynth"]);

function usage() {
  console.error(`Usage:
  node tools/sunvox-db-inspect.mjs coverage [--json] [--details] [sample-path ...]
  node tools/sunvox-db-inspect.mjs report [--json] [source-root]
  node tools/sunvox-db-inspect.mjs scaffold <module-name> [source-root]
  node tools/sunvox-db-inspect.mjs check [--json] [source-root]`);
}

function compareText(a, b) {
  return a.localeCompare(b, "en");
}

function increment(map, key, count = 1) {
  map.set(key, (map.get(key) ?? 0) + count);
}

function lowerCamel(words) {
  const cleanWords = words.filter(Boolean);
  if (cleanWords.length === 0) {
    return "value";
  }
  const [first, ...rest] = cleanWords;
  return [
    first.toLowerCase(),
    ...rest.map((word) => `${word.slice(0, 1).toUpperCase()}${word.slice(1).toLowerCase()}`),
  ].join("");
}

function identifierFromLabel(label) {
  const normalized = label
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/=0/gu, " 0")
    .replace(/[^0-9A-Za-z]+/gu, " ")
    .trim();
  return lowerCamel(normalized.split(/\s+/u));
}

function titleFromMacro(macro) {
  const text = macro.replace(/^STR_PS_/u, "").replace(/_/gu, " ").toLowerCase();
  return text.replace(/\b[a-z]/gu, (letter) => letter.toUpperCase());
}

function enumNameFromMacro(macro, fallback) {
  if (!macro) {
    return identifierFromLabel(fallback ?? "enum");
  }
  let name = macro.replace(/^STR_PS_/u, "").toLowerCase();
  name = name.replace(/_types$/u, "_type").replace(/_modes$/u, "_mode");
  return name;
}

function enumValueName(label) {
  return identifierFromLabel(label).replace(/^value$/u, "unknown");
}

function withoutFlags(args, flags) {
  return args.filter((arg) => !flags.includes(arg));
}

function safeStat(path) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

function findFiles(paths, extensions) {
  const files = [];
  for (const input of paths) {
    const path = resolve(input);
    const stat = safeStat(path);
    if (!stat) {
      continue;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        files.push(...findFiles([join(path, entry.name)], extensions));
      }
      continue;
    }
    if (stat.isFile() && extensions.has(extname(path).toLowerCase())) {
      files.push(path);
    }
  }
  return files.sort(compareText);
}

function expandTemplate(template, context) {
  if (typeof template !== "string") {
    return template;
  }
  return template
    .replaceAll("{i}", String(context.index))
    .replaceAll("{n}", String(context.number))
    .replaceAll("{name}", context.name ?? "");
}

function repeatValue(value, index) {
  if (!Array.isArray(value)) {
    return value;
  }
  return value[index] ?? value.at(-1);
}

function expandControllerDefinitions(controllers) {
  const expanded = [];
  for (const controller of controllers ?? []) {
    if (!controller.repeat) {
      expanded.push(controller);
      continue;
    }

    const repeat = controller.repeat;
    let chunkIndex = repeat.startIndex ?? 0;
    for (const item of repeat.items ?? []) {
      const count = item.repeatCount ?? repeat.count ?? 0;
      for (let repeatIndex = 0; repeatIndex < count; repeatIndex += 1) {
        const context = { index: repeatIndex, number: repeatIndex + 1, name: item.name };
        const definition = { ...item, index: chunkIndex };
        delete definition.repeatCount;
        definition.name = expandTemplate(item.idTemplate ?? repeat.idTemplate, context) ?? item.name;
        definition.path =
          expandTemplate(item.pathTemplate ?? repeat.pathTemplate, context) ?? definition.name;
        for (const key of ["label", "min", "max", "default", "normal", "group"]) {
          definition[key] = repeatValue(definition[key], repeatIndex);
        }
        expanded.push(definition);
        chunkIndex += 1;
      }
    }
  }
  return expanded;
}

function dbControllerCount(moduleType) {
  return expandControllerDefinitions(SUNVOX_DB.modules[moduleType]?.controllers).length;
}

function moduleLabel(module, fallbackIndex) {
  const parts = [`#${module.index ?? fallbackIndex}`];
  if (module.name) {
    parts.push(module.name);
  }
  if (module.type) {
    parts.push(`<${module.type}>`);
  }
  return parts.join(" ");
}

function collectDocumentModules(document, source, path, modules) {
  const documentModules =
    document.magic === "SSYN" ? (document.module ? [document.module] : []) : document.modules ?? [];

  documentModules.forEach((module, index) => {
    const modulePath = [...path, moduleLabel(module, index)];
    modules.push({ source, path: modulePath.join(" / "), module });

    for (const chunk of module.dataChunks ?? []) {
      if (chunk.container) {
        collectDocumentModules(
          chunk.container,
          source,
          [...modulePath, `dataChunk[${chunk.index}]`],
          modules,
        );
      }
    }
  });
}

export function collectCoverage(sampleRoots = DEFAULT_SAMPLE_ROOTS) {
  const sampleFiles = findFiles(sampleRoots, SAMPLE_EXTENSIONS);
  const modules = [];
  const errors = [];

  for (const file of sampleFiles) {
    try {
      const document = parseContainer(readFileSync(file));
      collectDocumentModules(document, relative(process.cwd(), file), [], modules);
    } catch (error) {
      errors.push({ file: relative(process.cwd(), file), message: error.message });
    }
  }

  const moduleTypes = new Map();
  const missingDbTypes = new Map();
  const rawControllers = [];
  const controllerExtras = [];
  const moduleExtraChunks = [];
  const opaqueDataChunks = [];

  for (const { source, path, module } of modules) {
    const type = module.type ?? "(missing type)";
    increment(moduleTypes, type);
    if (module.type && !SUNVOX_DB.modules[module.type]) {
      increment(missingDbTypes, module.type);
    }

    if (Array.isArray(module.controllers)) {
      rawControllers.push({
        source,
        path,
        type,
        count: module.controllers.filter((value) => value !== undefined).length,
      });
    } else if (module.controllers?.extra && typeof module.controllers.extra === "object") {
      controllerExtras.push({
        source,
        path,
        type,
        indexes: Object.keys(module.controllers.extra).map(Number).sort((a, b) => a - b),
      });
    }

    if (Array.isArray(module.extraChunks) && module.extraChunks.length > 0) {
      moduleExtraChunks.push({ source, path, type, count: module.extraChunks.length });
    }

    for (const chunk of module.dataChunks ?? []) {
      if (chunk.base64 !== undefined) {
        opaqueDataChunks.push({
          source,
          path,
          type,
          index: chunk.index,
          name: chunk.name,
        });
      }
    }
  }

  return {
    files: sampleFiles.map((file) => relative(process.cwd(), file)),
    errors,
    moduleCount: modules.length,
    moduleTypes: [...moduleTypes.entries()].sort(([a], [b]) => compareText(a, b)),
    dbModuleTypes: Object.keys(SUNVOX_DB.modules).sort(compareText),
    missingDbTypes: [...missingDbTypes.entries()].sort(([a], [b]) => compareText(a, b)),
    rawControllers,
    controllerExtras,
    moduleExtraChunks,
    opaqueDataChunks,
  };
}

function aggregateRows(rows, keyFn, updateFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) {
      groups.set(key, { key, count: 0 });
    }
    const group = groups.get(key);
    group.count += 1;
    updateFn?.(group, row);
  }
  return [...groups.values()].sort((a, b) => compareText(a.key, b.key));
}

function extractCaseReturnString(text, command) {
  const pattern = new RegExp(
    `case\\s+${command}\\s*:\\s*(?:\\{[\\s\\S]*?\\})?\\s*retval\\s*=\\s*(?:\\(PS_RETTYPE\\))?\\s*"([^"]+)"`,
    "u",
  );
  return pattern.exec(text)?.[1];
}

function extractCaseReturnExpression(text, command) {
  const pattern = new RegExp(`case\\s+${command}\\s*:\\s*retval\\s*=\\s*([^;]+);`, "u");
  return pattern.exec(text)?.[1]?.trim();
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function decodeCStringLiteral(raw) {
  try {
    return JSON.parse(`"${raw}"`);
  } catch {
    return raw;
  }
}

function loadStringTable(stringsFile = DEFAULT_STRINGS_FILE) {
  const stat = safeStat(stringsFile);
  if (!stat?.isFile()) {
    return new Map();
  }
  const text = readFileSync(stringsFile, "utf8");
  const strings = new Map();
  const pattern = /((?:\s*case\s+STR_PS_[A-Z0-9_]+\s*:\s*)+)str\s*=\s*"((?:\\.|[^"])*)";/gu;
  for (const match of text.matchAll(pattern)) {
    const textValue = decodeCStringLiteral(match[2]);
    for (const caseMatch of match[1].matchAll(/case\s+(STR_PS_[A-Z0-9_]+)\s*:/gu)) {
      strings.set(caseMatch[1], textValue);
    }
  }
  return strings;
}

function scanSourceFile(file) {
  const text = readFileSync(file, "utf8");
  const fallbackName = file
    .replace(/\\/gu, "/")
    .replace(/^.*\/psynths_/u, "")
    .replace(/\.cpp$/u, "");
  return {
    file: relative(process.cwd(), file),
    module: extractCaseReturnString(text, "PS_CMD_GET_NAME") ?? fallbackName,
    controllers: countMatches(text, /psynth_register_ctl\s*\(/gu),
    showOffsets: countMatches(text, /psynth_set_ctl_show_offset\s*\(/gu),
    controlFlags: countMatches(text, /psynth_set_ctl_flags\s*\(/gu),
    color: extractCaseReturnString(text, "PS_CMD_GET_COLOR"),
    inputs: extractCaseReturnExpression(text, "PS_CMD_GET_INPUTS_NUM"),
    outputs: extractCaseReturnExpression(text, "PS_CMD_GET_OUTPUTS_NUM"),
    flags: extractCaseReturnExpression(text, "PS_CMD_GET_FLAGS"),
    flags2: extractCaseReturnExpression(text, "PS_CMD_GET_FLAGS2"),
  };
}

function splitArguments(text) {
  const args = [];
  let current = "";
  let parenDepth = 0;
  let bracketDepth = 0;
  let inString = false;
  let escaped = false;

  for (const char of text) {
    if (inString) {
      current += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      current += char;
      continue;
    }
    if (char === "(") {
      parenDepth += 1;
    } else if (char === ")") {
      parenDepth -= 1;
    } else if (char === "[") {
      bracketDepth += 1;
    } else if (char === "]") {
      bracketDepth -= 1;
    } else if (char === "," && parenDepth === 0 && bracketDepth === 0) {
      args.push(current.trim());
      current = "";
      continue;
    }
    current += char;
  }
  if (current.trim()) {
    args.push(current.trim());
  }
  return args;
}

function extractRegisterCalls(text) {
  const calls = [];
  const pattern = /psynth_register_ctl\s*\(([\s\S]*?)\);/gu;
  for (const match of text.matchAll(pattern)) {
    calls.push(splitArguments(match[1]));
  }
  return calls;
}

function extractIndexedCalls(text, functionName) {
  const calls = new Map();
  const pattern = new RegExp(`${functionName}\\s*\\(([\\s\\S]*?)\\);`, "gu");
  for (const match of text.matchAll(pattern)) {
    const args = splitArguments(match[1]);
    const index = parseNumberLike(args[1] ?? "");
    if (Number.isInteger(index)) {
      calls.set(index, args);
    }
  }
  return calls;
}

function scaleFromFlags(expression) {
  if (typeof expression !== "string") {
    return undefined;
  }
  if (expression.includes("PSYNTH_CTL_FLAG_INVEXP3")) {
    return "invExp3";
  }
  if (expression.includes("PSYNTH_CTL_FLAG_EXP3")) {
    return "exp3";
  }
  if (expression.includes("PSYNTH_CTL_FLAG_EXP2")) {
    return "exp2";
  }
  return undefined;
}

function resolveStringArg(arg, strings) {
  const literal = /^"((?:\\.|[^"])*)"$/u.exec(arg);
  if (literal) {
    return {
      text: decodeCStringLiteral(literal[1]),
      macro: undefined,
    };
  }

  const macro = /ps_get_string\s*\(\s*(STR_PS_[A-Z0-9_]+)\s*\)/u.exec(arg)?.[1];
  if (macro) {
    return {
      text: strings.get(macro) ?? titleFromMacro(macro),
      macro,
    };
  }

  return {
    text: undefined,
    macro: undefined,
    raw: arg,
  };
}

function parseNumberLike(expression) {
  const trimmed = expression.trim();
  if (/^-?\d+$/u.test(trimmed)) {
    return Number(trimmed);
  }
  if (/^[\d\s()+\-*/]+$/u.test(trimmed)) {
    try {
      const value = Function(`"use strict"; return (${trimmed});`)();
      if (Number.isFinite(value) && Number.isInteger(value)) {
        return value;
      }
    } catch {
      return trimmed;
    }
  }
  return trimmed;
}

function enumValuesFromLabel(label) {
  if (!label?.includes(";")) {
    return undefined;
  }
  return Object.fromEntries(label.split(";").map((entry, index) => [String(index), enumValueName(entry)]));
}

function scaffoldController(call, index, strings, metadata = {}) {
  const nameArg = resolveStringArg(call[1] ?? "", strings);
  const labelArg = resolveStringArg(call[2] ?? "", strings);
  const label = nameArg.text ?? titleFromMacro(`STR_PS_CTL_${index}`);
  const enumValues = enumValuesFromLabel(labelArg.text);
  const displayOffset = metadata.showOffsets?.get(index);
  const scale = scaleFromFlags(metadata.controlFlags?.get(index)?.[2]);
  const controller = {
    index,
    name: identifierFromLabel(label),
    label,
    type: enumValues ? "enum" : "int32",
    ...(enumValues ? { enum: enumNameFromMacro(labelArg.macro, label) } : {}),
    min: parseNumberLike(call[3] ?? "0"),
    max: parseNumberLike(call[4] ?? "0"),
    default: parseNumberLike(call[5] ?? "0"),
    normal: parseNumberLike(call[8] ?? "-1"),
    group: parseNumberLike(call[9] ?? "0"),
    ...(displayOffset !== undefined ? { displayOffset: parseNumberLike(displayOffset[2] ?? "0") } : {}),
    ...(scale ? { scale } : {}),
  };

  if (!enumValues && labelArg.text) {
    controller.unit = labelArg.text;
  }

  return {
    controller,
    enum: enumValues ? [controller.enum, enumValues] : undefined,
  };
}

export function collectScaffold(moduleName, sourceRoot = DEFAULT_SOURCE_ROOT) {
  const report = collectSourceReport(sourceRoot);
  const module = report.sourceModules.find(
    (candidate) => candidate.module.toLowerCase() === moduleName.toLowerCase(),
  );
  if (!module) {
    throw new Error(`Module not found in source scan: ${moduleName}`);
  }

  const strings = loadStringTable();
  const text = readFileSync(module.file, "utf8");
  const metadata = {
    showOffsets: extractIndexedCalls(text, "psynth_set_ctl_show_offset"),
    controlFlags: extractIndexedCalls(text, "psynth_set_ctl_flags"),
  };
  const controllers = [];
  const enums = new Map();
  extractRegisterCalls(text).forEach((call, index) => {
    const scaffolded = scaffoldController(call, index, strings, metadata);
    controllers.push(scaffolded.controller);
    if (scaffolded.enum) {
      enums.set(scaffolded.enum[0], scaffolded.enum[1]);
    }
  });

  return {
    module: module.module,
    file: module.file,
    enums: Object.fromEntries(enums),
    modules: {
      [module.module]: {
        controllers,
      },
    },
  };
}

export function collectSourceReport(sourceRoot = DEFAULT_SOURCE_ROOT) {
  const files = findFiles([sourceRoot], new Set([".cpp"])).filter((file) =>
    /[\\/]psynths_[^\\/]+\.cpp$/u.test(file),
  );
  const modules = files.map(scanSourceFile).sort((a, b) => compareText(a.module, b.module));
  const sourceByName = new Map(modules.map((module) => [module.module, module]));
  const dbModules = Object.keys(SUNVOX_DB.modules).sort(compareText);
  const dbRows = dbModules.map((module) => ({
    module,
    sourceControllers: sourceByName.get(module)?.controllers,
    dbControllers: dbControllerCount(module),
    inSource: sourceByName.has(module),
  }));

  return {
    sourceRoot,
    sourceFiles: files.map((file) => relative(process.cwd(), file)),
    sourceModules: modules,
    dbModules: dbRows,
    missingFromDb: modules
      .filter((module) => !SUNVOX_DB.modules[module.module])
      .map((module) => ({
        module: module.module,
        controllers: module.controllers,
        file: module.file,
      })),
    missingFromSource: dbRows.filter((module) => !module.inSource).map((module) => module.module),
  };
}

function hasControllerRepeat(moduleDefinition) {
  return (moduleDefinition?.controllers ?? []).some((controller) => controller.repeat);
}

function collectDbCheck(sourceRoot = DEFAULT_SOURCE_ROOT) {
  const errors = [];
  const warnings = [];
  const sourceReport = collectSourceReport(sourceRoot);
  const sourceByName = new Map(sourceReport.sourceModules.map((module) => [module.module, module]));

  for (const [moduleName, moduleDefinition] of Object.entries(SUNVOX_DB.modules)) {
    const controllers = expandControllerDefinitions(moduleDefinition.controllers);
    const controllerIndexes = new Map();
    for (const controller of controllers) {
      if (!Number.isInteger(controller.index)) {
        errors.push(`${moduleName}: controller ${controller.name ?? "(unnamed)"} has non-integer index`);
        continue;
      }
      if (controllerIndexes.has(controller.index)) {
        errors.push(`${moduleName}: duplicate controller index ${controller.index}`);
      }
      controllerIndexes.set(controller.index, controller);
      if (controller.enum && !SUNVOX_DB.enums[controller.enum]) {
        errors.push(`${moduleName}: controller ${controller.name} references missing enum ${controller.enum}`);
      }
    }

    const dataChunkIndexes = new Set();
    for (const dataChunk of moduleDefinition.dataChunks ?? []) {
      if (!Number.isInteger(dataChunk.index)) {
        errors.push(`${moduleName}: data chunk ${dataChunk.name ?? "(unnamed)"} has non-integer index`);
        continue;
      }
      if (dataChunkIndexes.has(dataChunk.index)) {
        errors.push(`${moduleName}: duplicate data chunk index ${dataChunk.index}`);
      }
      dataChunkIndexes.add(dataChunk.index);
    }

    for (const range of moduleDefinition.dataChunkRanges ?? []) {
      if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.end < range.start) {
        errors.push(`${moduleName}: invalid data chunk range ${range.name ?? "(unnamed)"}`);
      }
    }

    const source = sourceByName.get(moduleName);
    if (
      source &&
      moduleName !== "MetaModule" &&
      !hasControllerRepeat(moduleDefinition) &&
      source.controllers !== controllers.length
    ) {
      errors.push(
        `${moduleName}: source controller count ${source.controllers} does not match DB count ${controllers.length}`,
      );
    }
  }

  for (const moduleName of sourceReport.missingFromSource) {
    warnings.push(`${moduleName}: DB module was not found in source scan`);
  }

  return {
    ok: errors.length === 0,
    errors,
    warnings,
    summary: {
      modules: Object.keys(SUNVOX_DB.modules).length,
      enums: Object.keys(SUNVOX_DB.enums).length,
      errors: errors.length,
      warnings: warnings.length,
    },
  };
}

function formatTable(rows, columns) {
  if (rows.length === 0) {
    return "(none)";
  }
  const widths = columns.map((column) =>
    Math.max(
      column.header.length,
      ...rows.map((row) => String(column.value(row) ?? "").length),
    ),
  );
  const header = columns.map((column, index) => column.header.padEnd(widths[index])).join("  ");
  const separator = widths.map((width) => "-".repeat(width)).join("  ");
  const body = rows
    .map((row) =>
      columns.map((column, index) => String(column.value(row) ?? "").padEnd(widths[index])).join("  "),
    )
    .join("\n");
  return `${header}\n${separator}\n${body}`;
}

function formatCoverage(coverage, options = {}) {
  const rawControllerSummary = aggregateRows(coverage.rawControllers, (row) => row.type, (group, row) => {
    group.controllers = (group.controllers ?? 0) + row.count;
  });
  rawControllerSummary.sort(
    (a, b) => b.count - a.count || (b.controllers ?? 0) - (a.controllers ?? 0) || compareText(a.key, b.key),
  );
  const controllerExtraSummary = aggregateRows(coverage.controllerExtras, (row) => row.type, (group, row) => {
    group.indexes ??= new Set();
    for (const index of row.indexes) {
      group.indexes.add(index);
    }
  }).map((group) => ({ ...group, indexes: [...group.indexes].sort((a, b) => a - b) }));
  const extraChunkSummary = aggregateRows(coverage.moduleExtraChunks, (row) => row.type, (group, row) => {
    group.chunks = (group.chunks ?? 0) + row.count;
  });
  const opaqueDataSummary = aggregateRows(
    coverage.opaqueDataChunks,
    (row) => `${row.type} ${row.index} ${row.name ?? ""}`.trim(),
    (group, row) => {
      group.type = row.type;
      group.index = row.index;
      group.name = row.name ?? "";
    },
  );

  const lines = [
    "SunVox DB coverage",
    "",
    `Files: ${coverage.files.length}`,
    ...coverage.files.map((file) => `  - ${file}`),
    "",
    `Decoded modules including embedded containers: ${coverage.moduleCount}`,
    `Unique module types in samples: ${coverage.moduleTypes.length}`,
    `DB module types: ${coverage.dbModuleTypes.length}`,
    "",
    "Next raw-controller targets:",
    formatTable(rawControllerSummary.slice(0, 8), [
      { header: "type", value: (row) => row.key },
      { header: "modules", value: (row) => row.count },
      { header: "controllerValues", value: (row) => row.controllers },
    ]),
    "",
    "Module types in samples:",
    formatTable(
      coverage.moduleTypes.map(([type, count]) => ({
        type,
        count,
        db: SUNVOX_DB.modules[type] ? "yes" : "no",
        dbControllers: dbControllerCount(type),
      })),
      [
        { header: "type", value: (row) => row.type },
        { header: "count", value: (row) => row.count },
        { header: "db", value: (row) => row.db },
        { header: "dbControllers", value: (row) => row.dbControllers },
      ],
    ),
    "",
    "Missing DB module types in samples:",
    formatTable(
      coverage.missingDbTypes.map(([type, count]) => ({ type, count })),
      [
        { header: "type", value: (row) => row.type },
        { header: "count", value: (row) => row.count },
      ],
    ),
    "",
    "Raw controller arrays by type:",
    formatTable(rawControllerSummary, [
      { header: "type", value: (row) => row.key },
      { header: "modules", value: (row) => row.count },
      { header: "controllerValues", value: (row) => row.controllers },
    ]),
    "",
    "Controller extras by type:",
    formatTable(controllerExtraSummary, [
      { header: "type", value: (row) => row.key },
      { header: "modules", value: (row) => row.count },
      { header: "indexes", value: (row) => row.indexes.join(",") },
    ]),
    "",
    "Module extra chunks by type:",
    formatTable(extraChunkSummary, [
      { header: "type", value: (row) => row.key },
      { header: "modules", value: (row) => row.count },
      { header: "chunks", value: (row) => row.chunks },
    ]),
    "",
    "Opaque data chunks by type/index:",
    formatTable(opaqueDataSummary, [
      { header: "type", value: (row) => row.type },
      { header: "index", value: (row) => row.index },
      { header: "name", value: (row) => row.name ?? "" },
      { header: "chunks", value: (row) => row.count },
    ]),
  ];

  if (options.details) {
    lines.push(
      "",
      "Raw controller array details:",
      formatTable(coverage.rawControllers, [
        { header: "type", value: (row) => row.type },
        { header: "count", value: (row) => row.count },
        { header: "source", value: (row) => row.source },
        { header: "path", value: (row) => row.path },
      ]),
      "",
      "Controller extra details:",
      formatTable(coverage.controllerExtras, [
        { header: "type", value: (row) => row.type },
        { header: "indexes", value: (row) => row.indexes.join(",") },
        { header: "source", value: (row) => row.source },
        { header: "path", value: (row) => row.path },
      ]),
      "",
      "Module extra chunk details:",
      formatTable(coverage.moduleExtraChunks, [
        { header: "type", value: (row) => row.type },
        { header: "count", value: (row) => row.count },
        { header: "source", value: (row) => row.source },
        { header: "path", value: (row) => row.path },
      ]),
      "",
      "Opaque data chunk details:",
      formatTable(coverage.opaqueDataChunks, [
        { header: "type", value: (row) => row.type },
        { header: "index", value: (row) => row.index },
        { header: "name", value: (row) => row.name ?? "" },
        { header: "source", value: (row) => row.source },
        { header: "path", value: (row) => row.path },
      ]),
    );
  }

  if (coverage.errors.length) {
    lines.push("", "Errors:", formatTable(coverage.errors, [
      { header: "file", value: (row) => row.file },
      { header: "message", value: (row) => row.message },
    ]));
  }

  return lines.join("\n");
}

function formatSourceReport(report) {
  const sourceControllerTotal = report.sourceModules.reduce((total, module) => total + module.controllers, 0);
  const dbControllerTotal = report.dbModules.reduce((total, module) => total + module.dbControllers, 0);

  return [
    "SunVox source / DB report",
    "",
    `Source root: ${report.sourceRoot}`,
    `Source modules: ${report.sourceModules.length}`,
    `Source controller declarations: ${sourceControllerTotal}`,
    `DB modules: ${report.dbModules.length}`,
    `DB controller definitions: ${dbControllerTotal}`,
    "",
    "Source modules missing from DB:",
    formatTable(report.missingFromDb, [
      { header: "module", value: (row) => row.module },
      { header: "controllers", value: (row) => row.controllers },
      { header: "file", value: (row) => row.file },
    ]),
    "",
    "DB modules missing from source scan:",
    report.missingFromSource.length ? report.missingFromSource.map((module) => `  - ${module}`).join("\n") : "(none)",
    "",
    "Covered DB modules:",
    formatTable(
      report.dbModules.filter((module) => module.inSource),
      [
        { header: "module", value: (row) => row.module },
        { header: "sourceControllers", value: (row) => row.sourceControllers },
        { header: "dbControllers", value: (row) => row.dbControllers },
      ],
    ),
  ].join("\n");
}

function formatScaffold(scaffold) {
  return JSON.stringify(
    {
      _source: {
        module: scaffold.module,
        file: scaffold.file,
        note: "Best-effort scaffold. Review unresolved string expressions and enum names before inserting into database.json.",
      },
      ...(Object.keys(scaffold.enums).length ? { enums: scaffold.enums } : {}),
      modules: scaffold.modules,
    },
    null,
    2,
  );
}

function formatCheck(check) {
  const lines = [
    "SunVox DB check",
    "",
    `Modules: ${check.summary.modules}`,
    `Enums: ${check.summary.enums}`,
    `Errors: ${check.summary.errors}`,
    `Warnings: ${check.summary.warnings}`,
    "",
    "Errors:",
    check.errors.length ? check.errors.map((error) => `  - ${error}`).join("\n") : "(none)",
    "",
    "Warnings:",
    check.warnings.length ? check.warnings.map((warning) => `  - ${warning}`).join("\n") : "(none)",
  ];
  return lines.join("\n");
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === "coverage") {
    const details = args.includes("--details");
    const json = args.includes("--json");
    const paths = withoutFlags(args, ["--details", "--json"]);
    const coverage = collectCoverage(paths.length ? paths : DEFAULT_SAMPLE_ROOTS);
    console.log(json ? JSON.stringify(coverage, null, 2) : formatCoverage(coverage, { details }));
    return;
  }
  if (command === "report") {
    const json = args.includes("--json");
    const paths = withoutFlags(args, ["--json"]);
    const report = collectSourceReport(paths[0] ?? DEFAULT_SOURCE_ROOT);
    console.log(json ? JSON.stringify(report, null, 2) : formatSourceReport(report));
    return;
  }
  if (command === "scaffold") {
    if (!args[0]) {
      usage();
      process.exitCode = 1;
      return;
    }
    console.log(formatScaffold(collectScaffold(args[0], args[1] ?? DEFAULT_SOURCE_ROOT)));
    return;
  }
  if (command === "check") {
    const json = args.includes("--json");
    const paths = withoutFlags(args, ["--json"]);
    const check = collectDbCheck(paths[0] ?? DEFAULT_SOURCE_ROOT);
    console.log(json ? JSON.stringify(check, null, 2) : formatCheck(check));
    if (!check.ok) {
      process.exitCode = 1;
    }
    return;
  }
  usage();
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  main(process.argv.slice(2));
}

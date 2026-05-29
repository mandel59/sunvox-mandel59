#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseContainer, SUNVOX_DB, validateContainer } from "./sunvox-codec.mjs";

const DEFAULT_SAMPLE_ROOTS = ["music", "instruments", "test/fixtures/sunvox"];
const DEFAULT_SOURCE_ROOT = "var/sunvox_lib/lib_sunvox/psynth";
const SOURCE_BLOCK_ID_FILE = "../sunvox_engine.cpp";
const DEFAULT_STRINGS_FILE = "var/sunvox_lib/lib_sunvox/psynth/psynth_strings.cpp";
const SAMPLE_EXTENSIONS = new Set([".sunvox", ".sunsynth"]);
const MODULE_CATALOG_FIELDS = ["color", "inputs", "outputs", "flags", "flags2"];

function usage() {
  console.error(`Usage:
  node tools/sunvox-db-inspect.mjs coverage [--json] [--details] [--check] [sample-path ...]
  node tools/sunvox-db-inspect.mjs metrics [--json] [sample-path ...]
  node tools/sunvox-db-inspect.mjs report [--json] [source-root]
  node tools/sunvox-db-inspect.mjs controller-diff [--json] [source-root]
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
  const trimmed = label.trim();
  if (/^-+$/u.test(trimmed)) {
    return "none";
  }
  const negative = /^-\s*(.+)$/u.exec(trimmed);
  if (negative) {
    const name = identifierFromLabel(negative[1]).replace(/^value$/u, "unknown");
    return `neg${name.slice(0, 1).toUpperCase()}${name.slice(1)}`;
  }
  const plusSuffix = /^(.+)\+$/u.exec(trimmed);
  if (plusSuffix) {
    const name = enumValueName(plusSuffix[1]);
    return `${name}Wide`;
  }
  const leadingDecimalUnit = /^(\d+)[,.](\d+)\s*([A-Za-z]+)$/u.exec(trimmed);
  if (leadingDecimalUnit) {
    return `${leadingDecimalUnit[3].toLowerCase()}${leadingDecimalUnit[1]}${leadingDecimalUnit[2]}`;
  }
  const leadingNumberUnit = /^(\d+)\s*([A-Za-z]+)$/u.exec(trimmed);
  if (leadingNumberUnit) {
    return `${leadingNumberUnit[2].toLowerCase()}${leadingNumberUnit[1]}`;
  }
  return identifierFromLabel(trimmed).replace(/^value$/u, "unknown");
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

function moduleCoverageType(module) {
  if (module.type) {
    return module.type;
  }
  if (Object.keys(module).length === 0) {
    return "(empty slot)";
  }
  if (module.flags?.output || module.name === "Output") {
    return "(output slot)";
  }
  return "(missing STYP)";
}

function isSyntheticModuleType(type) {
  return type.startsWith("(") && type.endsWith(")");
}

function coverageModuleKind(module) {
  if (module?.type) {
    return module.type;
  }
  if (module?.flags?.output || module?.name === "Output") {
    return "(output slot)";
  }
  if (module && Object.keys(module).length > 0) {
    return "(missing STYP)";
  }
  return "(empty slot)";
}

function moduleLinkObjects(module, semanticPath, legacyLinksPath, legacySlotsPath) {
  if (Array.isArray(module?.[semanticPath])) {
    return module[semanticPath]
      .filter((link) => Number.isInteger(link?.module))
      .map((link, index) => ({
        slot: Number.isInteger(link.slot) ? link.slot : index,
        linkedModule: link.module,
        peerSlot: link.peerSlot,
      }));
  }
  return (module?.[legacyLinksPath] ?? []).map((linkedModule, slot) => ({
    slot,
    linkedModule,
    peerSlot: module?.[legacySlotsPath]?.[slot],
  }));
}

function collectDocumentLinkIssues(document, source, path, issues) {
  if (document.magic === "SSYN") {
    for (const chunk of document.module?.dataChunks ?? []) {
      if (chunk.container) {
        collectDocumentLinkIssues(chunk.container, source, [...path, `dataChunk[${chunk.index}]`], issues);
      }
    }
    return;
  }

  const modules = document.modules ?? [];
  modules.forEach((module, moduleIndex) => {
    for (const [field, semanticPath, legacyLinksPath, legacySlotsPath] of [
      ["inputs", "inputs", "inputLinks", "inputLinkSlots"],
      ["outputs", "outputs", "outputLinks", "outputLinkSlots"],
    ]) {
      const links = moduleLinkObjects(module, semanticPath, legacyLinksPath, legacySlotsPath);
      if (!links.length) {
        continue;
      }
      links.forEach(({ linkedModule, slot, peerSlot }) => {
        if (linkedModule === -1) {
          return;
        }
        const issue = {
          source,
          path: [...path, moduleLabel(module, moduleIndex)].join(" / "),
          module: moduleIndex,
          field,
          linkIndex: slot,
          linkedModule,
          slot: peerSlot,
        };
        if (!Number.isInteger(linkedModule)) {
          issues.push({ ...issue, reason: "non-integer module reference" });
        } else if (linkedModule < 0 || linkedModule >= modules.length) {
          issues.push({ ...issue, reason: "module reference out of range" });
        } else if (coverageModuleKind(modules[linkedModule]) === "(empty slot)") {
          issues.push({ ...issue, reason: "module reference points to an empty slot" });
        }
      });
    }

    for (const chunk of module?.dataChunks ?? []) {
      if (chunk.container) {
        collectDocumentLinkIssues(
          chunk.container,
          source,
          [...path, moduleLabel(module, moduleIndex), `dataChunk[${chunk.index}]`],
          issues,
        );
      }
    }
  });
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
  const linkIssues = [];

  for (const file of sampleFiles) {
    try {
      const document = parseContainer(readFileSync(file));
      collectDocumentModules(document, relative(process.cwd(), file), [], modules);
      collectDocumentLinkIssues(document, relative(process.cwd(), file), [], linkIssues);
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
  const modulesWithoutType = [];

  for (const { source, path, module } of modules) {
    const type = moduleCoverageType(module);
    increment(moduleTypes, type);
    if (module.type && !SUNVOX_DB.modules[module.type]) {
      increment(missingDbTypes, module.type);
    }
    if (!module.type) {
      modulesWithoutType.push({
        source,
        path,
        kind: type,
        keys: Object.keys(module),
      });
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
    unusedDbModuleTypes: Object.keys(SUNVOX_DB.modules)
      .filter((moduleType) => !moduleTypes.has(moduleType))
      .sort(compareText),
    missingDbTypes: [...missingDbTypes.entries()].sort(([a], [b]) => compareText(a, b)),
    rawControllers,
    controllerExtras,
    moduleExtraChunks,
    opaqueDataChunks,
    modulesWithoutType,
    linkIssues,
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

function extractLocalDefines(text) {
  const defines = new Map();
  for (const match of text.matchAll(/^#define\s+([A-Z0-9_]+)\s+(.+)$/gmu)) {
    defines.set(match[1], match[2].replace(/\/\/.*$/u, "").trim());
  }
  return defines;
}

function resolveIntegerExpression(expression, defines) {
  if (expression === undefined) {
    return undefined;
  }
  const normalized = expression.trim();
  if (/^-?\d+$/u.test(normalized)) {
    return Number(normalized);
  }
  const defined = defines.get(normalized);
  if (defined !== undefined && /^-?\d+$/u.test(defined)) {
    return Number(defined);
  }
  return normalized;
}

const FLAG_NAME_ALIASES = new Map([
  ["NO_SCOPE_BUF", "noScopeBuffer"],
  ["OUTPUT_IS_EMPTY", "outputIsEmpty"],
]);

const FLAG_EXPRESSION_ALIASES = new Map([
  ["PSYNTH_FLAG2_NOTE_IO", ["noteSender", "noteReceiver"]],
]);

function flagNameFromMacro(macro) {
  const normalized = macro.replace(/^PSYNTH_FLAG2?_/u, "");
  return FLAG_NAME_ALIASES.get(normalized) ?? identifierFromLabel(normalized);
}

function decodeFlagExpression(expression) {
  if (expression === undefined) {
    return undefined;
  }
  const flags = [];
  for (const token of expression.split("|").map((part) => part.trim()).filter(Boolean)) {
    const alias = FLAG_EXPRESSION_ALIASES.get(token);
    if (alias) {
      flags.push(...alias);
    } else if (/^PSYNTH_FLAG2?_[A-Z0-9_]+$/u.test(token)) {
      flags.push(flagNameFromMacro(token));
    } else {
      flags.push(token);
    }
  }
  return flags;
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
  const defines = extractLocalDefines(text);
  const inputs = extractCaseReturnExpression(text, "PS_CMD_GET_INPUTS_NUM");
  const outputs = extractCaseReturnExpression(text, "PS_CMD_GET_OUTPUTS_NUM");
  const flags = extractCaseReturnExpression(text, "PS_CMD_GET_FLAGS");
  const flags2 = extractCaseReturnExpression(text, "PS_CMD_GET_FLAGS2");
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
    inputs: resolveIntegerExpression(inputs, defines),
    outputs: resolveIntegerExpression(outputs, defines),
    flags: decodeFlagExpression(flags),
    flags2: decodeFlagExpression(flags2),
  };
}

function collectModuleCatalogGaps(sourceModules) {
  return MODULE_CATALOG_FIELDS.map((field) => {
    const sourceModulesWithField = sourceModules.filter((module) => module[field] !== undefined);
    const dbModulesWithField = sourceModulesWithField.filter(
      (module) => SUNVOX_DB.modules[module.module]?.[field] !== undefined,
    );
    return {
      field,
      sourceModules: sourceModulesWithField.length,
      dbModules: dbModulesWithField.length,
      missingDbModules: sourceModulesWithField.length - dbModulesWithField.length,
    };
  });
}

function catalogValueText(value) {
  return Array.isArray(value) ? value.join("|") : String(value);
}

function catalogValuesEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return Array.isArray(left) && Array.isArray(right) && left.join("\0") === right.join("\0");
  }
  return left === right;
}

function checkModuleCatalogMetadata(errors, moduleName, moduleDefinition, source) {
  if (!source) {
    return;
  }
  for (const field of MODULE_CATALOG_FIELDS) {
    const sourceValue = source[field];
    if (sourceValue === undefined) {
      continue;
    }
    const dbValue = moduleDefinition[field];
    if (dbValue === undefined) {
      errors.push(`${moduleName}: missing module catalog ${field}`);
    } else if (!catalogValuesEqual(dbValue, sourceValue)) {
      errors.push(
        `${moduleName}: module catalog ${field} mismatch source=${catalogValueText(sourceValue)} db=${catalogValueText(dbValue)}`,
      );
    }
  }
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

function collectSourceModuleControllers(module, strings) {
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
    controllers,
    enums: Object.fromEntries(enums),
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
  const scaffold = collectSourceModuleControllers(module, strings);

  return {
    module: module.module,
    file: module.file,
    enums: scaffold.enums,
    modules: {
      [module.module]: {
        controllers: scaffold.controllers,
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
    moduleCatalogGaps: collectModuleCatalogGaps(modules),
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

const CONTROLLER_STRING_COMPARE_FIELDS = new Set(["type", "unit", "scale"]);
const CONTROLLER_NUMBER_COMPARE_FIELDS = new Set(["min", "max", "default", "normal", "group", "displayOffset"]);
const CONTROLLER_COMPARE_FIELDS = [
  ...CONTROLLER_STRING_COMPARE_FIELDS,
  ...CONTROLLER_NUMBER_COMPARE_FIELDS,
];

function controllerFieldIsComparable(field, value) {
  if (CONTROLLER_STRING_COMPARE_FIELDS.has(field)) {
    return value !== undefined;
  }
  return CONTROLLER_NUMBER_COMPARE_FIELDS.has(field) && Number.isInteger(value);
}

function enumValueUnitPrefix(enumName) {
  const normalized = enumName.toLowerCase();
  if (normalized.endsWith("hz") || normalized.includes("samplerate")) {
    return "hz";
  }
  if (normalized.endsWith("ms")) {
    return "ms";
  }
  if (normalized.includes("buffersamples")) {
    return "samples";
  }
  return "";
}

const ENUM_COMPARE_VALUE_ALIASES = new Map([
  ["bufOverlap:0", "none"],
  ["allpass_mode:onimproved", "improved"],
]);

function canonicalEnumValue(value, enumName) {
  const compact = String(value).replace(/[^0-9A-Za-z]+/gu, "");
  const alias = ENUM_COMPARE_VALUE_ALIASES.get(`${enumName}:${compact}`) ??
    ENUM_COMPARE_VALUE_ALIASES.get(`${enumName}:${compact.toLowerCase()}`);
  if (alias) {
    return alias;
  }
  if (/^\d+$/u.test(compact)) {
    return `${enumValueUnitPrefix(enumName)}${compact}`.toLowerCase();
  }
  return compact.toLowerCase();
}

function enumCompareKeys(left, right, leftController, rightController) {
  const mins = [leftController?.min, rightController?.min].filter(Number.isInteger);
  const maxes = [leftController?.max, rightController?.max].filter(Number.isInteger);
  const min = mins.length > 0 ? Math.max(...mins) : Number.NEGATIVE_INFINITY;
  const max = maxes.length > 0 ? Math.min(...maxes) : Number.POSITIVE_INFINITY;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys]
    .map(Number)
    .filter((key) => Number.isInteger(key) && key >= min && key <= max)
    .sort((a, b) => a - b)
    .map(String);
}

function enumValuesEqual(left, right, leftName = "", rightName = "", leftController, rightController) {
  if (!left || !right) {
    return false;
  }
  const keys = enumCompareKeys(left, right, leftController, rightController);
  if (keys.some((key) => left[key] === undefined || right[key] === undefined)) {
    return false;
  }
  return keys.every((key) => canonicalEnumValue(left[key], leftName) === canonicalEnumValue(right[key], rightName));
}

export function collectControllerDiff(sourceRoot = DEFAULT_SOURCE_ROOT) {
  const report = collectSourceReport(sourceRoot);
  const strings = loadStringTable();
  const mismatches = [];
  const skippedModules = [];
  let comparedModules = 0;

  for (const sourceModule of report.sourceModules) {
    const moduleDefinition = SUNVOX_DB.modules[sourceModule.module];
    if (!moduleDefinition) {
      continue;
    }
    if (sourceModule.module === "MetaModule") {
      skippedModules.push({
        module: sourceModule.module,
        reason: "custom user controllers are represented from data chunks",
      });
      continue;
    }
    if (hasControllerRepeat(moduleDefinition)) {
      skippedModules.push({
        module: sourceModule.module,
        reason: "DB uses repeated controller templates",
      });
      continue;
    }

    comparedModules += 1;
    const sourceScaffold = collectSourceModuleControllers(sourceModule, strings);
    const sourceControllers = sourceScaffold.controllers;
    const dbControllers = expandControllerDefinitions(moduleDefinition.controllers);
    const sourceByIndex = new Map(sourceControllers.map((controller) => [controller.index, controller]));
    const dbByIndex = new Map(dbControllers.map((controller) => [controller.index, controller]));

    for (const sourceController of sourceControllers) {
      const dbController = dbByIndex.get(sourceController.index);
      if (!dbController) {
        mismatches.push({
          module: sourceModule.module,
          index: sourceController.index,
          controller: sourceController.name,
          field: "(missing DB controller)",
          source: sourceController.label,
          db: undefined,
        });
        continue;
      }
      for (const field of CONTROLLER_COMPARE_FIELDS) {
        if (!controllerFieldIsComparable(field, sourceController[field])) {
          continue;
        }
        if (sourceController[field] !== dbController[field]) {
          mismatches.push({
            module: sourceModule.module,
            index: sourceController.index,
            controller: dbController.name ?? sourceController.name,
            field,
            source: sourceController[field],
            db: dbController[field],
          });
        }
      }
      if (sourceController.type === "enum") {
        const sourceEnumValues = sourceScaffold.enums[sourceController.enum];
        const dbEnumValues = SUNVOX_DB.enums[dbController.enum];
        if (
          sourceEnumValues &&
          dbEnumValues &&
          !enumValuesEqual(
            sourceEnumValues,
            dbEnumValues,
            sourceController.enum,
            dbController.enum,
            sourceController,
            dbController,
          )
        ) {
          mismatches.push({
            module: sourceModule.module,
            index: sourceController.index,
            controller: dbController.name ?? sourceController.name,
            field: "enumValues",
            source: sourceController.enum,
            db: dbController.enum,
          });
        }
      }
    }

    for (const dbController of dbControllers) {
      if (!sourceByIndex.has(dbController.index)) {
        mismatches.push({
          module: sourceModule.module,
          index: dbController.index,
          controller: dbController.name,
          field: "(extra DB controller)",
          source: undefined,
          db: dbController.label,
        });
      }
    }
  }

  return {
    sourceRoot,
    comparedModules,
    skippedModules,
    mismatches,
    summary: {
      comparedModules,
      skippedModules: skippedModules.length,
      mismatches: mismatches.length,
    },
  };
}

function dataDefinitionLabel(definition) {
  if (Number.isInteger(definition.index)) {
    return `${definition.name ?? "(unnamed)"}#${definition.index}`;
  }
  if (Number.isInteger(definition.start) && Number.isInteger(definition.end)) {
    return `${definition.name ?? "(unnamed)"}#${definition.start}-${definition.end}`;
  }
  return definition.name ?? "(unnamed)";
}

function checkNamedReference(errors, moduleName, subject, kind, name, collection) {
  if (name && !collection?.[name]) {
    errors.push(`${moduleName}: ${subject} references missing ${kind} ${name}`);
  }
}

function checkBinaryFields(errors, moduleName, subject, fields = []) {
  for (const field of fields) {
    const fieldSubject = `${subject} field ${field.name ?? "(unnamed)"}`;
    checkNamedReference(errors, moduleName, fieldSubject, "enum", field.enum, SUNVOX_DB.enums);
    checkNamedReference(errors, moduleName, fieldSubject, "bitfield", field.bitfield, SUNVOX_DB.bitfields);
    checkNamedReference(errors, moduleName, fieldSubject, "bitflags", field.bitflags, SUNVOX_DB.bitflags);
  }
}

function checkBitfieldDefinitions(errors) {
  for (const [bitfieldName, definition] of Object.entries(SUNVOX_DB.bitfields ?? {})) {
    checkBinaryFields(errors, `bitfield:${bitfieldName}`, "packed field", definition.fields);
  }
}

function checkDataDefinitionReferences(errors, moduleName, definition) {
  const subject = `data chunk ${dataDefinitionLabel(definition)}`;
  checkStorageMetadata(errors, `${moduleName}: ${subject}`, definition);
  checkNamedReference(errors, moduleName, subject, "flag bitfield", definition.flagBitfield, SUNVOX_DB.bitfields);
  checkNamedReference(errors, moduleName, subject, "flag bitflags", definition.flagBitflags, SUNVOX_DB.bitflags);
  checkNamedReference(errors, moduleName, subject, "index enum", definition.indexEnum, SUNVOX_DB.enums);
  checkBinaryFields(errors, moduleName, subject, definition.fields);
}

function claimDataChunkIndex(errors, moduleName, owners, index, owner) {
  const previousOwner = owners.get(index);
  if (previousOwner) {
    errors.push(`${moduleName}: data chunk index ${index} is defined by both ${previousOwner} and ${owner}`);
    return;
  }
  owners.set(index, owner);
}

function collectSourceBlockIds(sourceRoot) {
  const sourcePath = resolve(sourceRoot, SOURCE_BLOCK_ID_FILE);
  if (!safeStat(sourcePath)?.isFile()) {
    return { sourcePath, ids: undefined };
  }
  const source = readFileSync(sourcePath, "utf8");
  const match = source.match(/const char\* g_sunvox_block_id_names\[\] =\s*\{([\s\S]*?)\};/u);
  if (!match) {
    return { sourcePath, ids: undefined };
  }
  const ids = [...match[1].matchAll(/"([^"]{4})"/gu)].map((item) => item[1]);
  return { sourcePath, ids };
}

const CHUNK_SOURCE_TYPES = new Set([
  "int32",
  "uint32",
  "uint16",
  "uint8",
  "int8",
  "bytes",
  "string",
  "container",
  "empty",
]);
const CHUNK_VALUE_KINDS = new Set([
  "bitset",
  "bytes",
  "color",
  "container",
  "controller",
  "controllerLinks",
  "count",
  "curve",
  "enum",
  "envelope",
  "events",
  "flags",
  "grid",
  "harmonics",
  "icon",
  "index",
  "instrument",
  "level",
  "linkSlots",
  "links",
  "mapping",
  "midi",
  "options",
  "position",
  "rate",
  "scale",
  "sample",
  "sampleData",
  "slots",
  "state",
  "tempo",
  "terminator",
  "text",
  "version",
  "waveform",
]);
const RUNTIME_CONSTRAINT_SCOPES = new Set(["project", "module", "moduleLink"]);
const RUNTIME_CONSTRAINT_KINDS = new Set(["integerRange", "maxUtf8Bytes"]);
const RUNTIME_CONSTRAINT_SEVERITIES = new Set(["warning", "error"]);

function checkStorageMetadata(errors, subject, definition) {
  if (definition.sourceType && !CHUNK_SOURCE_TYPES.has(definition.sourceType)) {
    errors.push(`${subject} has invalid sourceType ${definition.sourceType}`);
  }
  if (definition.valueKind && !CHUNK_VALUE_KINDS.has(definition.valueKind)) {
    errors.push(`${subject} has invalid valueKind ${definition.valueKind}`);
  }
}

function checkChunkStorageMetadata(errors, chunk) {
  checkStorageMetadata(errors, `chunk ${chunk.id}`, chunk);
  if (chunk.signedRoundTrip && chunk.type !== "int32") {
    errors.push(`chunk ${chunk.id} is marked signedRoundTrip but uses ${chunk.type} payload type`);
  }
}

function checkChunkDefinitions(errors, warnings, sourceRoot) {
  const chunkIds = new Set();
  for (const chunk of SUNVOX_DB.chunks) {
    if (chunkIds.has(chunk.id)) {
      errors.push(`duplicate chunk id ${chunk.id}`);
    }
    chunkIds.add(chunk.id);
    checkChunkStorageMetadata(errors, chunk);
  }
  for (const chunk of SUNVOX_DB.chunks) {
    if (chunk.linkSlots?.linkChunk && !chunkIds.has(chunk.linkSlots.linkChunk)) {
      errors.push(`chunk ${chunk.id} linkSlots references missing link chunk ${chunk.linkSlots.linkChunk}`);
    }
    if (chunk.linkSlots) {
      for (const field of ["localLinksPath", "semanticPath", "slotCountPath"]) {
        if (!chunk.linkSlots[field]) {
          errors.push(`chunk ${chunk.id} linkSlots is missing ${field}`);
        }
      }
    }
  }

  for (const [scopeName, scope] of Object.entries(SUNVOX_DB.grammar.scopes ?? {})) {
    for (const field of scope.fields ?? []) {
      if (!chunkIds.has(field.chunk)) {
        errors.push(`grammar scope ${scopeName} references missing chunk ${field.chunk}`);
      }
      checkNamedReference(errors, `grammar:${scopeName}`, `field ${field.path}`, "enum", field.enum, SUNVOX_DB.enums);
      checkNamedReference(
        errors,
        `grammar:${scopeName}`,
        `field ${field.path}`,
        "bitfield",
        field.bitfield,
        SUNVOX_DB.bitfields,
      );
      checkNamedReference(
        errors,
        `grammar:${scopeName}`,
        `field ${field.path}`,
        "bitflags",
        field.bitflags,
        SUNVOX_DB.bitflags,
      );
    }
  }

  const dataChunkGrammar = SUNVOX_DB.moduleDataChunkGrammar;
  if (dataChunkGrammar) {
    for (const field of ["countChunk", "indexChunk", "payloadChunk"]) {
      const chunkId = dataChunkGrammar[field];
      if (!chunkIds.has(chunkId)) {
        errors.push(`moduleDataChunkGrammar ${field} references missing chunk ${chunkId}`);
      }
    }
    for (const metadata of dataChunkGrammar.metadataChunks ?? []) {
      if (!chunkIds.has(metadata.chunk)) {
        errors.push(`moduleDataChunkGrammar metadata ${metadata.path} references missing chunk ${metadata.chunk}`);
      }
    }
  }

  const sourceBlocks = collectSourceBlockIds(sourceRoot);
  if (!sourceBlocks.ids) {
    warnings.push(`could not read SunVox block id list from ${relative(process.cwd(), sourceBlocks.sourcePath)}`);
    return;
  }

  const sourceIds = new Set(sourceBlocks.ids);
  for (const id of sourceBlocks.ids) {
    if (!chunkIds.has(id)) {
      errors.push(`source block id ${id} is missing from DB chunks`);
    }
  }
  for (const id of chunkIds) {
    if (!sourceIds.has(id)) {
      errors.push(`DB chunk id ${id} is missing from source block id list`);
    }
  }
}

function checkRuntimeConstraints(errors) {
  const ids = new Set();
  for (const rule of SUNVOX_DB.runtimeConstraints ?? []) {
    if (!rule.id) {
      errors.push("runtime constraint is missing id");
      continue;
    }
    if (ids.has(rule.id)) {
      errors.push(`duplicate runtime constraint id ${rule.id}`);
    }
    ids.add(rule.id);
    if (!RUNTIME_CONSTRAINT_SCOPES.has(rule.scope)) {
      errors.push(`runtime constraint ${rule.id} has invalid scope ${rule.scope}`);
    }
    if (!RUNTIME_CONSTRAINT_KINDS.has(rule.kind)) {
      errors.push(`runtime constraint ${rule.id} has invalid kind ${rule.kind}`);
    }
    if (!RUNTIME_CONSTRAINT_SEVERITIES.has(rule.severity)) {
      errors.push(`runtime constraint ${rule.id} has invalid severity ${rule.severity}`);
    }
    if (!rule.path) {
      errors.push(`runtime constraint ${rule.id} is missing path`);
    }
    if (rule.scope === "moduleLink" && !["inputs", "outputs"].includes(rule.relation)) {
      errors.push(`runtime constraint ${rule.id} has invalid module link relation ${rule.relation}`);
    }
    if (rule.kind === "integerRange" && rule.min === undefined && rule.max === undefined) {
      errors.push(`runtime constraint ${rule.id} integerRange is missing min or max`);
    }
    if (rule.kind === "maxUtf8Bytes" && !Number.isInteger(rule.maxBytes)) {
      errors.push(`runtime constraint ${rule.id} maxUtf8Bytes is missing maxBytes`);
    }
    if (rule.observedBehavior) {
      if (!Object.hasOwn(rule.observedBehavior, "probeValue")) {
        errors.push(`runtime constraint ${rule.id} observedBehavior is missing probeValue`);
      }
      if (!Object.hasOwn(rule.observedBehavior, "savedValue")) {
        errors.push(`runtime constraint ${rule.id} observedBehavior is missing savedValue`);
      }
    }
  }
}

export function collectDbCheck(sourceRoot = DEFAULT_SOURCE_ROOT) {
  const errors = [];
  const warnings = [];
  const sourceReport = collectSourceReport(sourceRoot);
  const sourceByName = new Map(sourceReport.sourceModules.map((module) => [module.module, module]));

  checkChunkDefinitions(errors, warnings, sourceRoot);
  checkBitfieldDefinitions(errors);
  checkRuntimeConstraints(errors);

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

    const dataChunkOwners = new Map();
    for (const dataChunk of moduleDefinition.dataChunks ?? []) {
      if (!Number.isInteger(dataChunk.index)) {
        errors.push(`${moduleName}: data chunk ${dataChunk.name ?? "(unnamed)"} has non-integer index`);
        continue;
      }
      const owner = `data chunk ${dataDefinitionLabel(dataChunk)}`;
      claimDataChunkIndex(errors, moduleName, dataChunkOwners, dataChunk.index, owner);
      checkDataDefinitionReferences(errors, moduleName, dataChunk);
    }

    for (const range of moduleDefinition.dataChunkRanges ?? []) {
      const owner = `data chunk range ${dataDefinitionLabel(range)}`;
      const step = range.step ?? 1;
      checkDataDefinitionReferences(errors, moduleName, range);
      if (!Number.isInteger(range.start) || !Number.isInteger(range.end) || range.end < range.start) {
        errors.push(`${moduleName}: invalid data chunk range ${range.name ?? "(unnamed)"}`);
        continue;
      }
      if (!Number.isInteger(step) || step < 1) {
        errors.push(`${moduleName}: invalid data chunk range step ${range.name ?? "(unnamed)"}`);
        continue;
      }
      for (let index = range.start; index <= range.end; index += step) {
        claimDataChunkIndex(errors, moduleName, dataChunkOwners, index, owner);
      }
    }

    const source = sourceByName.get(moduleName);
    checkModuleCatalogMetadata(errors, moduleName, moduleDefinition, source);
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

const SCALAR_CHUNK_TYPES = new Set(["int32", "uint32"]);

function collectChunkStorageMetrics() {
  const chunks = SUNVOX_DB.chunks;
  const reviewedChunks = chunks.filter((chunk) => chunk.sourceType);
  const scalarChunks = SUNVOX_DB.chunks.filter((chunk) => SCALAR_CHUNK_TYPES.has(chunk.type));
  const reviewedScalarChunks = scalarChunks.filter((chunk) => chunk.sourceType);
  const signedRoundTripChunks = scalarChunks.filter((chunk) => chunk.signedRoundTrip);
  return {
    chunks: chunks.length,
    reviewedChunks: reviewedChunks.length,
    reviewPercent: Number(((reviewedChunks.length / chunks.length) * 100).toFixed(1)),
    reviewedChunkIds: reviewedChunks.map((chunk) => chunk.id).sort(compareText),
    scalarChunks: scalarChunks.length,
    reviewedScalarChunks: reviewedScalarChunks.length,
    signedRoundTripChunks: signedRoundTripChunks.length,
    scalarReviewPercent: Number(((reviewedScalarChunks.length / scalarChunks.length) * 100).toFixed(1)),
    reviewedScalarChunkIds: reviewedScalarChunks.map((chunk) => chunk.id).sort(compareText),
  };
}

function collectDataChunkLayoutMetrics() {
  const layouts = [];
  for (const [moduleName, moduleDefinition] of Object.entries(SUNVOX_DB.modules)) {
    for (const definition of moduleDefinition.dataChunks ?? []) {
      layouts.push({ moduleName, label: dataDefinitionLabel(definition), definition });
    }
    for (const definition of moduleDefinition.dataChunkRanges ?? []) {
      layouts.push({ moduleName, label: dataDefinitionLabel(definition), definition });
    }
  }
  const reviewedLayouts = layouts.filter(
    (layout) => layout.definition.sourceType && layout.definition.valueKind && layout.definition.sourceSymbol,
  );
  const layoutReviewPercent =
    layouts.length === 0 ? 100 : Number(((reviewedLayouts.length / layouts.length) * 100).toFixed(1));
  return {
    dataChunkLayouts: layouts.length,
    reviewedDataChunkLayouts: reviewedLayouts.length,
    layoutReviewPercent,
    reviewedDataChunkLayoutIds: reviewedLayouts
      .map((layout) => `${layout.moduleName}:${layout.label}`)
      .sort(compareText),
  };
}

function collectModuleCatalogMetrics(report) {
  const fields = report.moduleCatalogGaps ?? [];
  const sourceFields = fields.reduce((total, field) => total + field.sourceModules, 0);
  const dbFields = fields.reduce((total, field) => total + field.dbModules, 0);
  return {
    sourceFields,
    dbFields,
    missingFields: fields.reduce((total, field) => total + field.missingDbModules, 0),
    coveragePercent: sourceFields === 0 ? 100 : Number(((dbFields / sourceFields) * 100).toFixed(1)),
  };
}

function collectValidationMetrics(sampleRoots = DEFAULT_SAMPLE_ROOTS) {
  const files = findFiles(sampleRoots, SAMPLE_EXTENSIONS);
  const filesWithIssues = [];
  let issues = 0;
  let warnings = 0;
  let errors = 0;
  for (const file of files) {
    try {
      const result = validateContainer(parseContainer(readFileSync(file)));
      if (result.issues.length === 0) {
        continue;
      }
      filesWithIssues.push({
        file: relative(process.cwd(), file),
        issues: result.issues,
      });
      issues += result.issues.length;
      warnings += result.issues.filter((issue) => issue.severity === "warning").length;
      errors += result.issues.filter((issue) => issue.severity === "error").length;
    } catch (error) {
      errors += 1;
      issues += 1;
      filesWithIssues.push({
        file: relative(process.cwd(), file),
        issues: [
          {
            severity: "error",
            rule: "parse",
            path: "$",
            message: error instanceof Error ? error.message : String(error),
          },
        ],
      });
    }
  }
  return {
    files: files.length,
    issues,
    warnings,
    errors,
    filesWithIssues,
  };
}

export function collectProjectMetrics(sampleRoots = DEFAULT_SAMPLE_ROOTS, sourceRoot = DEFAULT_SOURCE_ROOT) {
  const coverage = collectCoverage(sampleRoots);
  const report = collectSourceReport(sourceRoot);
  const controllerDiff = collectControllerDiff(sourceRoot);
  const dbCheck = collectDbCheck(sourceRoot);
  const validation = collectValidationMetrics(sampleRoots);
  const chunkStorage = collectChunkStorageMetrics();
  const dataChunkLayouts = collectDataChunkLayoutMetrics();
  const moduleCatalog = collectModuleCatalogMetrics(report);
  const coverageGateFailures = coverageFailures(coverage);
  const sampledDbModuleTypes = coverage.moduleTypes
    .map(([moduleType]) => moduleType)
    .filter((moduleType) => SUNVOX_DB.modules[moduleType])
    .sort(compareText);
  const dbModuleTypes = coverage.dbModuleTypes;

  return {
    sampleRoots,
    sourceRoot,
    summary: {
      dbModules: dbModuleTypes.length,
      sampledDbModules: sampledDbModuleTypes.length,
      unsampledDbModules: coverage.unusedDbModuleTypes.length,
      sampleCoveragePercent: Number(((sampledDbModuleTypes.length / dbModuleTypes.length) * 100).toFixed(1)),
      decodedModules: coverage.moduleCount,
      uniqueSampleModuleTypes: coverage.moduleTypes.length,
      sourceModules: report.sourceModules.length,
      sourceModulesMissingFromDb: report.missingFromDb.length,
      dbModulesMissingFromSource: report.missingFromSource.length,
      moduleCatalogFields: moduleCatalog.sourceFields,
      dbModuleCatalogFields: moduleCatalog.dbFields,
      moduleCatalogCoveragePercent: moduleCatalog.coveragePercent,
      missingModuleCatalogFields: moduleCatalog.missingFields,
      controllerMetadataMismatches: controllerDiff.summary.mismatches,
      dbCheckErrors: dbCheck.summary.errors,
      dbCheckWarnings: dbCheck.summary.warnings,
      runtimeConstraints: SUNVOX_DB.runtimeConstraints?.length ?? 0,
      observedRuntimeBehaviors: (SUNVOX_DB.runtimeConstraints ?? []).filter((rule) => rule.observedBehavior).length,
      validationFiles: validation.files,
      validationIssues: validation.issues,
      validationWarnings: validation.warnings,
      validationErrors: validation.errors,
      chunks: chunkStorage.chunks,
      reviewedChunks: chunkStorage.reviewedChunks,
      scalarChunks: chunkStorage.scalarChunks,
      reviewedScalarChunks: chunkStorage.reviewedScalarChunks,
      signedRoundTripChunks: chunkStorage.signedRoundTripChunks,
      chunkStorageReviewPercent: chunkStorage.reviewPercent,
      scalarChunkStorageReviewPercent: chunkStorage.scalarReviewPercent,
      dataChunkLayouts: dataChunkLayouts.dataChunkLayouts,
      reviewedDataChunkLayouts: dataChunkLayouts.reviewedDataChunkLayouts,
      dataChunkLayoutReviewPercent: dataChunkLayouts.layoutReviewPercent,
      moduleLinkIssues: coverage.linkIssues.length,
      coverageGateFailures: coverageGateFailures.length,
    },
    gates: {
      sourceDbModules: report.missingFromDb.length === 0 && report.missingFromSource.length === 0,
      dbCheck: dbCheck.ok,
      coverage: coverageGateFailures.length === 0,
      controllerMetadata: controllerDiff.summary.mismatches === 0,
      validation: validation.issues === 0,
      ok:
        report.missingFromDb.length === 0 &&
        report.missingFromSource.length === 0 &&
        dbCheck.ok &&
        coverageGateFailures.length === 0 &&
        controllerDiff.summary.mismatches === 0 &&
        validation.issues === 0,
    },
    sampledDbModuleTypes,
    unsampledDbModuleTypes: coverage.unusedDbModuleTypes,
    moduleCatalog,
    validation,
    chunkStorage,
    dataChunkLayouts,
    coverageGateFailures,
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
  const moduleWithoutTypeSummary = aggregateRows(coverage.modulesWithoutType, (row) => row.kind);
  const opaqueDataSummary = aggregateRows(
    coverage.opaqueDataChunks,
    (row) => `${row.type} ${row.index} ${row.name ?? ""}`.trim(),
    (group, row) => {
      group.type = row.type;
      group.index = row.index;
      group.name = row.name ?? "";
    },
  );
  const linkIssueSummary = aggregateRows(coverage.linkIssues, (row) => row.reason);

  const lines = [
    "SunVox DB coverage",
    "",
    `Files: ${coverage.files.length}`,
    ...coverage.files.map((file) => `  - ${file}`),
    "",
    `Decoded modules including embedded containers: ${coverage.moduleCount}`,
    `Unique module types/kinds in samples: ${coverage.moduleTypes.length}`,
    `DB module types: ${coverage.dbModuleTypes.length}`,
    "",
    "Next raw-controller targets:",
    formatTable(rawControllerSummary.slice(0, 8), [
      { header: "type", value: (row) => row.key },
      { header: "modules", value: (row) => row.count },
      { header: "controllerValues", value: (row) => row.controllers },
    ]),
    "",
    "Module types/kinds in samples:",
    formatTable(
      coverage.moduleTypes.map(([type, count]) => ({
        type,
        count,
        db: isSyntheticModuleType(type) ? "n/a" : SUNVOX_DB.modules[type] ? "yes" : "no",
        dbControllers: isSyntheticModuleType(type) ? "" : dbControllerCount(type),
      })),
      [
        { header: "type", value: (row) => row.type },
        { header: "count", value: (row) => row.count },
        { header: "db", value: (row) => row.db },
        { header: "dbControllers", value: (row) => row.dbControllers },
      ],
    ),
    "",
    "Module slots without STYP:",
    formatTable(moduleWithoutTypeSummary, [
      { header: "kind", value: (row) => row.key },
      { header: "modules", value: (row) => row.count },
    ]),
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
    "DB module types not covered by samples:",
    formatTable(
      coverage.unusedDbModuleTypes.map((type) => ({ type })),
      [{ header: "type", value: (row) => row.type }],
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
    "",
    "Module link issues:",
    formatTable(linkIssueSummary, [
      { header: "reason", value: (row) => row.key },
      { header: "links", value: (row) => row.count },
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
      "Module slot details without STYP:",
      formatTable(coverage.modulesWithoutType, [
        { header: "kind", value: (row) => row.kind },
        { header: "keys", value: (row) => row.keys.join(",") },
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
      "",
      "Module link issue details:",
      formatTable(coverage.linkIssues, [
        { header: "reason", value: (row) => row.reason },
        { header: "module", value: (row) => row.module },
        { header: "field", value: (row) => row.field },
        { header: "linkIndex", value: (row) => row.linkIndex },
        { header: "linkedModule", value: (row) => row.linkedModule },
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

function coverageFailures(coverage) {
  const missingStyp = coverage.modulesWithoutType.filter((row) => row.kind === "(missing STYP)");
  return [
    { name: "parse errors", count: coverage.errors.length },
    { name: "missing DB module types", count: coverage.missingDbTypes.length },
    { name: "modules with missing STYP", count: missingStyp.length },
    { name: "raw controller arrays", count: coverage.rawControllers.length },
    { name: "controller extras", count: coverage.controllerExtras.length },
    { name: "module extra chunks", count: coverage.moduleExtraChunks.length },
    { name: "opaque data chunks", count: coverage.opaqueDataChunks.length },
    { name: "module link issues", count: coverage.linkIssues.length },
  ].filter((failure) => failure.count > 0);
}

function formatCoverageGate(failures) {
  if (failures.length === 0) {
    return "Coverage gate: passed";
  }
  return [
    "Coverage gate: failed",
    ...failures.map((failure) => `  - ${failure.name}: ${failure.count}`),
  ].join("\n");
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
    "Module catalog field DB coverage:",
    formatTable(report.moduleCatalogGaps, [
      { header: "field", value: (row) => row.field },
      { header: "sourceModules", value: (row) => row.sourceModules },
      { header: "dbModules", value: (row) => row.dbModules },
      { header: "missingDbModules", value: (row) => row.missingDbModules },
    ]),
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

function formatControllerDiff(diff) {
  return [
    "SunVox controller source / DB diff",
    "",
    `Source root: ${diff.sourceRoot}`,
    `Compared modules: ${diff.summary.comparedModules}`,
    `Skipped modules: ${diff.summary.skippedModules}`,
    `Mismatches: ${diff.summary.mismatches}`,
    "",
    "Skipped modules:",
    formatTable(diff.skippedModules, [
      { header: "module", value: (row) => row.module },
      { header: "reason", value: (row) => row.reason },
    ]),
    "",
    "Controller metadata mismatches:",
    formatTable(diff.mismatches, [
      { header: "module", value: (row) => row.module },
      { header: "index", value: (row) => row.index },
      { header: "controller", value: (row) => row.controller },
      { header: "field", value: (row) => row.field },
      { header: "source", value: (row) => row.source },
      { header: "db", value: (row) => row.db },
    ]),
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

function formatPercent(value) {
  return `${value.toFixed(1)}%`;
}

function gateLabel(ok) {
  return ok ? "pass" : "fail";
}

function formatProjectMetrics(metrics) {
  const rows = [
    { metric: "DB modules", value: metrics.summary.dbModules },
    { metric: "Sampled DB modules", value: metrics.summary.sampledDbModules },
    { metric: "Unsampled DB modules", value: metrics.summary.unsampledDbModules },
    { metric: "Sample module coverage", value: formatPercent(metrics.summary.sampleCoveragePercent) },
    { metric: "Decoded sample modules", value: metrics.summary.decodedModules },
    { metric: "Unique sample module types/kinds", value: metrics.summary.uniqueSampleModuleTypes },
    { metric: "Source modules", value: metrics.summary.sourceModules },
    { metric: "Source modules missing from DB", value: metrics.summary.sourceModulesMissingFromDb },
    { metric: "DB modules missing from source", value: metrics.summary.dbModulesMissingFromSource },
    { metric: "Module catalog fields", value: metrics.summary.moduleCatalogFields },
    { metric: "DB module catalog fields", value: metrics.summary.dbModuleCatalogFields },
    { metric: "Module catalog coverage", value: formatPercent(metrics.summary.moduleCatalogCoveragePercent) },
    { metric: "Missing module catalog fields", value: metrics.summary.missingModuleCatalogFields },
    { metric: "Controller metadata mismatches", value: metrics.summary.controllerMetadataMismatches },
    { metric: "DB check errors", value: metrics.summary.dbCheckErrors },
    { metric: "Runtime constraints", value: metrics.summary.runtimeConstraints },
    { metric: "Observed runtime behaviors", value: metrics.summary.observedRuntimeBehaviors },
    { metric: "Validation files", value: metrics.summary.validationFiles },
    { metric: "Validation issues", value: metrics.summary.validationIssues },
    { metric: "Validation warnings", value: metrics.summary.validationWarnings },
    { metric: "Validation errors", value: metrics.summary.validationErrors },
    { metric: "Chunks", value: metrics.summary.chunks },
    { metric: "Reviewed chunks", value: metrics.summary.reviewedChunks },
    { metric: "Chunk storage review", value: formatPercent(metrics.summary.chunkStorageReviewPercent) },
    { metric: "Scalar chunks", value: metrics.summary.scalarChunks },
    { metric: "Reviewed scalar chunks", value: metrics.summary.reviewedScalarChunks },
    { metric: "Scalar chunk storage review", value: formatPercent(metrics.summary.scalarChunkStorageReviewPercent) },
    { metric: "Signed round-trip chunks", value: metrics.summary.signedRoundTripChunks },
    { metric: "Data chunk layouts", value: metrics.summary.dataChunkLayouts },
    { metric: "Reviewed data chunk layouts", value: metrics.summary.reviewedDataChunkLayouts },
    { metric: "Data chunk layout review", value: formatPercent(metrics.summary.dataChunkLayoutReviewPercent) },
    { metric: "Module link issues", value: metrics.summary.moduleLinkIssues },
    { metric: "Coverage gate failures", value: metrics.summary.coverageGateFailures },
  ];

  const gateRows = [
    { gate: "source/DB modules", status: gateLabel(metrics.gates.sourceDbModules) },
    { gate: "DB check", status: gateLabel(metrics.gates.dbCheck) },
    { gate: "coverage", status: gateLabel(metrics.gates.coverage) },
    { gate: "controller metadata", status: gateLabel(metrics.gates.controllerMetadata) },
    { gate: "validation", status: gateLabel(metrics.gates.validation) },
    { gate: "overall", status: gateLabel(metrics.gates.ok) },
  ];

  return [
    "SunVox project metrics",
    "",
    `Sample roots: ${metrics.sampleRoots.join(", ")}`,
    `Source root: ${metrics.sourceRoot}`,
    "",
    "Summary:",
    formatTable(rows, [
      { header: "metric", value: (row) => row.metric },
      { header: "value", value: (row) => row.value },
    ]),
    "",
    "Gates:",
    formatTable(gateRows, [
      { header: "gate", value: (row) => row.gate },
      { header: "status", value: (row) => row.status },
    ]),
    "",
    "Unsampled DB module types:",
    metrics.unsampledDbModuleTypes.length
      ? metrics.unsampledDbModuleTypes.map((moduleType) => `  - ${moduleType}`).join("\n")
      : "(none)",
    "",
    "Validation issues:",
    metrics.validation.filesWithIssues.length
      ? metrics.validation.filesWithIssues
          .map((entry) =>
            [
              `  - ${entry.file}`,
              ...entry.issues.map((issue) => `    ${issue.severity}: ${issue.path}: ${issue.message} (${issue.rule})`),
            ].join("\n"),
          )
          .join("\n")
      : "(none)",
    "",
    "Reviewed chunk storage:",
    metrics.chunkStorage.reviewedChunkIds.length
      ? metrics.chunkStorage.reviewedChunkIds.map((chunkId) => `  - ${chunkId}`).join("\n")
      : "(none)",
    "",
    "Reviewed data chunk layouts:",
    metrics.dataChunkLayouts.reviewedDataChunkLayoutIds.length
      ? metrics.dataChunkLayouts.reviewedDataChunkLayoutIds.map((layoutId) => `  - ${layoutId}`).join("\n")
      : "(none)",
  ].join("\n");
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === "coverage") {
    const details = args.includes("--details");
    const json = args.includes("--json");
    const check = args.includes("--check");
    const paths = withoutFlags(args, ["--details", "--json", "--check"]);
    const coverage = collectCoverage(paths.length ? paths : DEFAULT_SAMPLE_ROOTS);
    const failures = coverageFailures(coverage);
    if (json) {
      console.log(JSON.stringify(check ? { ...coverage, ok: failures.length === 0, failures } : coverage, null, 2));
    } else {
      console.log([formatCoverage(coverage, { details }), check ? formatCoverageGate(failures) : ""].filter(Boolean).join("\n\n"));
    }
    if (check && failures.length > 0) {
      process.exitCode = 1;
    }
    return;
  }
  if (command === "metrics") {
    const json = args.includes("--json");
    const paths = withoutFlags(args, ["--json"]);
    const metrics = collectProjectMetrics(paths.length ? paths : DEFAULT_SAMPLE_ROOTS);
    console.log(json ? JSON.stringify(metrics, null, 2) : formatProjectMetrics(metrics));
    if (!metrics.gates.ok) {
      process.exitCode = 1;
    }
    return;
  }
  if (command === "report") {
    const json = args.includes("--json");
    const paths = withoutFlags(args, ["--json"]);
    const report = collectSourceReport(paths[0] ?? DEFAULT_SOURCE_ROOT);
    console.log(json ? JSON.stringify(report, null, 2) : formatSourceReport(report));
    return;
  }
  if (command === "controller-diff") {
    const json = args.includes("--json");
    const paths = withoutFlags(args, ["--json"]);
    const diff = collectControllerDiff(paths[0] ?? DEFAULT_SOURCE_ROOT);
    console.log(json ? JSON.stringify(diff, null, 2) : formatControllerDiff(diff));
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

#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseContainer, SUNVOX_DB, validateContainer } from "./sunvox-codec.mjs";

const DEFAULT_SAMPLE_ROOTS = [
  "music",
  "instruments",
  "generated/music",
  "generated/instruments",
  "test/fixtures/sunvox",
];
const DEFAULT_SOURCE_ROOT = "var/sunvox_lib/lib_sunvox/psynth";
const SOURCE_BLOCK_ID_FILE = "../sunvox_engine.cpp";
const SOURCE_PATTERN_EFFECT_FILE = "../sunvox_engine_audio_callback.cpp";
const DEFAULT_STRINGS_FILE = "var/sunvox_lib/lib_sunvox/psynth/psynth_strings.cpp";
const SAMPLE_EXTENSIONS = new Set([".sunvox", ".sunsynth"]);
const MODULE_CATALOG_FIELDS = ["color", "inputs", "outputs", "flags", "flags2"];
const MODULE_INFO_SCOPE_ID = "module.psCmdGetInfo";

function usage() {
  console.error(`Usage:
  node tools/sunvox-db-inspect.mjs coverage [--json] [--details] [--check] [sample-path ...]
  node tools/sunvox-db-inspect.mjs metrics [--json] [sample-path ...]
  node tools/sunvox-db-inspect.mjs report [--json] [source-root]
  node tools/sunvox-db-inspect.mjs enums [--json] [strings-file]
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

function controllerKey(controller) {
  return controller.path ?? controller.name;
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

function hasCommandCase(text, command) {
  return new RegExp(`case\\s+${command}\\b`, "u").test(text);
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
    hasInfo: hasCommandCase(text, "PS_CMD_GET_INFO"),
    showOffsets: countMatches(text, /psynth_set_ctl_show_offset\s*\(/gu),
    controlFlags: countMatches(text, /psynth_set_ctl_flags\s*\(/gu),
    dynamicLimitFunctions: [...text.matchAll(/static\s+void\s+([A-Za-z0-9_]+_change_ctl_limits)\s*\(/gu)]
      .map((match) => match[1])
      .sort(compareText),
    color: extractCaseReturnString(text, "PS_CMD_GET_COLOR"),
    inputs: resolveIntegerExpression(inputs, defines),
    outputs: resolveIntegerExpression(outputs, defines),
    flags: decodeFlagExpression(flags),
    flags2: decodeFlagExpression(flags2),
  };
}

function collectModuleInfoScope(sourceModules) {
  const sourceRows = sourceModules.filter((module) => module.hasInfo);
  const policy = (SUNVOX_DB.knowledgeScopes ?? []).find((row) => row.id === MODULE_INFO_SCOPE_ID);
  return {
    sourceModules: sourceRows.length,
    modulesMissingInfo: sourceModules.filter((module) => !module.hasInfo).map((module) => module.module),
    policyStatus: policy?.status ?? "(missing)",
    policy,
  };
}

function collectDbDynamicLimits() {
  const rows = [];
  for (const [moduleName, moduleDefinition] of Object.entries(SUNVOX_DB.modules)) {
    for (const controller of expandControllerDefinitions(moduleDefinition.controllers)) {
      if (!controller.dynamicLimits) {
        continue;
      }
      rows.push({
        module: moduleName,
        controller: controllerKey(controller),
        dependency: controller.dynamicLimits.controller,
        source: controller.dynamicLimits.source,
      });
    }
  }
  return rows.sort(
    (a, b) =>
      compareText(a.source ?? "", b.source ?? "") ||
      compareText(a.module, b.module) ||
      compareText(a.controller, b.controller),
  );
}

function collectRuntimeCompileOptions() {
  return new Set((SUNVOX_DB.runtimeProfiles ?? []).flatMap((profile) => Object.keys(profile.compileOptions ?? {})));
}

function collectConditionalControllers() {
  const rows = [];
  for (const [moduleName, moduleDefinition] of Object.entries(SUNVOX_DB.modules)) {
    for (const controller of expandControllerDefinitions(moduleDefinition.controllers)) {
      if (!controller.compileCondition) {
        continue;
      }
      rows.push({
        module: moduleName,
        controller: controllerKey(controller),
        macro: controller.compileCondition.macro,
        whenDefined: controller.compileCondition.whenDefined,
      });
    }
  }
  return rows.sort((a, b) => compareText(a.module, b.module) || compareText(a.controller, b.controller));
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
  return extractRegisterCallsWithConditions(text).map((call) => call.args);
}

function extractActiveCompileConditions(text, offset) {
  const conditions = [];
  for (const line of text.slice(0, offset).split(/\r?\n/u)) {
    const trimmed = line.trim();
    const ifdef = /^#\s*ifdef\s+([A-Za-z_][A-Za-z0-9_]*)\b/u.exec(trimmed);
    if (ifdef) {
      conditions.push({ macro: ifdef[1], whenDefined: true });
      continue;
    }
    const ifndef = /^#\s*ifndef\s+([A-Za-z_][A-Za-z0-9_]*)\b/u.exec(trimmed);
    if (ifndef) {
      conditions.push({ macro: ifndef[1], whenDefined: false });
      continue;
    }
    const ifDefined = /^#\s*if\s+defined\s*\(?\s*([A-Za-z_][A-Za-z0-9_]*)\s*\)?\s*$/u.exec(trimmed);
    if (ifDefined) {
      conditions.push({ macro: ifDefined[1], whenDefined: true });
      continue;
    }
    if (/^#\s*else\b/u.test(trimmed) && conditions.length) {
      const previous = conditions.pop();
      conditions.push({ ...previous, whenDefined: !previous.whenDefined });
      continue;
    }
    if (/^#\s*endif\b/u.test(trimmed)) {
      conditions.pop();
    }
  }
  return conditions;
}

function extractRegisterCallsWithConditions(text) {
  const calls = [];
  const pattern = /psynth_register_ctl\s*\(([\s\S]*?)\);/gu;
  for (const match of text.matchAll(pattern)) {
    calls.push({
      args: splitArguments(match[1]),
      compileCondition: extractActiveCompileConditions(text, match.index).at(-1),
    });
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

export function collectSourceEnums(stringsFile = DEFAULT_STRINGS_FILE) {
  const strings = loadStringTable(stringsFile);
  return [...strings.entries()]
    .filter(([, label]) => label.includes(";"))
    .map(([macro, label]) => ({
      macro,
      enum: enumNameFromMacro(macro, label),
      labels: label.split(";").map((entry) => entry.trim()),
      values: enumValuesFromLabel(label),
    }))
    .sort((a, b) => compareText(a.enum, b.enum) || compareText(a.macro, b.macro));
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
  extractRegisterCallsWithConditions(text).forEach((call, index) => {
    const scaffolded = scaffoldController(call.args, index, strings, metadata);
    if (call.compileCondition) {
      scaffolded.controller.compileCondition = call.compileCondition;
    }
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
  const sourceDynamicLimitFunctions = modules.flatMap((module) =>
    module.dynamicLimitFunctions.map((source) => ({
      module: module.module,
      file: module.file,
      source,
    })),
  );
  const sourceDynamicLimitSourceSet = new Set(sourceDynamicLimitFunctions.map((row) => row.source));
  const dbDynamicLimits = collectDbDynamicLimits();
  const dbDynamicLimitSourceSet = new Set(dbDynamicLimits.map((row) => row.source).filter(Boolean));
  const dbModules = Object.keys(SUNVOX_DB.modules).sort(compareText);
  const dbRows = dbModules.map((module) => ({
    module,
    sourceControllers: sourceByName.get(module)?.controllers,
    dbControllers: dbControllerCount(module),
    inSource: sourceByName.has(module),
  }));
  const knowledgePolicies = SUNVOX_DB.knowledgeScopes ?? [];
  const moduleInfoScope = collectModuleInfoScope(modules);

  return {
    sourceRoot,
    sourceFiles: files.map((file) => relative(process.cwd(), file)),
    sourceModules: modules,
    knowledgePolicies,
    moduleInfoScope,
    moduleCatalogGaps: collectModuleCatalogGaps(modules),
    sourceDynamicLimitFunctions,
    dbDynamicLimits,
    dynamicLimitSourceCoverage: sourceDynamicLimitFunctions.map((row) => ({
      ...row,
      dbControllers: dbDynamicLimits.filter((limit) => limit.source === row.source).length,
    })),
    dbModules: dbRows,
    missingFromDb: modules
      .filter((module) => !SUNVOX_DB.modules[module.module])
      .map((module) => ({
        module: module.module,
        controllers: module.controllers,
        file: module.file,
      })),
    missingFromSource: dbRows.filter((module) => !module.inSource).map((module) => module.module),
    missingDynamicLimitSources: sourceDynamicLimitFunctions.filter((row) => !dbDynamicLimitSourceSet.has(row.source)),
    unknownDynamicLimitSources: [...dbDynamicLimitSourceSet]
      .filter((source) => !sourceDynamicLimitSourceSet.has(source))
      .map((source) => ({
        source,
        controllers: dbDynamicLimits
          .filter((limit) => limit.source === source)
          .map((limit) => `${limit.module}.${limit.controller}`)
          .sort(compareText),
      }))
      .sort((a, b) => compareText(a.source, b.source)),
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

function compileConditionsEqual(left, right) {
  if (!left && !right) {
    return true;
  }
  if (!left || !right) {
    return false;
  }
  return left.macro === right.macro && left.whenDefined === right.whenDefined;
}

function compileConditionText(condition) {
  if (!condition) {
    return undefined;
  }
  return `${condition.whenDefined ? "defined" : "not defined"} ${condition.macro}`;
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
      if (!compileConditionsEqual(sourceController.compileCondition, dbController.compileCondition)) {
        mismatches.push({
          module: sourceModule.module,
          index: sourceController.index,
          controller: dbController.name ?? sourceController.name,
          field: "compileCondition",
          source: compileConditionText(sourceController.compileCondition),
          db: compileConditionText(dbController.compileCondition),
        });
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

function checkTextLayoutPackedFields(errors, subject, packedFields = []) {
  const fieldsByWindow = new Map();
  for (const field of packedFields) {
    const fieldSubject = `${subject} packed field ${field.name ?? "(unnamed)"}`;
    if (!Number.isInteger(field.shift) || field.shift < 0) {
      errors.push(`${fieldSubject} has invalid shift ${field.shift}`);
    }
    if (!Number.isInteger(field.bits) || field.bits < 1 || field.bits > 31) {
      errors.push(`${fieldSubject} has invalid bits ${field.bits}`);
      continue;
    }
    if (field.shift + field.bits > 32) {
      errors.push(`${fieldSubject} exceeds 32-bit storage`);
    }
    if (field.reference && !PACKED_FIELD_REFERENCES.has(field.reference)) {
      errors.push(`${fieldSubject} has invalid reference ${field.reference}`);
    }
    checkNamedReference(errors, subject, `packed field ${field.name}`, "enum", field.enum, SUNVOX_DB.enums);
    checkNamedReference(errors, subject, `packed field ${field.name}`, "bitflags", field.bitflags, SUNVOX_DB.bitflags);

    const maxStored = 2 ** field.bits - 1;
    const range = { min: field.min ?? 0, max: field.max ?? maxStored };
    if (range.min < 0 || range.max > maxStored || range.max < range.min) {
      errors.push(`${fieldSubject} has invalid stored range ${range.min}..${range.max}`);
      continue;
    }
    if (field.omitStoredValue !== undefined && (!Number.isInteger(field.omitStoredValue) || field.omitStoredValue < range.min || field.omitStoredValue > range.max)) {
      errors.push(`${fieldSubject} has invalid omitStoredValue ${field.omitStoredValue}`);
    }
    if (field.scale !== undefined && (!Number.isFinite(field.scale) || field.scale === 0)) {
      errors.push(`${fieldSubject} has invalid scale ${field.scale}`);
    }

    const windowKey = `${field.shift}:${field.bits}`;
    const peers = fieldsByWindow.get(windowKey) ?? [];
    for (const peer of peers) {
      if (range.min <= peer.range.max && peer.range.min <= range.max) {
        errors.push(
          `${fieldSubject} stored range ${range.min}..${range.max} overlaps ${peer.name} ${peer.range.min}..${peer.range.max}`,
        );
      }
    }
    peers.push({ name: field.name ?? "(unnamed)", range });
    fieldsByWindow.set(windowKey, peers);
  }
}

function packedFieldsMask(packedFields = []) {
  return packedFields.reduce((mask, field) => mask | ((2 ** field.bits - 1) << field.shift), 0);
}

function checkPackedParameterVariant(errors, subject, variant) {
  checkTextLayoutPackedFields(errors, subject, variant.packedFields);
  if (variant.match) {
    for (const field of ["mask", "value"]) {
      if (!Number.isInteger(variant.match[field]) || variant.match[field] < 0) {
        errors.push(`${subject} match.${field} has invalid value ${variant.match[field]}`);
      }
    }
    if ((variant.match.value & ~variant.match.mask) !== 0) {
      errors.push(`${subject} match.value has bits outside match.mask`);
    }
    if ((packedFieldsMask(variant.packedFields) & variant.match.mask) !== 0) {
      errors.push(`${subject} match.mask overlaps packed fields`);
    }
  }
  if (variant.valueRange) {
    const { min, max } = variant.valueRange;
    if (!Number.isInteger(min) || !Number.isInteger(max) || min < 0 || max < min) {
      errors.push(`${subject} valueRange has invalid range ${min}..${max}`);
    }
  }
}

function checkTextLayoutDefinition(errors, structName, definition) {
  const layout = definition.textLayout;
  if (!layout) {
    return;
  }
  const subject = `struct ${structName} textLayout`;
  const binaryFields = new Set((definition.fields ?? []).map((field) => field.name));
  const tupleFields = layout.tupleFields ?? [];
  for (const fieldName of tupleFields) {
    if (!binaryFields.has(fieldName)) {
      errors.push(`${subject} tuple field ${fieldName} is not in fields`);
    }
  }
  if (layout.emptyTuple && layout.emptyTuple.length !== tupleFields.length) {
    errors.push(`${subject} emptyTuple length ${layout.emptyTuple.length} does not match tupleFields length ${tupleFields.length}`);
  }
  if (layout.kind === "sparsePatternEvents") {
    if (!layout.columnsPath) {
      errors.push(`${subject} is missing columnsPath`);
    }
    if (!layout.rowsPath) {
      errors.push(`${subject} is missing rowsPath`);
    }
    if ((layout.positionFields?.length ?? 0) !== 2) {
      errors.push(`${subject} positionFields must contain exactly 2 fields for sparsePatternEvents`);
    }
  }

  const tupleFieldSet = new Set(tupleFields);
  for (const [fieldName, semantics] of Object.entries(layout.fieldSemantics ?? {})) {
    const fieldSubject = `struct ${structName} field ${fieldName}`;
    if (!tupleFieldSet.has(fieldName)) {
      errors.push(`${fieldSubject} has semantics but is not in tupleFields`);
    }
    if (semantics.encoding && !TEXT_LAYOUT_FIELD_ENCODINGS.has(semantics.encoding)) {
      errors.push(`${fieldSubject} has invalid encoding ${semantics.encoding}`);
    }
    if (semantics.reference && !TEXT_LAYOUT_FIELD_REFERENCES.has(semantics.reference)) {
      errors.push(`${fieldSubject} has invalid reference ${semantics.reference}`);
    }
    checkTextLayoutPackedFields(errors, fieldSubject, semantics.packedFields);
  }
}

function checkStructDefinitions(errors) {
  for (const [structName, definition] of Object.entries(SUNVOX_DB.structs ?? {})) {
    checkTextLayoutDefinition(errors, structName, definition);
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

function collectSourcePatternEffectCodes(sourceRoot) {
  const sourcePath = resolve(sourceRoot, SOURCE_PATTERN_EFFECT_FILE);
  if (!safeStat(sourcePath)?.isFile()) {
    return { sourcePath, codes: undefined };
  }
  const source = readFileSync(sourcePath, "utf8");
  const start = source.indexOf("static void sunvox_handle_command(");
  const end = source.indexOf("static void sunvox_reset_track_effect", start);
  if (start < 0 || end < 0) {
    return { sourcePath, codes: undefined };
  }
  const body = source.slice(start, end);
  const codes = new Set();
  const cases = [];
  for (const match of body.matchAll(/case\s+0x([0-9A-Fa-f]+)\s*:/gu)) {
    const code = Number.parseInt(match[1], 16);
    codes.add(code);
    cases.push({
      code,
      line: source.slice(0, start + match.index).split(/\r?\n/u).length,
    });
  }
  return { sourcePath, codes, cases };
}

function patternEffectRangeCodes(range) {
  return Array.from({ length: range.max - range.min + 1 }, (_, index) => range.min + index);
}

export function collectPatternEffectCoverage(sourceRoot = DEFAULT_SOURCE_ROOT) {
  const sourceEffects = collectSourcePatternEffectCodes(sourceRoot);
  const sourceCodes = sourceEffects.codes ? [...sourceEffects.codes].sort((a, b) => a - b) : [];
  const sourceCodeSet = new Set(sourceCodes);
  const dbEntries = Object.entries(SUNVOX_DB.enums.sunvox_pattern_effect ?? {})
    .map(([value, name]) => ({ code: Number(value), name }))
    .filter((entry) => Number.isInteger(entry.code))
    .sort((a, b) => a.code - b.code);
  const rangeEntries = (SUNVOX_DB.patternEffectRanges ?? [])
    .map((range) => ({
      ...range,
      codes: Number.isInteger(range.min) && Number.isInteger(range.max) && range.max >= range.min
        ? patternEffectRangeCodes(range)
        : [],
    }))
    .sort((a, b) => a.min - b.min);
  const dbCodeSet = new Set(dbEntries.map((entry) => entry.code));
  const namedEntries = dbEntries.filter((entry) => sourceCodeSet.has(entry.code));
  const missingCodes = sourceCodes.filter((code) => !dbCodeSet.has(code));
  const missingCases = missingCodes.map((code) => ({
    code,
    lines: [...new Set((sourceEffects.cases ?? []).filter((entry) => entry.code === code).map((entry) => entry.line))],
  }));
  const unknownEntries = dbEntries.filter((entry) => !sourceCodeSet.has(entry.code));
  const coveragePercent = sourceCodes.length
    ? Number(((namedEntries.length / sourceCodes.length) * 100).toFixed(1))
    : 0;

  return {
    sourcePath: sourceEffects.sourcePath,
    sourceAvailable: Boolean(sourceEffects.codes),
    sourceCodes,
    dbEntries,
    rangeEntries,
    rangeCodes: rangeEntries.flatMap((range) => range.codes),
    namedEntries,
    missingCodes,
    missingCases,
    unknownEntries,
    coveragePercent,
  };
}

const CHUNK_SOURCE_TYPES = new Set([
  "int32",
  "uint32",
  "uint16",
  "uint8",
  "int8",
  "float32",
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
const RUNTIME_CONSTRAINT_SCOPES = new Set(["project", "module", "moduleLink", "patternEffectParameter"]);
const RUNTIME_CONSTRAINT_KINDS = new Set(["integerRange", "maxUtf8Bytes"]);
const RUNTIME_CONSTRAINT_SEVERITIES = new Set(["warning", "error"]);
const GRAMMAR_EMIT_DEFAULT_KINDS = new Set(["bitflags", "zeroBytes"]);
const GRAMMAR_EMIT_DEFAULT_CONDITIONS = new Set(["ownModuleData", "ownPatternData"]);
const TEXT_LAYOUT_FIELD_ENCODINGS = new Set([
  "packedPatternControllerEffect",
  "oneBasedModuleIndex",
  "sunvoxNote",
  "uint16",
  "uint8",
]);
const TEXT_LAYOUT_FIELD_REFERENCES = new Set(["modules"]);
const PACKED_FIELD_REFERENCES = new Set(["module.controllers"]);
const CHUNK_SOURCE_SEMANTIC_FIXTURES = [
  { id: "CURL", scope: "project", name: "currentLayer", sourceSymbol: "sunvox_engine::cur_layer" },
  { id: "TIME", scope: "project", name: "lineCounter", sourceSymbol: "sunvox_engine::line_counter" },
  { id: "REPS", scope: "project", name: "restartPosition", sourceSymbol: "sunvox_engine::restart_pos" },
  { id: "SELS", scope: "project", name: "selectedModule", sourceSymbol: "sunvox_engine::selected_module" },
  { id: "PATN", scope: "project", name: "currentPattern", sourceSymbol: "sunvox_engine::pat_num" },
  { id: "PATT", scope: "project", name: "currentPatternTrack", sourceSymbol: "sunvox_engine::pat_track" },
  { id: "PATL", scope: "project", name: "currentPatternLine", sourceSymbol: "sunvox_engine::pat_line" },
  { id: "PFLG", scope: "pattern", name: "flags", sourceSymbol: "sunvox_pattern::flags" },
  { id: "PFFF", scope: "pattern", name: "infoFlags", sourceSymbol: "sunvox_pattern_info::flags" },
  {
    id: "SLnK",
    scope: "module",
    name: "inputLinkSlots",
    valueKind: "linkSlots",
    sourceSymbol: "get_links2(input_links)",
    "linkSlots.linkChunk": "SLNK",
    "linkSlots.localLinksPath": "inputLinks",
    "linkSlots.remoteLinksPath": "outputLinks",
    "linkSlots.semanticPath": "inputs",
  },
  {
    id: "SLnk",
    scope: "module",
    name: "outputLinkSlots",
    valueKind: "linkSlots",
    sourceSymbol: "get_links2(output_links)",
    "linkSlots.linkChunk": "SLNk",
    "linkSlots.localLinksPath": "outputLinks",
    "linkSlots.remoteLinksPath": "inputLinks",
    "linkSlots.semanticPath": "outputs",
  },
  { id: "SVPR", scope: "module", name: "visualizerParameters", sourceSymbol: "psynth_module::visualizer_pars" },
  { id: "SMII", scope: "module", name: "midiInputFlags", sourceSymbol: "psynth_module::midi_in_flags" },
  { id: "SMIN", scope: "module", name: "midiOutputName", sourceSymbol: "psynth_module::midi_out_name" },
  { id: "SMIC", scope: "module", name: "midiOutputChannel", sourceSymbol: "psynth_module::midi_out_ch" },
  { id: "SMIB", scope: "module", name: "midiOutputBank", sourceSymbol: "psynth_module::midi_out_bank" },
  { id: "SMIP", scope: "module", name: "midiOutputProgram", sourceSymbol: "psynth_module::midi_out_prog" },
];

function getPropertyPath(object, path) {
  return path.split(".").reduce((value, key) => value?.[key], object);
}

function formatExpectedValue(value) {
  return value === undefined ? "undefined" : JSON.stringify(value);
}

export function collectChunkSemanticReview() {
  const chunks = new Map(SUNVOX_DB.chunks.map((chunk) => [chunk.id, chunk]));
  const entries = CHUNK_SOURCE_SEMANTIC_FIXTURES.map((fixture) => {
    const chunk = chunks.get(fixture.id);
    const mismatches = [];
    const actual = {};

    if (!chunk) {
      mismatches.push({ field: "id", expected: fixture.id, actual: undefined });
      return { id: fixture.id, expected: fixture, actual, mismatches };
    }

    for (const [field, expected] of Object.entries(fixture)) {
      if (field === "id") {
        continue;
      }
      const actualValue = getPropertyPath(chunk, field);
      actual[field] = actualValue;
      if (actualValue !== expected) {
        mismatches.push({ field, expected, actual: actualValue });
      }
    }

    return { id: fixture.id, expected: fixture, actual, mismatches };
  });

  return {
    entries,
    reviewedChunks: entries.length,
    mismatches: entries.flatMap((entry) =>
      entry.mismatches.map((mismatch) => ({ id: entry.id, ...mismatch })),
    ),
  };
}

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
  for (const mismatch of collectChunkSemanticReview().mismatches) {
    errors.push(
      `chunk ${mismatch.id} source semantic ${mismatch.field} expected ${formatExpectedValue(
        mismatch.expected,
      )} but found ${formatExpectedValue(mismatch.actual)}`,
    );
  }

  for (const [scopeName, scope] of Object.entries(SUNVOX_DB.grammar.scopes ?? {})) {
    for (const field of scope.fields ?? []) {
      const chunk = SUNVOX_DB.chunks.find((candidate) => candidate.id === field.chunk);
      if (!chunkIds.has(field.chunk)) {
        errors.push(`grammar scope ${scopeName} references missing chunk ${field.chunk}`);
      } else if (chunk?.scope !== scopeName) {
        errors.push(`grammar scope ${scopeName} references ${field.chunk} with chunk scope ${chunk.scope}`);
      }
      checkFixedTextSizeRuntimeConstraint(errors, scopeName, field);
      checkGrammarEmitDefault(errors, scopeName, field, chunk);
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

function checkFixedTextSizeRuntimeConstraint(errors, scopeName, field) {
  if (field.field !== "text" || field.textSize === undefined) {
    return;
  }
  if (!Number.isInteger(field.textSize)) {
    errors.push(`grammar:${scopeName}: field ${field.path} textSize must be an integer`);
    return;
  }
  const rule = (SUNVOX_DB.runtimeConstraints ?? []).find(
    (candidate) =>
      candidate.scope === scopeName &&
      candidate.path === field.path &&
      candidate.kind === "maxUtf8Bytes" &&
      candidate.maxBytes === field.textSize,
  );
  if (!rule) {
    errors.push(
      `grammar:${scopeName}: field ${field.path} fixed textSize ${field.textSize} is missing matching maxUtf8Bytes runtime constraint`,
    );
  }
}

function checkGrammarEmitDefault(errors, scopeName, field, chunk) {
  const rule = field.emitDefault;
  if (!rule) {
    return;
  }
  const subject = `grammar:${scopeName}: field ${field.path} emitDefault`;
  if (!GRAMMAR_EMIT_DEFAULT_KINDS.has(rule.kind)) {
    errors.push(`${subject} has invalid kind ${rule.kind}`);
  }
  if (!GRAMMAR_EMIT_DEFAULT_CONDITIONS.has(rule.when)) {
    errors.push(`${subject} has invalid condition ${rule.when}`);
  }
  if (typeof rule.source !== "string" || !rule.source) {
    errors.push(`${subject} is missing source`);
  }
  if (!Number.isInteger(rule.trackingIssue) || rule.trackingIssue < 1) {
    errors.push(`${subject} has invalid trackingIssue ${rule.trackingIssue}`);
  }
  if (typeof rule.description !== "string" || !rule.description) {
    errors.push(`${subject} is missing description`);
  }
  if (rule.kind === "zeroBytes") {
    if (!Number.isInteger(rule.byteLength) || rule.byteLength < 0) {
      errors.push(`${subject} has invalid byteLength ${rule.byteLength}`);
    }
    if (field.field !== "base64") {
      errors.push(`${subject} zeroBytes requires a base64 grammar field`);
    }
    if (chunk && chunk.type !== "bytes") {
      errors.push(`${subject} zeroBytes requires a bytes chunk`);
    }
  }
  if (rule.kind === "bitflags") {
    if (field.field !== "value" || !field.bitflags) {
      errors.push(`${subject} bitflags requires a value grammar field with bitflags`);
    }
    if (chunk && !["uint32", "int32"].includes(chunk.type)) {
      errors.push(`${subject} bitflags requires an integer chunk`);
    }
    if (!rule.value || typeof rule.value !== "object" || Array.isArray(rule.value)) {
      errors.push(`${subject} bitflags is missing object value`);
    } else {
      const knownFlags = new Set((SUNVOX_DB.bitflags?.[field.bitflags] ?? []).map((flag) => flag.name));
      for (const flagName of Object.keys(rule.value)) {
        if (flagName !== "unknown" && !knownFlags.has(flagName)) {
          errors.push(`${subject} bitflags references missing flag ${flagName}`);
        }
      }
    }
  }
  if (rule.when === "ownPatternData" && scopeName !== "pattern") {
    errors.push(`${subject} condition ownPatternData requires pattern scope`);
  }
  if (rule.when === "ownModuleData" && scopeName !== "module") {
    errors.push(`${subject} condition ownModuleData requires module scope`);
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
    if (
      rule.trackingIssue !== undefined &&
      (!Number.isInteger(rule.trackingIssue) || rule.trackingIssue < 1)
    ) {
      errors.push(`runtime constraint ${rule.id} has invalid trackingIssue ${rule.trackingIssue}`);
    }
    if (rule.scope === "moduleLink" && !["inputs", "outputs"].includes(rule.relation)) {
      errors.push(`runtime constraint ${rule.id} has invalid module link relation ${rule.relation}`);
    }
    if (rule.scope === "patternEffectParameter") {
      const effectNames = new Set([
        ...Object.values(SUNVOX_DB.enums.sunvox_pattern_effect ?? {}),
        ...(SUNVOX_DB.patternEffectRanges ?? []).map((range) => range.name),
      ]);
      if (!rule.effect) {
        errors.push(`runtime constraint ${rule.id} is missing pattern effect`);
      } else if (!effectNames.has(rule.effect)) {
        errors.push(`runtime constraint ${rule.id} references missing pattern effect ${rule.effect}`);
      }
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

function checkRuntimeProfiles(errors) {
  const ids = new Set();
  const compileOptionProfiles = new Map();
  const profiles = Array.isArray(SUNVOX_DB.runtimeProfiles) ? SUNVOX_DB.runtimeProfiles : [];
  if (!Array.isArray(SUNVOX_DB.runtimeProfiles)) {
    errors.push("runtimeProfiles must be an array");
    return { profiles, compileOptionProfiles };
  }
  for (const profile of profiles) {
    if (!profile.id) {
      errors.push("runtime profile is missing id");
      continue;
    }
    if (ids.has(profile.id)) {
      errors.push(`duplicate runtime profile id ${profile.id}`);
    }
    ids.add(profile.id);
    if (typeof profile.engineVersion !== "string" || !/^0x[0-9A-Fa-f]+$/u.test(profile.engineVersion)) {
      errors.push(`runtime profile ${profile.id} has invalid engineVersion ${profile.engineVersion}`);
    }
    if (!profile.compileOptions || typeof profile.compileOptions !== "object" || Array.isArray(profile.compileOptions)) {
      errors.push(`runtime profile ${profile.id} compileOptions must be an object`);
      continue;
    }
    for (const [macro, value] of Object.entries(profile.compileOptions)) {
      if (!macro) {
        errors.push(`runtime profile ${profile.id} has an empty compile option macro`);
        continue;
      }
      if (typeof value !== "boolean") {
        errors.push(`runtime profile ${profile.id} compile option ${macro} must be boolean`);
      }
      if (!compileOptionProfiles.has(macro)) {
        compileOptionProfiles.set(macro, new Set());
      }
      compileOptionProfiles.get(macro).add(profile.id);
    }
  }
  return { profiles, compileOptionProfiles };
}

function checkControllerCompileCondition(errors, warnings, moduleName, controller, runtimeProfileCheck) {
  const condition = controller.compileCondition;
  if (!condition) {
    return;
  }
  const subject = `${moduleName}: controller ${controller.name ?? "(unnamed)"} compileCondition`;
  if (!condition.macro) {
    errors.push(`${subject} is missing macro`);
  }
  if (typeof condition.whenDefined !== "boolean") {
    errors.push(`${subject} is missing boolean whenDefined`);
  }
  if (condition.macro && !runtimeProfileCheck.compileOptionProfiles.has(condition.macro)) {
    errors.push(`${subject} references unknown compile option ${condition.macro}`);
  }
  for (const profile of runtimeProfileCheck.profiles) {
    if (condition.macro && !Object.hasOwn(profile.compileOptions ?? {}, condition.macro)) {
      warnings.push(`${subject} references ${condition.macro}, but runtime profile ${profile.id} does not declare it`);
    }
  }
}

function checkPatternEffectEnum(errors, warnings, sourceRoot) {
  const effectEnum = SUNVOX_DB.enums.sunvox_pattern_effect;
  if (!effectEnum) {
    return;
  }
  const sourceEffects = collectSourcePatternEffectCodes(sourceRoot);
  if (!sourceEffects.codes) {
    warnings.push(`could not read SunVox pattern effect cases from ${relative(process.cwd(), sourceEffects.sourcePath)}`);
    return;
  }
  for (const value of Object.keys(effectEnum)) {
    const code = Number(value);
    if (!Number.isInteger(code)) {
      errors.push(`sunvox_pattern_effect enum value ${value} is not an integer`);
      continue;
    }
    if (!sourceEffects.codes.has(code)) {
      errors.push(`sunvox_pattern_effect ${value} is missing from source ctl_eff cases`);
    }
  }
}

function checkPatternEffectRanges(errors) {
  const effectNames = new Set(Object.values(SUNVOX_DB.enums.sunvox_pattern_effect ?? {}));
  const seenNames = new Set();
  for (const [index, range] of (SUNVOX_DB.patternEffectRanges ?? []).entries()) {
    const subject = `pattern effect range #${index} ${range.name ?? "(unnamed)"}`;
    if (!range.name) {
      errors.push(`${subject} is missing name`);
    }
    if (range.name && effectNames.has(range.name)) {
      errors.push(`${subject} duplicates a sunvox_pattern_effect enum name`);
    }
    if (range.name && seenNames.has(range.name)) {
      errors.push(`${subject} duplicates another pattern effect range`);
    }
    if (range.name) {
      seenNames.add(range.name);
    }
    if (!Number.isInteger(range.min) || !Number.isInteger(range.max) || range.min < 0 || range.max < range.min || range.max > 255) {
      errors.push(`${subject} has invalid range ${range.min}..${range.max}`);
    }
    if (!range.field?.name) {
      errors.push(`${subject} is missing field.name`);
    }
    if (range.field?.scale !== undefined && (!Number.isFinite(range.field.scale) || range.field.scale === 0)) {
      errors.push(`${subject} field ${range.field.name} has invalid scale ${range.field.scale}`);
    }
  }
}

function checkPatternEffectParameterDefinitions(errors) {
  const effectNames = new Set([
    ...Object.values(SUNVOX_DB.enums.sunvox_pattern_effect ?? {}),
    ...(SUNVOX_DB.patternEffectRanges ?? []).map((range) => range.name),
  ]);
  const parameterizedEffects = new Set(Object.keys(SUNVOX_DB.patternEffectParameters ?? {}));
  for (const [effectName, definition] of Object.entries(SUNVOX_DB.patternEffectParameters ?? {})) {
    const subject = `pattern effect parameter ${effectName}`;
    if (!effectNames.has(effectName)) {
      errors.push(`${subject} references missing sunvox_pattern_effect name`);
    }
    if (!definition.packedFields?.length && !definition.variants?.length) {
      errors.push(`${subject} must define packedFields or variants`);
    }
    if (definition.packedFields) {
      checkPackedParameterVariant(errors, subject, definition);
    }
    for (const [index, variant] of (definition.variants ?? []).entries()) {
      checkPackedParameterVariant(errors, `${subject} variant #${index}`, variant);
    }
  }
  for (const effectName of Object.keys(SUNVOX_DB.parameterlessPatternEffects ?? {})) {
    const subject = `parameterless pattern effect ${effectName}`;
    if (!effectNames.has(effectName)) {
      errors.push(`${subject} references missing sunvox_pattern_effect name`);
    }
    if (parameterizedEffects.has(effectName)) {
      errors.push(`${subject} is also defined in patternEffectParameters`);
    }
  }
}

function checkControllerDynamicLimits(errors, moduleName, controller, controllersByKey, sourceDynamicLimitSources) {
  const dynamicLimits = controller.dynamicLimits;
  if (!dynamicLimits) {
    return;
  }
  const dependency = controllersByKey.get(dynamicLimits.controller);
  if (!dependency) {
    errors.push(`${moduleName}: controller ${controller.name} dynamicLimits references missing controller ${dynamicLimits.controller}`);
  }
  const limitSets = [
    ...(dynamicLimits.default ? [["default", dynamicLimits.default]] : []),
    ...Object.entries(dynamicLimits.cases ?? {}),
  ];
  if (limitSets.length === 0) {
    errors.push(`${moduleName}: controller ${controller.name} dynamicLimits has no default or cases`);
  }
  if (dynamicLimits.source && !sourceDynamicLimitSources.has(dynamicLimits.source)) {
    errors.push(`${moduleName}: controller ${controller.name} dynamicLimits source ${dynamicLimits.source} is missing from source scan`);
  }
  for (const [caseName, limit] of limitSets) {
    if (limit.min === undefined && limit.max === undefined) {
      errors.push(`${moduleName}: controller ${controller.name} dynamicLimits ${caseName} is missing min or max`);
    }
    for (const field of ["min", "max"]) {
      if (limit[field] !== undefined && !Number.isInteger(limit[field])) {
        errors.push(`${moduleName}: controller ${controller.name} dynamicLimits ${caseName}.${field} is not an integer`);
      }
    }
  }
  if (dependency?.enum && dynamicLimits.cases) {
    const enumValues = SUNVOX_DB.enums[dependency.enum] ?? {};
    const allowedCases = new Set([...Object.keys(enumValues), ...Object.values(enumValues)]);
    for (const caseName of Object.keys(dynamicLimits.cases)) {
      if (!allowedCases.has(caseName)) {
        errors.push(`${moduleName}: controller ${controller.name} dynamicLimits case ${caseName} is not in ${dependency.enum}`);
      }
    }
  }
}

function checkKnowledgeScopes(errors, warnings, sourceReport) {
  const ids = new Set();
  for (const policy of sourceReport.knowledgePolicies ?? []) {
    if (ids.has(policy.id)) {
      errors.push(`duplicate knowledge scope id ${policy.id}`);
    }
    ids.add(policy.id);
    if (policy.scope === "moduleInfo" && policy.source !== "PS_CMD_GET_INFO") {
      errors.push(`knowledge scope ${policy.id} moduleInfo source must be PS_CMD_GET_INFO`);
    }
  }

  if (sourceReport.moduleInfoScope.sourceModules > 0 && !sourceReport.moduleInfoScope.policy) {
    warnings.push("source PS_CMD_GET_INFO module help is not covered by a knowledgeScopes policy");
  }
}

export function collectDbCheck(sourceRoot = DEFAULT_SOURCE_ROOT) {
  const errors = [];
  const warnings = [];
  const sourceReport = collectSourceReport(sourceRoot);
  const sourceByName = new Map(sourceReport.sourceModules.map((module) => [module.module, module]));
  const sourceDynamicLimitSources = new Set(sourceReport.sourceDynamicLimitFunctions.map((row) => row.source));

  checkChunkDefinitions(errors, warnings, sourceRoot);
  checkBitfieldDefinitions(errors);
  checkStructDefinitions(errors);
  checkRuntimeConstraints(errors);
  const runtimeProfileCheck = checkRuntimeProfiles(errors);
  checkKnowledgeScopes(errors, warnings, sourceReport);
  checkPatternEffectEnum(errors, warnings, sourceRoot);
  checkPatternEffectRanges(errors);
  checkPatternEffectParameterDefinitions(errors);
  for (const row of sourceReport.missingDynamicLimitSources) {
    errors.push(`source dynamic limit ${row.source} (${row.module}) is missing from DB dynamicLimits`);
  }

  for (const [moduleName, moduleDefinition] of Object.entries(SUNVOX_DB.modules)) {
    const controllers = expandControllerDefinitions(moduleDefinition.controllers);
    const controllerIndexes = new Map();
    const controllersByKey = new Map(controllers.map((controller) => [controllerKey(controller), controller]));
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
      checkControllerCompileCondition(errors, warnings, moduleName, controller, runtimeProfileCheck);
      checkControllerDynamicLimits(errors, moduleName, controller, controllersByKey, sourceDynamicLimitSources);
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
  const chunkSemanticReview = collectChunkSemanticReview();
  const dataChunkLayouts = collectDataChunkLayoutMetrics();
  const moduleCatalog = collectModuleCatalogMetrics(report);
  const patternEffectCoverage = collectPatternEffectCoverage(sourceRoot);
  const runtimeCompileOptions = collectRuntimeCompileOptions();
  const conditionalControllers = collectConditionalControllers();
  const patternEffectParameterSchemas = Object.keys(SUNVOX_DB.patternEffectParameters ?? {}).length;
  const parameterlessPatternEffects = Object.keys(SUNVOX_DB.parameterlessPatternEffects ?? {}).length;
  const handledPatternEffectParameters = patternEffectParameterSchemas + parameterlessPatternEffects;
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
      knowledgePolicies: report.knowledgePolicies.length,
      sourceModuleInfoBlocks: report.moduleInfoScope.sourceModules,
      moduleInfoPolicy: report.moduleInfoScope.policyStatus,
      sourceDynamicLimitFunctions: report.sourceDynamicLimitFunctions.length,
      dbDynamicLimitSources: new Set(report.dbDynamicLimits.map((row) => row.source).filter(Boolean)).size,
      dbDynamicLimitControllers: report.dbDynamicLimits.length,
      missingDynamicLimitSources: report.missingDynamicLimitSources.length,
      unknownDynamicLimitSources: report.unknownDynamicLimitSources.length,
      moduleCatalogFields: moduleCatalog.sourceFields,
      dbModuleCatalogFields: moduleCatalog.dbFields,
      moduleCatalogCoveragePercent: moduleCatalog.coveragePercent,
      missingModuleCatalogFields: moduleCatalog.missingFields,
      sourcePatternEffects: patternEffectCoverage.sourceCodes.length,
      dbPatternEffects: patternEffectCoverage.dbEntries.length,
      patternEffectRanges: patternEffectCoverage.rangeEntries.length,
      patternEffectRangeCodes: patternEffectCoverage.rangeCodes.length,
      namedSourcePatternEffects: patternEffectCoverage.namedEntries.length,
      unnamedSourcePatternEffects: patternEffectCoverage.missingCodes.length,
      patternEffectNameCoveragePercent: patternEffectCoverage.coveragePercent,
      patternEffectParameterSchemas,
      parameterlessPatternEffects,
      patternEffectParameterCoveragePercent: patternEffectCoverage.dbEntries.length
        ? Number(((patternEffectParameterSchemas / patternEffectCoverage.dbEntries.length) * 100).toFixed(1))
        : 0,
      patternEffectParameterHandlingCoveragePercent: patternEffectCoverage.dbEntries.length
        ? Number(((handledPatternEffectParameters / patternEffectCoverage.dbEntries.length) * 100).toFixed(1))
        : 0,
      controllerMetadataMismatches: controllerDiff.summary.mismatches,
      dbCheckErrors: dbCheck.summary.errors,
      dbCheckWarnings: dbCheck.summary.warnings,
      runtimeProfiles: SUNVOX_DB.runtimeProfiles?.length ?? 0,
      runtimeCompileOptions: runtimeCompileOptions.size,
      conditionalControllers: conditionalControllers.length,
      runtimeConstraints: SUNVOX_DB.runtimeConstraints?.length ?? 0,
      observedRuntimeBehaviors: (SUNVOX_DB.runtimeConstraints ?? []).filter((rule) => rule.observedBehavior).length,
      validationFiles: validation.files,
      validationIssues: validation.issues,
      validationWarnings: validation.warnings,
      validationErrors: validation.errors,
      chunks: chunkStorage.chunks,
      reviewedChunks: chunkStorage.reviewedChunks,
      sourceSemanticChunks: chunkSemanticReview.reviewedChunks,
      sourceSemanticChunkMismatches: chunkSemanticReview.mismatches.length,
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
      dynamicLimits:
        report.missingDynamicLimitSources.length === 0 && report.unknownDynamicLimitSources.length === 0,
      validation: validation.issues === 0,
      ok:
        report.missingFromDb.length === 0 &&
        report.missingFromSource.length === 0 &&
        report.missingDynamicLimitSources.length === 0 &&
        report.unknownDynamicLimitSources.length === 0 &&
        dbCheck.ok &&
        coverageGateFailures.length === 0 &&
        controllerDiff.summary.mismatches === 0 &&
        validation.issues === 0,
    },
    sampledDbModuleTypes,
    unsampledDbModuleTypes: coverage.unusedDbModuleTypes,
    moduleCatalog,
    patternEffectCoverage,
    dynamicLimits: {
      sourceFunctions: report.sourceDynamicLimitFunctions,
      dbLimits: report.dbDynamicLimits,
      missingSources: report.missingDynamicLimitSources,
      unknownSources: report.unknownDynamicLimitSources,
    },
    runtimeProfiles: {
      profiles: SUNVOX_DB.runtimeProfiles ?? [],
      compileOptions: [...runtimeCompileOptions].sort(compareText),
      conditionalControllers,
    },
    validation,
    chunkStorage,
    chunkSemanticReview,
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
    `Source PS_CMD_GET_INFO blocks: ${report.moduleInfoScope.sourceModules}`,
    `DB knowledge policies: ${report.knowledgePolicies.length}`,
    `Module info policy: ${report.moduleInfoScope.policyStatus}`,
    `Source dynamic limit functions: ${report.sourceDynamicLimitFunctions.length}`,
    `DB dynamic limit controllers: ${report.dbDynamicLimits.length}`,
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
    "Dynamic controller limit source coverage:",
    formatTable(report.dynamicLimitSourceCoverage, [
      { header: "source", value: (row) => row.source },
      { header: "module", value: (row) => row.module },
      { header: "dbControllers", value: (row) => row.dbControllers },
      { header: "file", value: (row) => row.file },
    ]),
    "",
    "DB dynamic limit sources missing from source scan:",
    formatTable(report.unknownDynamicLimitSources, [
      { header: "source", value: (row) => row.source },
      { header: "controllers", value: (row) => row.controllers.join(",") },
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

function formatSourceEnums(enums) {
  return [
    "SunVox source enum candidates",
    "",
    `Enums: ${enums.length}`,
    "",
    formatTable(enums, [
      { header: "enum", value: (row) => row.enum },
      { header: "macro", value: (row) => row.macro },
      { header: "values", value: (row) => Object.keys(row.values).length },
      { header: "labels", value: (row) => row.labels.join(";") },
    ]),
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
    { metric: "DB knowledge policies", value: metrics.summary.knowledgePolicies },
    { metric: "Source module info blocks", value: metrics.summary.sourceModuleInfoBlocks },
    { metric: "Module info policy", value: metrics.summary.moduleInfoPolicy },
    { metric: "Source dynamic limit functions", value: metrics.summary.sourceDynamicLimitFunctions },
    { metric: "DB dynamic limit sources", value: metrics.summary.dbDynamicLimitSources },
    { metric: "DB dynamic limit controllers", value: metrics.summary.dbDynamicLimitControllers },
    { metric: "Missing dynamic limit sources", value: metrics.summary.missingDynamicLimitSources },
    { metric: "Unknown dynamic limit sources", value: metrics.summary.unknownDynamicLimitSources },
    { metric: "Module catalog fields", value: metrics.summary.moduleCatalogFields },
    { metric: "DB module catalog fields", value: metrics.summary.dbModuleCatalogFields },
    { metric: "Module catalog coverage", value: formatPercent(metrics.summary.moduleCatalogCoveragePercent) },
    { metric: "Missing module catalog fields", value: metrics.summary.missingModuleCatalogFields },
    { metric: "Source pattern effects", value: metrics.summary.sourcePatternEffects },
    { metric: "DB pattern effect names", value: metrics.summary.dbPatternEffects },
    { metric: "DB pattern effect ranges", value: metrics.summary.patternEffectRanges },
    { metric: "DB pattern effect range codes", value: metrics.summary.patternEffectRangeCodes },
    { metric: "Named source pattern effects", value: metrics.summary.namedSourcePatternEffects },
    { metric: "Unnamed source pattern effects", value: metrics.summary.unnamedSourcePatternEffects },
    { metric: "Pattern effect name coverage", value: formatPercent(metrics.summary.patternEffectNameCoveragePercent) },
    { metric: "Pattern effect parameter schemas", value: metrics.summary.patternEffectParameterSchemas },
    { metric: "Parameterless pattern effects", value: metrics.summary.parameterlessPatternEffects },
    { metric: "Pattern effect parameter coverage", value: formatPercent(metrics.summary.patternEffectParameterCoveragePercent) },
    {
      metric: "Pattern effect parameter handling",
      value: formatPercent(metrics.summary.patternEffectParameterHandlingCoveragePercent),
    },
    { metric: "Controller metadata mismatches", value: metrics.summary.controllerMetadataMismatches },
    { metric: "DB check errors", value: metrics.summary.dbCheckErrors },
    { metric: "Runtime profiles", value: metrics.summary.runtimeProfiles },
    { metric: "Runtime compile options", value: metrics.summary.runtimeCompileOptions },
    { metric: "Conditional controllers", value: metrics.summary.conditionalControllers },
    { metric: "Runtime constraints", value: metrics.summary.runtimeConstraints },
    { metric: "Observed runtime behaviors", value: metrics.summary.observedRuntimeBehaviors },
    { metric: "Validation files", value: metrics.summary.validationFiles },
    { metric: "Validation issues", value: metrics.summary.validationIssues },
    { metric: "Validation warnings", value: metrics.summary.validationWarnings },
    { metric: "Validation errors", value: metrics.summary.validationErrors },
    { metric: "Chunks", value: metrics.summary.chunks },
    { metric: "Reviewed chunks", value: metrics.summary.reviewedChunks },
    { metric: "Chunk storage review", value: formatPercent(metrics.summary.chunkStorageReviewPercent) },
    { metric: "Source semantic chunks", value: metrics.summary.sourceSemanticChunks },
    { metric: "Source semantic mismatches", value: metrics.summary.sourceSemanticChunkMismatches },
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
    { gate: "dynamic limits", status: gateLabel(metrics.gates.dynamicLimits) },
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
    "Dynamic limit source gaps:",
    metrics.dynamicLimits.missingSources.length || metrics.dynamicLimits.unknownSources.length
      ? [
          ...metrics.dynamicLimits.missingSources.map((row) => `  - missing DB source: ${row.source} (${row.module})`),
          ...metrics.dynamicLimits.unknownSources.map(
            (row) => `  - unknown DB source: ${row.source} (${row.controllers.join(", ")})`,
          ),
        ].join("\n")
      : "(none)",
    "",
    "Runtime compile options:",
    metrics.runtimeProfiles.compileOptions.length
      ? metrics.runtimeProfiles.compileOptions.map((macro) => `  - ${macro}`).join("\n")
      : "(none)",
    "",
    "Conditional controllers:",
    metrics.runtimeProfiles.conditionalControllers.length
      ? metrics.runtimeProfiles.conditionalControllers
          .map(
            (row) =>
              `  - ${row.module}.${row.controller}: ${row.whenDefined ? "defined" : "not defined"} ${row.macro}`,
          )
          .join("\n")
      : "(none)",
    "",
    "Unnamed source pattern effects:",
    metrics.patternEffectCoverage.missingCases.length
      ? metrics.patternEffectCoverage.missingCases
          .map((entry) => `  - 0x${entry.code.toString(16).toUpperCase()} (lines ${entry.lines.join(", ")})`)
          .join("\n")
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
    "Source semantic chunk mismatches:",
    metrics.chunkSemanticReview.mismatches.length
      ? metrics.chunkSemanticReview.mismatches
          .map(
            (mismatch) =>
              `  - ${mismatch.id}.${mismatch.field}: expected ${formatExpectedValue(
                mismatch.expected,
              )}, found ${formatExpectedValue(mismatch.actual)}`,
          )
          .join("\n")
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
  if (command === "enums") {
    const json = args.includes("--json");
    const paths = withoutFlags(args, ["--json"]);
    const enums = collectSourceEnums(paths[0] ?? DEFAULT_STRINGS_FILE);
    console.log(json ? JSON.stringify(enums, null, 2) : formatSourceEnums(enums));
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

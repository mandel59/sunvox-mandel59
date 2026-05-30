#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseContainer } from "./sunvox-codec.mjs";

function usage() {
  console.error(`Usage:
  node tools/sunvox-diff.mjs [--json] [--include-aux] <before.sunvox|before.json> <after.sunvox|after.json>`);
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function valueKind(value) {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function pathJoin(path, key) {
  if (typeof key === "number") {
    return `${path}[${key}]`;
  }
  return path ? `${path}.${key}` : key;
}

function compareKeys(left, right) {
  const leftNumeric = /^\d+$/u.test(left);
  const rightNumeric = /^\d+$/u.test(right);
  if (leftNumeric && rightNumeric) {
    return Number(left) - Number(right);
  }
  return left.localeCompare(right, "en");
}

function comparableValue(value, options = {}) {
  if (Array.isArray(value)) {
    return value.map((item) => comparableValue(item, options));
  }
  if (!isObject(value)) {
    return value;
  }
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => options.includeAux || !key.startsWith("_"))
      .sort(([left], [right]) => compareKeys(left, right))
      .map(([key, item]) => [key, comparableValue(item, options)]),
  );
}

function sameValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function diffValues(left, right, path = "", changes = []) {
  if (sameValue(left, right)) {
    return changes;
  }
  if (Array.isArray(left) && Array.isArray(right)) {
    const length = Math.max(left.length, right.length);
    for (let index = 0; index < length; index += 1) {
      const childPath = pathJoin(path, index);
      if (index >= left.length) {
        changes.push({ type: "added", path: childPath, after: right[index] });
      } else if (index >= right.length) {
        changes.push({ type: "removed", path: childPath, before: left[index] });
      } else {
        diffValues(left[index], right[index], childPath, changes);
      }
    }
    return changes;
  }
  if (isObject(left) && isObject(right)) {
    const keys = [...new Set([...Object.keys(left), ...Object.keys(right)])].sort(compareKeys);
    for (const key of keys) {
      const childPath = pathJoin(path, key);
      if (!Object.hasOwn(left, key)) {
        changes.push({ type: "added", path: childPath, after: right[key] });
      } else if (!Object.hasOwn(right, key)) {
        changes.push({ type: "removed", path: childPath, before: left[key] });
      } else {
        diffValues(left[key], right[key], childPath, changes);
      }
    }
    return changes;
  }
  changes.push({
    type: valueKind(left) === valueKind(right) ? "changed" : "typeChanged",
    path,
    before: left,
    after: right,
  });
  return changes;
}

export function diffDocuments(before, after, options = {}) {
  const left = comparableValue(before, options);
  const right = comparableValue(after, options);
  return diffValues(left, right);
}

function labelText(value) {
  return typeof value === "string" && value ? ` "${value}"` : "";
}

function moduleDiffLabel(module, index) {
  const name = labelText(module?.name);
  const type = typeof module?.type === "string" && module.type ? ` [${module.type}]` : "";
  return `Module #${index}${name}${type}`;
}

function patternDiffLabel(pattern, index) {
  return `Pattern #${index}${labelText(pattern?.name)}`;
}

function collectArrayLabels(beforeItems, afterItems, prefix, labelFn) {
  const labels = {};
  const length = Math.max(beforeItems?.length ?? 0, afterItems?.length ?? 0);
  for (let index = 0; index < length; index += 1) {
    const item = afterItems?.[index] ?? beforeItems?.[index];
    labels[`${prefix}[${index}]`] = labelFn(item, index);
  }
  return labels;
}

export function collectDiffLabels(before, after) {
  return {
    ...collectArrayLabels(before?.modules, after?.modules, "modules", moduleDiffLabel),
    ...collectArrayLabels(before?.patterns, after?.patterns, "patterns", patternDiffLabel),
  };
}

async function readDocument(filePath) {
  const buffer = await readFile(filePath);
  if (filePath.toLowerCase().endsWith(".json")) {
    return JSON.parse(buffer.toString("utf8"));
  }
  return parseContainer(buffer);
}

export async function diffFiles(beforePath, afterPath, options = {}) {
  const [before, after] = await Promise.all([readDocument(beforePath), readDocument(afterPath)]);
  return {
    before: relative(process.cwd(), resolve(beforePath)),
    after: relative(process.cwd(), resolve(afterPath)),
    includeAux: Boolean(options.includeAux),
    labels: collectDiffLabels(before, after),
    changes: diffDocuments(before, after, options),
  };
}

function summarizeValue(value) {
  if (Array.isArray(value)) {
    return `[array length=${value.length}]`;
  }
  if (isObject(value)) {
    const keys = Object.keys(value);
    return `{object keys=${keys.slice(0, 5).join(",")}${keys.length > 5 ? ",..." : ""}}`;
  }
  const text = JSON.stringify(value);
  if (text === undefined) {
    return String(value);
  }
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

function formatChange(change) {
  const path = change.path || "$";
  if (change.type === "added") {
    return `+ ${path}: ${summarizeValue(change.after)}`;
  }
  if (change.type === "removed") {
    return `- ${path}: ${summarizeValue(change.before)}`;
  }
  return `~ ${path}: ${summarizeValue(change.before)} -> ${summarizeValue(change.after)}`;
}

function changeGroup(path, labels = {}) {
  if (!path || path === "$") {
    return "Document";
  }
  if (path.startsWith("project.")) {
    return "Project";
  }
  const moduleMatch = /^(modules\[(\d+)\])(?:\.(controllers|inputs|outputs|dataChunks)\b)?/u.exec(path);
  if (moduleMatch) {
    const [, modulePath, moduleIndex, section] = moduleMatch;
    const label = labels[modulePath] ?? `Module #${moduleIndex}`;
    if (section === "controllers") {
      return `${label} controllers`;
    }
    if (section === "inputs") {
      return `${label} input links`;
    }
    if (section === "outputs") {
      return `${label} output links`;
    }
    if (section === "dataChunks") {
      return `${label} data chunks`;
    }
    return label;
  }
  const patternMatch = /^(patterns\[(\d+)\])(?:\.events\b)?/u.exec(path);
  if (patternMatch) {
    const [, patternPath, patternIndex] = patternMatch;
    const label = labels[patternPath] ?? `Pattern #${patternIndex}`;
    return path.startsWith(`patterns[${patternIndex}].events`)
      ? `${label} events`
      : label;
  }
  return "Document";
}

function formatGroupedChanges(changes, labels = {}) {
  const groups = new Map();
  for (const change of changes) {
    const group = changeGroup(change.path, labels);
    groups.set(group, [...(groups.get(group) ?? []), change]);
  }
  return [...groups.entries()]
    .map(([group, groupChanges]) => [group, ...groupChanges.map((change) => `  ${formatChange(change)}`)].join("\n"))
    .join("\n\n");
}

export function formatDiff(result) {
  return [
    "SunVox semantic diff",
    `Before: ${result.before}`,
    `After: ${result.after}`,
    `Changes: ${result.changes.length}`,
    "",
    result.changes.length ? formatGroupedChanges(result.changes, result.labels) : "(none)",
    "",
  ].join("\n");
}

function parseArgs(args) {
  const options = { includeAux: false };
  const paths = [];
  for (const arg of args) {
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--include-aux") {
      options.includeAux = true;
    } else {
      paths.push(arg);
    }
  }
  return { options, paths };
}

async function main() {
  const { options, paths } = parseArgs(process.argv.slice(2));
  if (options.help || paths.length !== 2) {
    usage();
    process.exitCode = options.help ? 0 : 1;
    return;
  }

  const result = await diffFiles(paths[0], paths[1], options);
  console.log(options.json ? JSON.stringify(result, null, 2) : formatDiff(result));
  if (result.changes.length > 0) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

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

function changeGroup(path) {
  if (!path || path === "$") {
    return "Document";
  }
  if (path.startsWith("project.")) {
    return "Project";
  }
  const moduleMatch = /^modules\[(\d+)\](?:\.(controllers|inputs|outputs)\b)?/u.exec(path);
  if (moduleMatch) {
    const [, moduleIndex, section] = moduleMatch;
    if (section === "controllers") {
      return `Module #${moduleIndex} controllers`;
    }
    if (section === "inputs" || section === "outputs") {
      return `Module #${moduleIndex} ${section}`;
    }
    return `Module #${moduleIndex}`;
  }
  const patternMatch = /^patterns\[(\d+)\](?:\.events\b)?/u.exec(path);
  if (patternMatch) {
    const [, patternIndex] = patternMatch;
    return path.startsWith(`patterns[${patternIndex}].events`)
      ? `Pattern #${patternIndex} events`
      : `Pattern #${patternIndex}`;
  }
  return "Document";
}

function formatGroupedChanges(changes) {
  const groups = new Map();
  for (const change of changes) {
    const group = changeGroup(change.path);
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
    result.changes.length ? formatGroupedChanges(result.changes) : "(none)",
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

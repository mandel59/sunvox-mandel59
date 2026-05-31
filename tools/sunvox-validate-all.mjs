#!/usr/bin/env node
import { readFile, readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { formatValidationIssue, parseContainer, validateContainer } from "./sunvox-codec.mjs";

const DEFAULT_ROOTS = [
  "music",
  "instruments",
  "generated/music",
  "generated/instruments",
  "test/fixtures/sunvox",
];
const SAMPLE_EXTENSIONS = new Set([".sunvox", ".sunsynth"]);

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

async function validateFile(file) {
  const document = parseContainer(await readFile(file));
  return validateContainer(document);
}

async function main(argv) {
  const files = await findFiles(argv.length ? argv : DEFAULT_ROOTS);
  if (files.length === 0) {
    console.error("No SunVox sample files found.");
    process.exitCode = 1;
    return;
  }

  let issueCount = 0;
  for (const file of files) {
    const displayPath = relative(process.cwd(), file);
    try {
      const result = await validateFile(file);
      if (result.issues.length === 0) {
        console.log(`${displayPath}: no validation issues`);
        continue;
      }
      issueCount += result.issues.length;
      console.error(`${displayPath}: ${result.issues.length} validation issue(s)`);
      for (const issue of result.issues) {
        console.error(`  ${formatValidationIssue(issue)}`);
      }
    } catch (error) {
      issueCount += 1;
      console.error(`${displayPath}: ${error instanceof Error ? error.message : error}`);
    }
  }

  if (issueCount > 0) {
    console.error(`SunVox validation failed with ${issueCount} issue(s).`);
    process.exitCode = 1;
    return;
  }
  console.log(`SunVox validation passed for ${files.length} files.`);
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  await main(process.argv.slice(2));
}

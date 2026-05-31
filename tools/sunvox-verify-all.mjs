#!/usr/bin/env node
import { readdir, stat } from "node:fs/promises";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { verify } from "./sunvox-codec.mjs";

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

async function main(argv) {
  const files = await findFiles(argv.length ? argv : DEFAULT_ROOTS);
  if (files.length === 0) {
    console.error("No SunVox sample files found.");
    process.exitCode = 1;
    return;
  }

  let failures = 0;
  for (const file of files) {
    try {
      await verify(file);
    } catch (error) {
      failures += 1;
      console.error(`${relative(process.cwd(), file)}: ${error instanceof Error ? error.message : error}`);
    }
  }
  if (failures > 0) {
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  await main(process.argv.slice(2));
}

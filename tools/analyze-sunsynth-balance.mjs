#!/usr/bin/env node
import { readdir, stat, writeFile } from "node:fs/promises";
import { basename, extname, join, resolve, relative } from "node:path";
import { pathToFileURL } from "node:url";

import { analyzeSunsynthFile, parseProbe } from "./sunsynth-characterize.mjs";

const SUNSYNTH_EXTENSION = ".sunsynth";
const DEFAULT_FORMAT = "text";
const DEFAULT_PROBE = "C4:96:0.5";

function usage() {
  console.error(`Usage:
  node tools/analyze-sunsynth-balance.mjs [--format json|tsv|text] [--probe <note:velocity:gate>] [--out <file>] [--recursive] [--no-recursive] [--target-lufs <number>] [--dir <path> ...] <file-or-dir...>

Examples:
  node tools/analyze-sunsynth-balance.mjs
  node tools/analyze-sunsynth-balance.mjs --format tsv generated/instruments
  node tools/analyze-sunsynth-balance.mjs --format json --probe C3:96:0.5 --probe C4:112:1.0 generated/instruments`);
}

function parseArgs(argv) {
  const options = {
    files: [],
    format: DEFAULT_FORMAT,
    probes: [],
    explicitProbes: false,
    outPath: undefined,
    recursive: true,
    targetLufs: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--format") {
      index += 1;
      const value = argv[index];
      if (!value) {
        throw new Error("--format requires a value");
      }
      const normalized = value.toLowerCase();
      if (normalized !== "text" && normalized !== "tsv" && normalized !== "json") {
        throw new Error("--format must be text, tsv, or json");
      }
      options.format = normalized;
      continue;
    }
    if (arg === "--probe") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--probe requires a value");
      }
      options.probes.push(parseProbe(argv[index]));
      options.explicitProbes = true;
      continue;
    }
    if (arg === "--out") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--out requires a value");
      }
      options.outPath = argv[index];
      continue;
    }
    if (arg === "--target-lufs") {
      index += 1;
      const value = Number(argv[index]);
      if (!Number.isFinite(value)) {
        throw new Error("--target-lufs requires a number");
      }
      options.targetLufs = value;
      continue;
    }
    if (arg === "--recursive") {
      options.recursive = true;
      continue;
    }
    if (arg === "--no-recursive") {
      options.recursive = false;
      continue;
    }
    if (arg === "--dir") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--dir requires a path");
      }
      options.files.push(argv[index]);
      continue;
    }
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    options.files.push(arg);
  }

  if (!options.files.length) {
    options.files.push("generated/instruments");
  }
  if (!options.explicitProbes) {
    options.probes = [parseProbe(DEFAULT_PROBE)];
  }
  return options;
}

async function collectSunsynthFiles(paths, recursive) {
  const files = [];
  const stack = [...paths.map((value) => resolve(value))];
  while (stack.length > 0) {
    const current = stack.pop();
    const fileInfo = await stat(current).catch(() => undefined);
    if (!fileInfo) {
      throw new Error(`Not found: ${current}`);
    }
    if (fileInfo.isFile()) {
      if (extname(current).toLowerCase() === SUNSYNTH_EXTENSION) {
        files.push(current);
      }
      continue;
    }
    const entries = await readdir(current, { withFileTypes: true }).catch(() => undefined);
    if (!entries) {
      throw new Error(`Not a directory: ${current}`);
    }
    for (const entry of entries) {
      const candidate = join(current, entry.name);
      if (entry.isDirectory()) {
        if (recursive) {
          stack.push(candidate);
        }
        continue;
      }
      if (entry.isFile() && extname(candidate).toLowerCase() === SUNSYNTH_EXTENSION) {
        files.push(candidate);
      }
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function mean(values) {
  if (!values.length) {
    return Number.NaN;
  }
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function formatNumber(value, digits = 3) {
  return Number.isFinite(value) ? value.toFixed(digits) : "-";
}

function roundToDbOffset(target, current) {
  if (!Number.isFinite(target) || !Number.isFinite(current)) {
    return undefined;
  }
  return target - current;
}

async function analyzeBatch(files, probes) {
  const batch = [];
  for (const file of files) {
    const rows = [];
    for (const probe of probes) {
      const result = await analyzeSunsynthFile(file, probe, "pattern-playback");
      const { features } = result;
      rows.push({
        maxMomentaryLufs: features.loudness.maxMomentaryLufs,
        perceivedMomentaryLufs: features.loudness.perceivedMomentaryLufs,
        perceivedBoostDb: features.loudness.perceivedBoostDb,
        peak: features.level.peak,
        centroid: features.spectrum.body.centroidHz,
        highRatio: features.spectrum.body.highRatio * 100,
        inharmonicity: features.spectrum.body.inharmonicityCents,
      });
    }
    const byProbe = rows.map((row) => row.maxMomentaryLufs);
    const byPerceived = rows.map((row) => row.perceivedMomentaryLufs);
    batch.push({
      file: relative(process.cwd(), file),
      name: basename(file),
      count: rows.length,
      probes: rows,
      maxMomentaryLufs: Math.max(...byProbe),
      meanMomentaryLufs: mean(byProbe),
      maxPerceivedLufs: Math.max(...byPerceived),
      meanPerceivedLufs: mean(byPerceived),
      meanPeak: mean(rows.map((row) => row.peak)),
      meanCentroid: mean(rows.map((row) => row.centroid)),
      meanHighRatio: mean(rows.map((row) => row.highRatio)),
      meanInharmonicity: mean(rows.map((row) => row.inharmonicity)),
      boost: mean(rows.map((row) => row.perceivedBoostDb)),
    });
  }
  return batch;
}

function renderText(summary, options) {
  const header = [
    "File",
    "#",
    "Lufs",
    "P-Lufs",
    "Peak",
    "Cent",
    "High%",
    "Inharm",
    "Per-Boost",
  ];
  if (Number.isFinite(options.targetLufs)) {
    header.push("ToTarget");
  }
  const rows = [header];
  for (const item of summary) {
    const row = [
      item.name,
      String(item.count),
      formatNumber(item.maxMomentaryLufs, 1),
      formatNumber(item.maxPerceivedLufs, 1),
      formatNumber(item.meanPeak, 3),
      formatNumber(item.meanCentroid, 1),
      formatNumber(item.meanHighRatio, 1) + "%",
      formatNumber(item.meanInharmonicity, 1),
      formatNumber(item.boost, 2),
    ];
    if (Number.isFinite(options.targetLufs)) {
      row.push(formatNumber(roundToDbOffset(options.targetLufs, item.maxPerceivedLufs), 1));
    }
    rows.push(row);
  }
  const widths = rows[0].map((_, index) => Math.max(...rows.map((row) => row[index].length)));
  return rows
    .map((row, rowIndex) => {
      const line = row.map((value, index) => value.padEnd(widths[index])).join("  ");
      if (rowIndex === 0) {
        return `${line}\n${widths.map((width) => "-".repeat(width)).join("  ")}`;
      }
      return line;
    })
    .join("\n");
}

function renderTsv(summary, options) {
  const header = ["file", "probeCount", "maxLufs", "maxPerceivedLufs", "meanPeak", "meanCentroidHz", "meanHighRatio", "meanInharmonicity", "meanBoostDb"];
  if (Number.isFinite(options.targetLufs)) {
    header.push("deltaToTargetDb");
  }
  const lines = [header.join("\t")];
  for (const item of summary) {
    const line = [
      item.file,
      String(item.count),
      formatNumber(item.maxMomentaryLufs, 2),
      formatNumber(item.maxPerceivedLufs, 2),
      formatNumber(item.meanPeak, 3),
      formatNumber(item.meanCentroid, 1),
      formatNumber(item.meanHighRatio, 1),
      formatNumber(item.meanInharmonicity, 1),
      formatNumber(item.boost, 2),
    ];
    if (Number.isFinite(options.targetLufs)) {
      line.push(formatNumber(roundToDbOffset(options.targetLufs, item.maxPerceivedLufs), 2));
    }
    lines.push(line.join("\t"));
  }
  return `${lines.join("\n")}`;
}

function renderJson(summary) {
  return JSON.stringify(
    {
      files: summary,
      count: summary.length,
      metrics: {
        maxPerceivedLufs: mean(summary.map((item) => item.maxPerceivedLufs)),
        minPerceivedLufs: Math.min(...summary.map((item) => item.maxPerceivedLufs)),
        maxRawLufs: Math.max(...summary.map((item) => item.maxMomentaryLufs)),
      },
    },
    null,
    2,
  );
}

function renderSummary(report, options) {
  if (options.format === "json") {
    return renderJson(report);
  }
  if (options.format === "tsv") {
    return renderTsv(report, options);
  }
  return renderText(report, options);
}

async function main(argv) {
  let options;
  try {
    options = parseArgs(argv);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    usage();
    process.exitCode = 1;
    return;
  }
  if (options.help) {
    usage();
    return;
  }

  try {
    const files = await collectSunsynthFiles(options.files, options.recursive);
    const report = await analyzeBatch(files, options.probes);
    const output = renderSummary(report, options);
    if (options.outPath) {
      await writeFile(options.outPath, `${output}\n`, "utf8");
      return;
    }
    console.log(output);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  await main(process.argv.slice(2));
}

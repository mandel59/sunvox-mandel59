#!/usr/bin/env node
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseContainer } from "./sunvox-codec.mjs";
import { summarizeMomentaryLufs } from "./sunvox-music-recipe-helpers.mjs";
import {
  DEFAULT_BLOCK_FRAMES,
  DEFAULT_CHANNELS,
  DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
  DEFAULT_SAMPLE_RATE,
  assertSunVoxOk,
  loadProjectFromBuffer,
  renderSlotAudio,
  withSunVoxSlot,
} from "./sunvox-node.mjs";

const DEFAULT_DURATION_SECONDS = 16;
const DEFAULT_OUTPUT_FORMAT = "tsv";
const SUNVOX_EXTENSION = ".sunvox";

function usage() {
  console.error(`Usage:
  node tools/analyze-sunvox-balance.mjs [--format tsv|json|text] [--duration <seconds>] [--out <file>] [--sample-rate <hz>] [--channels <1..2>] [--dir <path> ...] [--recursive] [--no-recursive] [--help] <file-or-dir...>

Examples:
  node tools/analyze-sunvox-balance.mjs
  node tools/analyze-sunvox-balance.mjs generated/music
  node tools/analyze-sunvox-balance.mjs --format json --out var/sunvox-balance.json generated/music generated/instruments`);
}

function parseArgs(argv) {
  const options = {
    files: [],
    format: DEFAULT_OUTPUT_FORMAT,
    durationSeconds: DEFAULT_DURATION_SECONDS,
    sampleRate: DEFAULT_SAMPLE_RATE,
    channels: DEFAULT_CHANNELS,
    outPath: undefined,
    recursive: true,
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
      if (normalized !== "tsv" && normalized !== "json" && normalized !== "text") {
        throw new Error("--format must be tsv, json, or text");
      }
      options.format = normalized;
      continue;
    }
    if (arg === "--duration") {
      index += 1;
      options.durationSeconds = Number(argv[index]);
      if (!Number.isFinite(options.durationSeconds) || options.durationSeconds <= 0) {
        throw new Error("--duration must be a positive number");
      }
      continue;
    }
    if (arg === "--sample-rate") {
      index += 1;
      options.sampleRate = Number(argv[index]);
      if (!Number.isFinite(options.sampleRate) || options.sampleRate <= 0) {
        throw new Error("--sample-rate must be a positive number");
      }
      continue;
    }
    if (arg === "--channels") {
      index += 1;
      options.channels = Number(argv[index]);
      if (!Number.isInteger(options.channels) || options.channels < 1 || options.channels > 2) {
        throw new Error("--channels must be 1 or 2");
      }
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
    if (arg === "--dir" || arg === "--path") {
      index += 1;
      if (!argv[index]) {
        throw new Error(`${arg} requires a path`);
      }
      options.files.push(argv[index]);
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
    if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    }
    options.files.push(arg);
  }

  if (!options.files.length) {
    options.files.push("generated/music");
  }
  return options;
}

async function collectSunvoxFiles(paths, { recursive }) {
  const files = [];
  const queue = [...paths];
  for (const input of queue) {
    const currentPath = resolve(input);
    const info = await stat(currentPath).catch(() => undefined);
    if (!info) {
      throw new Error(`Not found: ${input}`);
    }
    if (info.isDirectory()) {
      const children = await readdir(currentPath, { withFileTypes: true });
      for (const child of children) {
        const childPath = join(currentPath, child.name);
        if (child.isDirectory()) {
          if (recursive) {
            queue.push(childPath);
          }
          continue;
        }
        if (child.isFile() && extname(child.name).toLowerCase() === SUNVOX_EXTENSION) {
          files.push(childPath);
        }
      }
      continue;
    }
    if (info.isFile() && extname(currentPath).toLowerCase() === SUNVOX_EXTENSION) {
      files.push(currentPath);
      continue;
    }
  }
  return files.sort((left, right) => left.localeCompare(right));
}

function summarizeSamples(samples, channels) {
  let peak = 0;
  let sumSquares = 0;
  let clippedSamples = 0;
  let activeSamples = 0;
  const epsilon = 1e-5;

  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    const absolute = Math.abs(value);
    peak = Math.max(peak, absolute);
    sumSquares += value * value;
    if (absolute >= 1) {
      clippedSamples += 1;
    }
    if (absolute > epsilon) {
      activeSamples += 1;
    }
  }

  return {
    peak,
    rms: samples.length ? Math.sqrt(sumSquares / samples.length) : 0,
    activeRatio: samples.length ? activeSamples / samples.length : 0,
    clippedSamples,
    frames: samples.length ? samples.length / Math.max(1, channels) : 0,
  };
};

async function analyzeFile(filePath, { sampleRate, channels, durationSeconds }) {
  const absolutePath = resolve(filePath);
  const bytes = await readFile(absolutePath);
  const parsed = parseContainer(bytes);

  const documentSummary = {
    name: parsed.project?.name ?? basename(filePath),
    bpm: parsed.project?.bpm,
    speed: parsed.project?.speed,
    globalVolume: parsed.project?.globalVolume,
    globalVolumePercent:
      parsed.project?.globalVolume === undefined ? undefined : (parsed.project.globalVolume / 256) * 100,
    patternCount: parsed.patterns?.length ?? 0,
  };

  const rendered = await withSunVoxSlot(
    {
      sampleRate,
      channels,
      flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
    },
    async ({ module, slot }) => {
      loadProjectFromBuffer(module, bytes, { slot });
      assertSunVoxOk(module._sv_play_from_beginning(slot), "sv_play_from_beginning");
      const output = renderSlotAudio(module, {
        slot,
        sampleRate,
        channels,
        durationSeconds,
        blockFrames: DEFAULT_BLOCK_FRAMES,
      });
      assertSunVoxOk(module._sv_stop(slot), "sv_stop");
      return output;
    },
  );

  const frameStats = summarizeSamples(rendered.samples, channels);
  const loudness = summarizeMomentaryLufs(rendered.samples, channels, sampleRate);

  return {
    file: absolutePath.replace(/\\/gu, "/"),
    ...documentSummary,
    options: {
      sampleRate,
      channels,
      durationSeconds,
    },
    metrics: {
      shortLufs: loudness.shortLufs,
      momentaryLufs: loudness.momentaryLufs,
      activeLufs: loudness.activeLufs,
      peak: frameStats.peak,
      rms: frameStats.rms,
      activeRatio: frameStats.activeRatio,
      clippedSamples: frameStats.clippedSamples,
      frames: frameStats.frames,
    },
  };
}

function formatNumber(value, digits) {
  if (!Number.isFinite(value)) {
    return "";
  }
  return value.toFixed(digits);
}

function renderTsv(results) {
  const rows = [
    [
      "file",
      "name",
      "bpm",
      "speed",
      "globalVolume",
      "globalVolumePercent",
      "shortLufs",
      "momentaryLufs",
      "activeLufs",
      "peak",
      "rms",
      "activeRatio",
      "clipped",
      "durationSeconds",
      "sampleRate",
      "channels",
      "patterns",
      "error",
    ],
  ];
  for (const result of results) {
    const m = result.metrics ?? {};
    const error = result.error ? String(result.error).replaceAll("\n", "\\n") : "";
    rows.push([
      result.file,
      result.name,
      String(result.bpm ?? ""),
      String(result.speed ?? ""),
      String(result.globalVolume ?? ""),
      formatNumber(result.globalVolumePercent, 1),
      formatNumber(m.shortLufs, 2),
      formatNumber(m.momentaryLufs, 2),
      formatNumber(m.activeLufs, 2),
      formatNumber(m.peak, 3),
      formatNumber(m.rms, 3),
      formatNumber(m.activeRatio, 3),
      String(m.clippedSamples ?? ""),
      String(result.options?.durationSeconds ?? ""),
      String(result.options?.sampleRate ?? ""),
      String(result.options?.channels ?? ""),
      String(result.patternCount ?? ""),
      error,
    ]);
  }
  return rows.map((row) => row.join("\t")).join("\n");
}

function renderText(results) {
  const lines = [
    "file\tglobalVolume\tglobalVolumePercent\tshortLufs\tmomentaryLufs\tactiveLufs\tpeak\trms\tactiveRatio\tclipped\tdurationSeconds\tsampleRate\tchannels\tpatterns\terror\tname",
  ];
  for (const result of results) {
    if (result.error) {
      lines.push(
        [
          result.file,
          String(result.globalVolume ?? ""),
          formatNumber(result.globalVolumePercent, 1),
          "",
          "",
          "",
          "",
          "",
          "",
          "",
          String(result.options?.durationSeconds ?? ""),
          String(result.options?.sampleRate ?? ""),
          String(result.options?.channels ?? ""),
          String(result.patternCount ?? ""),
          "ERROR",
          String(result.error).replaceAll("\n", "\\n"),
        ].join("\t"),
      );
      continue;
    }
    const m = result.metrics;
    lines.push(
      [
        result.file,
        String(result.globalVolume ?? ""),
        formatNumber(result.globalVolumePercent, 1),
        formatNumber(m.shortLufs, 2),
        formatNumber(m.momentaryLufs, 2),
        formatNumber(m.activeLufs, 2),
        formatNumber(m.peak, 3),
        formatNumber(m.rms, 3),
        formatNumber(m.activeRatio, 3),
        String(m.clippedSamples ?? ""),
        String(result.options?.durationSeconds ?? ""),
        String(result.options?.sampleRate ?? ""),
        String(result.options?.channels ?? ""),
        String(result.patternCount ?? ""),
        "",
        result.name,
      ].join("\t"),
    );
  }
  return lines.join("\n");
}

function normalizeResult(result, file) {
  return {
    ...result,
    file: result.file ?? resolve(file).replace(/\\/gu, "/"),
    name: result.name ?? basename(file),
  };
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

  let paths;
  try {
    paths = await collectSunvoxFiles(options.files, options);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
    return;
  }

  if (!paths.length) {
    console.error("No .sunvox files found");
    process.exitCode = 1;
    return;
  }

  const results = [];
  for (const path of paths) {
    try {
      const result = await analyzeFile(path, {
        sampleRate: options.sampleRate,
        channels: options.channels,
        durationSeconds: options.durationSeconds,
      });
      results.push(normalizeResult(result, path));
    } catch (error) {
      results.push({ file: resolve(path).replace(/\\/gu, "/"), error: error instanceof Error ? error.message : String(error) });
    }
  }

  const output = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    analyzedBy: "tools/analyze-sunvox-balance.mjs",
    options: {
      sampleRate: options.sampleRate,
      channels: options.channels,
      durationSeconds: options.durationSeconds,
      recursive: options.recursive,
      format: options.format,
      sources: options.files,
    },
    results,
    summary: {
      count: results.length,
      success: results.filter((item) => !item.error).length,
      failed: results.filter((item) => Boolean(item.error)).length,
    },
  };

  let serialized;
  if (options.format === "json") {
    serialized = `${JSON.stringify(output, null, 2)}\n`;
  } else if (options.format === "text") {
    serialized = `${renderText(results)}\n`;
  } else {
    serialized = `${renderTsv(results)}\n`;
  }

  if (options.outPath) {
    await writeFile(options.outPath, serialized);
    console.log(`saved ${options.outPath}`);
    return;
  }
  process.stdout.write(serialized);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  await main(process.argv.slice(2));
}

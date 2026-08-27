#!/usr/bin/env node
import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { basename, extname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildContainer, parseContainer } from "./sunvox-codec.mjs";
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
const DEFAULT_WINDOW_BARS = 4;
const PART_ACTIVE_WINDOW_GATE_DB = -18;
const SUNVOX_EXTENSION = ".sunvox";

function usage() {
  console.error(`Usage:
  node tools/analyze-sunvox-balance.mjs [--format tsv|json|text] [--duration <seconds>] [--parts] [--window-bars <bars>] [--out <file>] [--sample-rate <hz>] [--channels <1..2>] [--dir <path> ...] [--recursive] [--no-recursive] [--help] <file-or-dir...>

Examples:
  node tools/analyze-sunvox-balance.mjs
  node tools/analyze-sunvox-balance.mjs generated/music
  node tools/analyze-sunvox-balance.mjs --parts --duration 60 --format text generated/music/aurora-pulse.sunvox
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
    parts: false,
    windowBars: DEFAULT_WINDOW_BARS,
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
    if (arg === "--parts") {
      options.parts = true;
      continue;
    }
    if (arg === "--window-bars") {
      index += 1;
      options.windowBars = Number(argv[index]);
      if (!Number.isFinite(options.windowBars) || options.windowBars <= 0) {
        throw new Error("--window-bars must be a positive number");
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

function median(values) {
  const finite = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!finite.length) {
    return Number.NaN;
  }
  const middle = Math.floor(finite.length / 2);
  return finite.length % 2 ? finite[middle] : (finite[middle - 1] + finite[middle]) / 2;
}

export function classifyPartRole(name, type = "") {
  const text = `${name} ${type}`.toLowerCase();
  if (/kick/u.test(text)) return "kick";
  if (/bass|sub/u.test(text)) return "bass";
  if (/drum|hat|clap|snare|perc/u.test(text)) return "drums";
  if (/chord|stab/u.test(text)) return "chords";
  if (/lead|supersaw/u.test(text)) return "lead";
  if (/arp|pluck|sequence/u.test(text)) return "arp";
  if (/pad|string/u.test(text)) return "pad";
  if (/riser|lift|noise|sweep/u.test(text)) return "transition";
  return "other";
}

const ROLE_TARGETS = Object.freeze({
  kick: [-3, 3],
  bass: [-3, 3],
  drums: [-6, 1],
  chords: [-4, 2],
  lead: [-4, 2],
  arp: [-12, -4],
  pad: [-10, -2],
  transition: [-14, -4],
  other: [-8, 2],
});

function assessRelativeLevel(role, relativeDb) {
  if (!Number.isFinite(relativeDb)) return "silent";
  const [minimum, maximum] = ROLE_TARGETS[role] ?? ROLE_TARGETS.other;
  if (relativeDb < minimum) return "low";
  if (relativeDb > maximum) return "high";
  return "balanced";
}

export function assessPartWindows(parts) {
  for (const part of parts) {
    const maximumActiveLufs = Math.max(
      Number.NEGATIVE_INFINITY,
      ...part.windows.map((window) => window.activeLufs).filter(Number.isFinite),
    );
    for (const window of part.windows) {
      window.includedInBalance =
        Number.isFinite(window.activeLufs) && window.activeLufs >= maximumActiveLufs + PART_ACTIVE_WINDOW_GATE_DB;
    }
  }
  const windowCount = Math.max(0, ...parts.map((part) => part.windows?.length ?? 0));
  for (let windowIndex = 0; windowIndex < windowCount; windowIndex += 1) {
    const peerMedian = median(parts.map((part) => {
      const window = part.windows?.[windowIndex];
      return window?.includedInBalance ? window.activeLufs : Number.NaN;
    }));
    for (const part of parts) {
      const window = part.windows?.[windowIndex];
      if (!window) continue;
      window.peerMedianLufs = peerMedian;
      window.relativeToPeerMedianDb =
        window.includedInBalance && Number.isFinite(peerMedian) ? window.activeLufs - peerMedian : Number.NaN;
    }
  }
  for (const part of parts) {
    const relativeWindows = part.windows
      .map((window) => window.relativeToPeerMedianDb)
      .filter(Number.isFinite);
    part.balance = {
      activeWindowCount: relativeWindows.length,
      activeWindowGateDb: PART_ACTIVE_WINDOW_GATE_DB,
      targetRelativeToPeerDb: ROLE_TARGETS[part.role] ?? ROLE_TARGETS.other,
      medianRelativeToPeerDb: median(relativeWindows),
      minimumRelativeToPeerDb: relativeWindows.length ? Math.min(...relativeWindows) : Number.NaN,
      maximumRelativeToPeerDb: relativeWindows.length ? Math.max(...relativeWindows) : Number.NaN,
    };
    part.balance.assessment = assessRelativeLevel(part.role, part.balance.medianRelativeToPeerDb);
  }
  return parts;
}

function sourceModules(document) {
  return (document.modules ?? [])
    .map((module, moduleIndex) => ({ module, moduleIndex }))
    .filter(({ module }) =>
      !module.flags?.output &&
      !(module.inputs?.length > 0) &&
      Number.isFinite(module.controllers?.volume),
    );
}

function sliceSeconds(samples, channels, sampleRate, startSeconds, endSeconds) {
  const start = Math.max(0, Math.floor(startSeconds * sampleRate) * channels);
  const end = Math.min(samples.length, Math.floor(endSeconds * sampleRate) * channels);
  return samples.slice(start, end);
}

async function renderProject(bytes, { sampleRate, channels, durationSeconds }) {
  return withSunVoxSlot(
    { sampleRate, channels, flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS },
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
}

async function analyzeParts(document, fullSamples, options) {
  const candidates = sourceModules(document);
  const bpm = Number(document.project?.bpm);
  const windowSeconds = Number.isFinite(bpm) && bpm > 0
    ? (60 / bpm) * 4 * options.windowBars
    : Math.min(8, options.durationSeconds);
  const parts = [];
  for (const candidate of candidates) {
    const soloDocument = structuredClone(document);
    for (const other of candidates) {
      if (other.moduleIndex !== candidate.moduleIndex) {
        soloDocument.modules[other.moduleIndex].controllers.volume = 0;
      }
    }
    const rendered = await renderProject(buildContainer(soloDocument), options);
    const level = summarizeSamples(rendered.samples, options.channels);
    const loudness = summarizeMomentaryLufs(rendered.samples, options.channels, options.sampleRate);
    const windows = [];
    for (let startSeconds = 0, index = 0; startSeconds < options.durationSeconds; startSeconds += windowSeconds, index += 1) {
      const endSeconds = Math.min(options.durationSeconds, startSeconds + windowSeconds);
      const partSlice = sliceSeconds(rendered.samples, options.channels, options.sampleRate, startSeconds, endSeconds);
      const mixSlice = sliceSeconds(fullSamples, options.channels, options.sampleRate, startSeconds, endSeconds);
      const partLevel = summarizeSamples(partSlice, options.channels);
      const partLoudness = summarizeMomentaryLufs(partSlice, options.channels, options.sampleRate);
      const mixLoudness = summarizeMomentaryLufs(mixSlice, options.channels, options.sampleRate);
      const activeLufs = partLevel.activeRatio > 0 ? partLoudness.activeLufs : Number.NEGATIVE_INFINITY;
      windows.push({
        index,
        startBar: index * options.windowBars,
        endBar: (index + 1) * options.windowBars,
        startSeconds,
        endSeconds,
        activeLufs,
        mixActiveLufs: mixLoudness.activeLufs,
        relativeToMixDb:
          Number.isFinite(activeLufs) && Number.isFinite(mixLoudness.activeLufs)
            ? activeLufs - mixLoudness.activeLufs
            : Number.NaN,
        peak: partLevel.peak,
        rms: partLevel.rms,
        activeRatio: partLevel.activeRatio,
      });
    }
    parts.push({
      moduleIndex: candidate.moduleIndex,
      name: candidate.module.name ?? `Module ${candidate.moduleIndex}`,
      type: candidate.module.type,
      role: classifyPartRole(candidate.module.name, candidate.module.type),
      metrics: {
        activeLufs: loudness.activeLufs,
        activeTopLufs: loudness.activeTopLufs,
        peak: level.peak,
        rms: level.rms,
        activeRatio: level.activeRatio,
      },
      windows,
    });
  }
  return {
    method: "solo-through-project-routing, four-bar windows, role-aware peer-median comparison",
    windowBars: options.windowBars,
    windowSeconds,
    parts: assessPartWindows(parts),
  };
}

async function analyzeFile(filePath, { sampleRate, channels, durationSeconds, parts, windowBars }) {
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

  const rendered = await renderProject(bytes, { sampleRate, channels, durationSeconds });

  const frameStats = summarizeSamples(rendered.samples, channels);
  const loudness = summarizeMomentaryLufs(rendered.samples, channels, sampleRate);

  const result = {
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
  if (parts) {
    result.partBalance = await analyzeParts(parsed, rendered.samples, {
      sampleRate,
      channels,
      durationSeconds,
      windowBars,
    });
  }
  return result;
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
  const withParts = results.filter((result) => result.partBalance?.parts?.length);
  if (withParts.length) {
    lines.push("");
    lines.push("Part balance uses active four-bar windows and compares each role with the median of audible peers.");
    lines.push("file\tmodule\trole\tactiveLufs\tpeak\tactiveWindows\trelativeToPeerMedianDb\tminDb\tmaxDb\ttargetDb\tassessment");
    for (const result of withParts) {
      for (const part of result.partBalance.parts) {
        const balance = part.balance;
        lines.push([
          result.file,
          `${part.moduleIndex}:${part.name}`,
          part.role,
          formatNumber(part.metrics.activeLufs, 2),
          formatNumber(part.metrics.peak, 3),
          String(balance.activeWindowCount),
          formatNumber(balance.medianRelativeToPeerDb, 2),
          formatNumber(balance.minimumRelativeToPeerDb, 2),
          formatNumber(balance.maximumRelativeToPeerDb, 2),
          balance.targetRelativeToPeerDb.join(".."),
          balance.assessment,
        ].join("\t"));
      }
    }
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
        parts: options.parts,
        windowBars: options.windowBars,
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
      parts: options.parts,
      windowBars: options.windowBars,
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

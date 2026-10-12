#!/usr/bin/env node
import { mkdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildContainer, parseContainer } from "./sunvox-codec.mjs";
import { summarizeAudio } from "./sunvox-audio-stats.mjs";
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
import { writeWavFile } from "./wav-io.mjs";

const DEFAULT_TAIL_SECONDS = 4;

function usage() {
  console.error(`Usage:
  node tools/sunvox-render-audio.mjs [options] <project.sunvox>

Renders a SunVox project offline through SunVox Lib and writes a WAV file.

Options:
  --out <file.wav>       Output path (default: <project>.wav next to the input)
  --duration <seconds>   Render length (default: song length + tail)
  --tail <seconds>       Extra seconds after the song length (default: ${DEFAULT_TAIL_SECONDS})
  --bit-depth <16|24|32> WAV sample format; 32 writes IEEE float (default: 16)
  --mute <names>         Comma-separated module names or #indices to disconnect
  --solo <names>         Comma-separated module names or #indices to keep; other
                         source generators are disconnected
  --set <Module.ctl=v>   Override a module controller before rendering
                         (repeatable), e.g. --set "Last Train Limiter.slope=0"
  --loop                 Keep looping past the song end (autostop off); use
                         with --duration to check loop playback
  --json                 Print render statistics as JSON`);
}

function parseArgs(argv) {
  const options = { tailSeconds: DEFAULT_TAIL_SECONDS, bitDepth: 16, mute: [], solo: [], set: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = () => {
      index += 1;
      if (argv[index] === undefined) throw new Error(`${arg} requires a value`);
      return argv[index];
    };
    if (arg === "--help" || arg === "-h") options.help = true;
    else if (arg === "--out") options.outPath = next();
    else if (arg === "--duration") options.durationSeconds = Number(next());
    else if (arg === "--tail") options.tailSeconds = Number(next());
    else if (arg === "--bit-depth") options.bitDepth = Number(next());
    else if (arg === "--mute") options.mute.push(...next().split(",").filter(Boolean));
    else if (arg === "--solo") options.solo.push(...next().split(",").filter(Boolean));
    else if (arg === "--set") options.set.push(next());
    else if (arg === "--json") options.json = true;
    else if (arg === "--loop") options.loop = true;
    else if (arg.startsWith("--")) throw new Error(`Unknown option: ${arg}`);
    else options.input = arg;
  }
  return options;
}

function resolveModuleIndices(document, selectors) {
  return selectors.map((selector) => {
    if (/^#\d+$/u.test(selector)) return Number(selector.slice(1));
    const index = (document.modules ?? []).findIndex((module) => module?.name === selector);
    if (index < 0) throw new Error(`Unknown module: ${selector}`);
    return index;
  });
}

function isSourceGenerator(module) {
  return Boolean(module) && !module.flags?.output && !(module.inputs?.length > 0);
}

export function disconnectModules(document, moduleIndices) {
  const disconnected = new Set(moduleIndices);
  for (const module of document.modules ?? []) {
    if (!Array.isArray(module?.inputs)) continue;
    module.inputs = module.inputs.filter((input) => !disconnected.has(input?.module));
  }
  return document;
}

export function applyMuteSolo(bytes, { mute = [], solo = [], set = [] } = {}) {
  if (!mute.length && !solo.length && !set.length) return bytes;
  const document = parseContainer(bytes);
  for (const assignment of set) {
    const match = /^(.+)\.([A-Za-z0-9]+)=(.+)$/u.exec(assignment);
    if (!match) throw new Error(`Invalid --set assignment: ${assignment}`);
    const [index] = resolveModuleIndices(document, [match[1]]);
    const numeric = Number(match[3]);
    document.modules[index].controllers[match[2]] = Number.isFinite(numeric) ? numeric : match[3];
  }
  const muted = new Set(resolveModuleIndices(document, mute));
  if (solo.length) {
    const kept = new Set(resolveModuleIndices(document, solo));
    for (const [index, module] of (document.modules ?? []).entries()) {
      if (isSourceGenerator(module) && !kept.has(index)) muted.add(index);
    }
  }
  return buildContainer(disconnectModules(document, [...muted]));
}

export async function renderProjectAudio(bytes, { durationSeconds, tailSeconds = DEFAULT_TAIL_SECONDS, loop = false } = {}) {
  return withSunVoxSlot(
    { sampleRate: DEFAULT_SAMPLE_RATE, channels: DEFAULT_CHANNELS, flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS },
    async ({ module, slot, sampleRate, channels }) => {
      loadProjectFromBuffer(module, bytes, { slot });
      assertSunVoxOk(module._sv_volume(slot, 256), "sv_volume");
      // Stop at the song end so the tail is reverb release, not a loop restart.
      module._sv_set_autostop(slot, loop ? 0 : 1);
      const songFrames = module._sv_get_song_length_frames(slot) >>> 0;
      const seconds = durationSeconds ?? songFrames / sampleRate + tailSeconds;
      assertSunVoxOk(module._sv_play_from_beginning(slot), "sv_play_from_beginning");
      const audio = renderSlotAudio(module, {
        slot,
        sampleRate,
        channels,
        durationSeconds: seconds,
        blockFrames: DEFAULT_BLOCK_FRAMES,
      });
      assertSunVoxOk(module._sv_stop(slot), "sv_stop");
      return { ...audio, songSeconds: songFrames / sampleRate, durationSeconds: seconds };
    },
  );
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help || !options.input) {
    usage();
    process.exitCode = options.help ? 0 : 1;
    return;
  }
  const inputPath = resolve(options.input);
  const outPath = resolve(options.outPath ?? inputPath.replace(/\.sunvox$/iu, "") + ".wav");
  const bytes = applyMuteSolo(await readFile(inputPath), options);
  const audio = await renderProjectAudio(bytes, options);
  await mkdir(dirname(outPath), { recursive: true });
  await writeWavFile(outPath, audio.samples, {
    sampleRate: audio.sampleRate,
    channels: audio.channels,
    bitDepth: options.bitDepth,
  });
  const stats = summarizeAudio(audio.samples, audio.channels);
  const result = {
    output: outPath,
    songSeconds: audio.songSeconds,
    durationSeconds: audio.durationSeconds,
    peak: stats.peak,
    peakDbfs: 20 * Math.log10(stats.peak || 1e-12),
    rms: stats.rms,
    clippedSamples: stats.clippedSamples,
    leadingSilenceSeconds: stats.leadingSilenceFrames / audio.sampleRate,
  };
  if (options.json) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    console.log(
      `${outPath}\n  song=${result.songSeconds.toFixed(2)}s rendered=${result.durationSeconds.toFixed(2)}s ` +
        `peak=${result.peakDbfs.toFixed(2)}dBFS rms=${result.rms.toFixed(4)} clipped=${result.clippedSamples} ` +
        `leadingSilence=${result.leadingSilenceSeconds.toFixed(3)}s`,
    );
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  main().catch((error) => {
    console.error(error.stack ?? error.message);
    process.exitCode = 1;
  });
}

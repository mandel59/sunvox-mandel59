#!/usr/bin/env node
import { mkdir, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildContainer,
  formatValidationIssue,
  parseContainer,
  SUNVOX_LIB_PATTERN_DEFAULTS,
  validateContainer,
} from "./sunvox-codec.mjs";

function usage() {
  console.error(`Usage:
  node tools/sunvox-music-recipe.mjs [--out <directory>] <recipe.mjs> [recipe.mjs ...]

SunVox Music Recipe files export plain JavaScript objects annotated with
tools/sunvox-music-recipe.d.ts. The runner writes structured .sunvox outputs.`);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeRecipe(value) {
  if (!isPlainObject(value)) {
    throw new Error("SunVox Music Recipe must be an object");
  }
  if (value.schemaVersion !== 1) {
    throw new Error(`Unsupported SunVox Music Recipe schemaVersion: ${JSON.stringify(value.schemaVersion)}`);
  }
  if (!isPlainObject(value.outputs) || !Object.keys(value.outputs).length) {
    throw new Error("SunVox Music Recipe must include at least one output");
  }
  return value;
}

export async function loadMusicRecipe(recipePath, options = {}) {
  const moduleUrl = pathToFileURL(recipePath);
  if (options.cacheBust) {
    const recipeStat = await stat(recipePath);
    moduleUrl.searchParams.set("mtime", String(recipeStat.mtimeMs));
    moduleUrl.searchParams.set("size", String(recipeStat.size));
  }
  const module = await import(moduleUrl.href);
  return normalizeRecipe(module.default ?? module.recipe);
}

function validateOutputSpec(outputId, output) {
  if (!isPlainObject(output)) {
    throw new Error(`Music recipe output ${outputId} must be an object`);
  }
  if (typeof output.file !== "string" || !output.file.trim()) {
    throw new Error(`Music recipe output ${outputId} must include a file`);
  }
  if (extname(output.file).toLowerCase() !== ".sunvox") {
    throw new Error(`Music recipe output ${outputId} must write a .sunvox file`);
  }
}

async function buildOutputDocument(recipe, context) {
  const { outputId, output } = context;
  let document;
  if (output.document !== undefined) {
    document = output.document;
  } else if (typeof output.buildDocument === "function") {
    document = await output.buildDocument(context);
  } else if (typeof recipe.buildDocument === "function") {
    document = await recipe.buildDocument(context);
  } else {
    throw new Error(`Music recipe output ${outputId} must define document or buildDocument()`);
  }
  applySunVoxLibMusicDefaults(document);
  return document;
}

function shouldApplyPatternDefaults(pattern) {
  return (
    !pattern?.infoFlags?.clone &&
    (pattern?.tracks !== undefined || pattern?.lines !== undefined || Array.isArray(pattern?.events))
  );
}

export function applySunVoxLibMusicDefaults(document) {
  if (!isPlainObject(document) || document.magic !== "SVOX" || !Array.isArray(document.patterns)) {
    return document;
  }
  for (const pattern of document.patterns) {
    if (!isPlainObject(pattern) || !shouldApplyPatternDefaults(pattern)) {
      continue;
    }
    pattern.ySize ??= SUNVOX_LIB_PATTERN_DEFAULTS.ySize;
    pattern.flags ??= {};
    pattern.iconBase64 ??= SUNVOX_LIB_PATTERN_DEFAULTS.iconBase64;
    pattern.foreground ??= SUNVOX_LIB_PATTERN_DEFAULTS.foreground;
    pattern.background ??= SUNVOX_LIB_PATTERN_DEFAULTS.background;
    pattern.infoFlags ??= {};
  }
  return document;
}

function countEvents(document) {
  return (document.patterns ?? []).reduce((total, pattern) => total + (pattern.events?.length ?? 0), 0);
}

function outputSummary({ recipePath, outputId, outputFile, summaryFile, recipe, output, document, bytes, validation }) {
  return {
    schemaVersion: 1,
    recipe: {
      path: relative(process.cwd(), recipePath).replaceAll("\\", "/"),
      outputId,
      ...(recipe.issue !== undefined ? { issue: recipe.issue } : {}),
      ...(recipe.tags ? { tags: recipe.tags } : {}),
    },
    output: {
      path: relative(process.cwd(), outputFile).replaceAll("\\", "/"),
      ...(summaryFile ? { summaryPath: relative(process.cwd(), summaryFile).replaceAll("\\", "/") } : {}),
      bytes,
    },
    project: {
      name: document.project?.name ?? output.title ?? outputId,
      bpm: document.project?.bpm,
      speed: document.project?.speed,
      modules: document.modules?.length ?? 0,
      patterns: document.patterns?.length ?? 0,
      events: countEvents(document),
    },
    validation: {
      ok: validation.ok,
      issues: validation.issues.map(formatValidationIssue),
    },
  };
}

async function runMusicOutput(outputId, output, context, options) {
  validateOutputSpec(outputId, output);
  const document = await buildOutputDocument(context.recipe, { ...context, outputId, output });
  const bytes = buildContainer(document);
  const parsed = parseContainer(bytes);
  const validation = validateContainer(parsed);
  if (!validation.ok) {
    throw new Error(validation.issues.map(formatValidationIssue).join("\n"));
  }

  const outputPath = resolve(options.outDir ?? ".", output.file);
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, bytes);

  const summaryPath = output.summaryFile ? resolve(options.outDir ?? ".", output.summaryFile) : undefined;
  const summary = outputSummary({
    recipePath: context.recipePath,
    outputId,
    outputFile: outputPath,
    summaryFile: summaryPath,
    recipe: context.recipe,
    output,
    document: parsed,
    bytes: bytes.length,
    validation,
  });
  if (summaryPath) {
    await mkdir(dirname(summaryPath), { recursive: true });
    await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
  }

  return { outputPath, summaryPath, summary };
}

export async function runMusicRecipe(recipePath, options = {}) {
  const absoluteRecipePath = resolve(recipePath);
  const recipeDir = dirname(absoluteRecipePath);
  const recipe = await loadMusicRecipe(absoluteRecipePath);
  const context = { recipePath: absoluteRecipePath, recipeDir, recipe };
  const outputs = [];
  for (const [outputId, output] of Object.entries(recipe.outputs)) {
    outputs.push(await runMusicOutput(outputId, output, context, options));
  }
  return outputs;
}

export async function runMusicRecipes(recipePaths, options = {}) {
  if (!Array.isArray(recipePaths) || !recipePaths.length) {
    throw new Error("runMusicRecipes() requires at least one recipe path");
  }
  const outputs = [];
  for (const recipePath of recipePaths) {
    outputs.push(...await runMusicRecipe(recipePath, options));
  }
  return outputs;
}

function parseArgs(argv) {
  const options = { outDir: undefined, recipePaths: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--out requires a directory");
      }
      options.outDir = argv[index];
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      options.recipePaths.push(arg);
    }
  }
  return options;
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
  if (!options.recipePaths.length) {
    usage();
    process.exitCode = 1;
    return;
  }

  try {
    const outputs = await runMusicRecipes(options.recipePaths, options);
    for (const output of outputs) {
      console.log(relative(process.cwd(), output.outputPath).replaceAll("\\", "/") || basename(output.outputPath));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  await main(process.argv.slice(2));
}

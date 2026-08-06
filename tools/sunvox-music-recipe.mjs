#!/usr/bin/env node
import { mkdir, mkdtemp, rename, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
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
  if (output.summaryFile !== undefined && (typeof output.summaryFile !== "string" || !output.summaryFile.trim())) {
    throw new Error(`Music recipe output ${outputId} summaryFile must be a non-empty string`);
  }
}

function resolveOutputPath(outputRoot, declaredPath, description) {
  if (isAbsolute(declaredPath)) {
    throw new Error(`${description} must be relative to the output root: ${declaredPath}`);
  }
  const destination = resolve(outputRoot, declaredPath);
  const relativePath = relative(outputRoot, destination);
  if (relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath)) {
    throw new Error(`${description} escapes the output root: ${declaredPath}`);
  }
  return destination;
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

async function buildMusicOutput(outputId, output, context, outputRoot) {
  validateOutputSpec(outputId, output);
  const outputPath = resolveOutputPath(outputRoot, output.file, `Music recipe output ${outputId} file`);
  const summaryPath = output.summaryFile
    ? resolveOutputPath(outputRoot, output.summaryFile, `Music recipe output ${outputId} summaryFile`)
    : undefined;
  const document = await buildOutputDocument(context.recipe, { ...context, outputId, output });
  const bytes = buildContainer(document);
  const parsed = parseContainer(bytes);
  const validation = validateContainer(parsed);
  if (!validation.ok) {
    throw new Error(validation.issues.map(formatValidationIssue).join("\n"));
  }

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
  return { outputPath, summaryPath, summary, bytes };
}

function claimDestination(destinations, destination, description) {
  const previous = destinations.get(destination);
  if (previous) {
    throw new Error(`Duplicate music recipe destination ${destination}: ${previous} and ${description}`);
  }
  destinations.set(destination, description);
}

async function planMusicRecipes(recipePaths, options) {
  const outputRoot = resolve(options.outDir ?? ".");
  const destinations = new Map();
  const plans = [];
  for (const recipePath of recipePaths) {
    const absoluteRecipePath = resolve(recipePath);
    const recipe = await loadMusicRecipe(absoluteRecipePath, options);
    const context = { recipePath: absoluteRecipePath, recipeDir: dirname(absoluteRecipePath), recipe };
    for (const [outputId, output] of Object.entries(recipe.outputs)) {
      validateOutputSpec(outputId, output);
      const outputPath = resolveOutputPath(outputRoot, output.file, `Music recipe output ${outputId} file`);
      claimDestination(destinations, outputPath, `${recipePath} output ${outputId}`);
      if (output.summaryFile) {
        const summaryPath = resolveOutputPath(
          outputRoot,
          output.summaryFile,
          `Music recipe output ${outputId} summaryFile`,
        );
        claimDestination(destinations, summaryPath, `${recipePath} output ${outputId} summary`);
      }
      plans.push({ outputId, output, context });
    }
  }
  return { outputRoot, plans };
}

async function commitMusicOutputs(outputs, outputRoot) {
  await mkdir(outputRoot, { recursive: true });
  const stagingDir = await mkdtemp(join(outputRoot, ".sunvox-music-recipe-"));
  try {
    const stagedFiles = [];
    for (const [index, output] of outputs.entries()) {
      const stagedOutput = join(stagingDir, `${index}.sunvox`);
      await writeFile(stagedOutput, output.bytes);
      stagedFiles.push({ stagedPath: stagedOutput, destination: output.outputPath });
      if (output.summaryPath) {
        const stagedSummary = join(stagingDir, `${index}.summary.json`);
        await writeFile(stagedSummary, `${JSON.stringify(output.summary, null, 2)}\n`, "utf8");
        stagedFiles.push({ stagedPath: stagedSummary, destination: output.summaryPath });
      }
    }
    for (const { stagedPath, destination } of stagedFiles) {
      await mkdir(dirname(destination), { recursive: true });
      await rename(stagedPath, destination);
    }
  } finally {
    await rm(stagingDir, { recursive: true, force: true });
  }
}

export async function runMusicRecipe(recipePath, options = {}) {
  return runMusicRecipes([recipePath], options);
}

export async function runMusicRecipes(recipePaths, options = {}) {
  if (!Array.isArray(recipePaths) || !recipePaths.length) {
    throw new Error("runMusicRecipes() requires at least one recipe path");
  }
  const { outputRoot, plans } = await planMusicRecipes(recipePaths, options);
  const outputs = [];
  for (const { outputId, output, context } of plans) {
    outputs.push(await buildMusicOutput(outputId, output, context, outputRoot));
  }
  await commitMusicOutputs(outputs, outputRoot);
  return outputs.map(({ bytes: _bytes, ...output }) => output);
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

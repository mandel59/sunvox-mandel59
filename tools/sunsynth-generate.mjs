#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadSunsynthTemplate, SunSynthLab } from "./sunsynth-lab.mjs";

function usage() {
  console.error(`Usage:
  node tools/sunsynth-generate.mjs [--out <directory>] [--json] <recipe.mjs>

Recipe modules can export either a recipe object or a function receiving
{ create, sweep } and returning one.
The basic recipe shape is:
  {
    template: "instruments/mandel59 SuperSaw.sunsynth",
    outDir: "var/synth-lab",
    variants: [
      {
        name: "Glass Variant",
        fileName: "glass-variant.sunsynth",
        rootControllers: { volume: 256 },
        modules: [{ selector: "Filter Pro", controllers: { freq: 6200 } }],
        userControllers: [{ index: 0, label: "Spread", value: 8200 }]
      }
    ]
  }

For generated parameter grids, use sweep({ params, name, fileName, build }).
For scratch MetaModule synths, omit template and set create: true on each
variant. To create a root module `.sunsynth`, use
create: { moduleType: "FMX" }.
Use var/synth-lab for temporary drafts and generated/instruments for generated
instrument files that should be checked in.`);
}

function slug(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
}

function normalizeRecipe(value) {
  if (!value || typeof value !== "object") {
    throw new Error("Recipe must be an object");
  }
  if (!Array.isArray(value.variants) || !value.variants.length) {
    throw new Error("Recipe must include at least one variant");
  }
  return value;
}

function formatTemplate(value, params, index) {
  if (typeof value === "function") {
    return value(params, index);
  }
  return String(value).replace(/\{([A-Za-z0-9_.-]+)\}/gu, (_match, key) => {
    if (key === "index") {
      return String(index);
    }
    return params[key] ?? "";
  });
}

function paramCombinations(params) {
  const entries = Object.entries(params ?? {});
  if (!entries.length) {
    return [{}];
  }
  return entries.reduce(
    (combinations, [key, values]) =>
      combinations.flatMap((combination) => values.map((value) => ({ ...combination, [key]: value }))),
    [{}],
  );
}

export function sweep(config) {
  const combinations = paramCombinations(config.params);
  return combinations.map((params, index) => ({
    name: formatTemplate(config.name ?? `Variant {index}`, params, index),
    fileName: config.fileName ? formatTemplate(config.fileName, params, index) : undefined,
    probes: config.probes,
    params,
    async apply(synth) {
      await config.build(synth, params, index);
    },
  }));
}

function createRecipeContext() {
  return { create: SunSynthLab.create, createModule: SunSynthLab.createModule, sweep };
}

async function loadRecipe(recipePath) {
  const module = await import(pathToFileURL(recipePath));
  const exported = module.default ?? module.recipe;
  const recipe = typeof exported === "function" ? await exported(createRecipeContext()) : exported;
  return normalizeRecipe(recipe);
}

function resolveRecipePath(value, recipeDir) {
  if (!value || isAbsolute(value) || !value.startsWith(".")) {
    return value;
  }
  return resolve(recipeDir, value);
}

function applyObjectVariant(synth, variant) {
  if (variant.name) {
    synth.rename(variant.name);
  }
  for (const [path, value] of Object.entries(variant.rootControllers ?? {})) {
    synth.setRootController(path, value);
  }
  for (const edit of variant.modules ?? []) {
    synth.setModuleControllers(edit.selector, edit.controllers ?? {});
  }
  for (const edit of variant.modulesByType ?? []) {
    synth.setModulesByType(edit.type, edit.update);
  }
  for (const edit of variant.userControllers ?? []) {
    synth.setUserController(edit.index, edit);
  }
}

function createScratchSynth(recipe, variant) {
  const createOptions =
    variant?.create && typeof variant.create === "object"
      ? variant.create
      : recipe.create && typeof recipe.create === "object"
        ? recipe.create
        : {};
  const name =
    typeof variant?.create === "string"
      ? variant.create
      : typeof recipe.create === "string"
        ? recipe.create
        : variant?.name ?? recipe.name ?? "Scratch Synth";
  const moduleType = createOptions.moduleType;
  if (moduleType) {
    const { moduleType: _moduleType, ...moduleOptions } = createOptions;
    return SunSynthLab.createModule(moduleType, { ...moduleOptions, name });
  }
  return SunSynthLab.create(name, createOptions);
}

async function generateVariant(template, recipe, variant, options) {
  const synth = template ? template.clone() : createScratchSynth(recipe, variant);
  if (typeof variant === "function") {
    await variant(synth, { recipe, options });
  } else {
    applyObjectVariant(synth, variant);
    if (variant?.apply && typeof variant.apply === "function") {
      await variant.apply(synth, { recipe, options });
    }
  }

  const name = variant?.name ?? synth.document.module.name ?? "sunsynth-variant";
  const outDir = resolve(options.outDir ?? recipe.outDir ?? "var/synth-lab");
  const fileName = variant?.fileName ?? `${slug(name) || "sunsynth-variant"}.sunsynth`;
  const outputPath = resolve(outDir, fileName);
  await mkdir(dirname(outputPath), { recursive: true });
  await synth.writeSunsynth(outputPath);

  const writeJson = options.json || recipe.json || variant?.json;
  if (writeJson) {
    await synth.writeJson(`${outputPath}.json`);
  }
  return outputPath;
}

function parseArgs(argv) {
  const options = {
    json: false,
    outDir: undefined,
    recipePath: undefined,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--out") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--out requires a directory");
      }
      options.outDir = argv[index];
    } else if (arg === "--help" || arg === "-h") {
      return { help: true };
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.recipePath) {
      options.recipePath = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
    }
  }
  return options;
}

export async function runRecipe(recipePath, options = {}) {
  const absoluteRecipePath = resolve(recipePath);
  const recipe = await loadRecipe(absoluteRecipePath);
  const recipeDir = dirname(absoluteRecipePath);
  const template = recipe.template
    ? await loadSunsynthTemplate(resolveRecipePath(recipe.template, recipeDir))
    : undefined;
  const outputs = [];
  for (const variant of recipe.variants) {
    outputs.push(await generateVariant(template, recipe, variant, options));
  }
  return outputs;
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
  if (!options.recipePath) {
    usage();
    process.exitCode = 1;
    return;
  }

  try {
    const outputs = await runRecipe(options.recipePath, options);
    for (const output of outputs) {
      console.log(basename(output));
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  await main(process.argv.slice(2));
}

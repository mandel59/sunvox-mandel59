#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadRecipe, variantFileName } from "./sunsynth-generate.mjs";

function usage() {
  console.error(`Usage:
  node tools/sunvox-edit-recipe-migrate.mjs [--out <recipe.mjs>] <legacy-sunsynth-recipe.mjs>

Migrates supported template-free SunSynthRecipe files to SunVox Edit Recipe.
Unsupported imperative calls fail fast so the generated recipe stays reviewable.`);
}

function slugIdentifier(value, fallback = "output") {
  const words = String(value || fallback)
    .replace(/\.[^.]+$/u, "")
    .split(/[^A-Za-z0-9]+/u)
    .filter(Boolean);
  if (!words.length) {
    return fallback;
  }
  const identifier = words
    .map((word, index) => {
      const normalized = word.replace(/^[0-9]+/u, "");
      if (!normalized) {
        return "";
      }
      return index === 0
        ? normalized[0].toLowerCase() + normalized.slice(1)
        : normalized[0].toUpperCase() + normalized.slice(1);
    })
    .join("");
  return identifier || fallback;
}

function stableModuleId(name, fallback) {
  return slugIdentifier(name, fallback);
}

function stableOutputId(recipe, variant, index) {
  return slugIdentifier(variant.name ?? variantFileName(variant) ?? recipe.name, `output${index + 1}`);
}

function inspectSelector(selector) {
  if (selector && typeof selector === "object" && "id" in selector) {
    return selector.id;
  }
  return selector;
}

class LegacyModuleRecorder {
  constructor(parent, selector) {
    this.parent = parent;
    this.selector = selector;
  }

  set() {
    throw new Error("module(...).set(...) is not supported by the scratch recipe migrator yet");
  }

  get() {
    throw new Error("module(...).get(...) is not supported by the scratch recipe migrator yet");
  }

  rename() {
    throw new Error("module(...).rename(...) is not supported by the scratch recipe migrator yet");
  }
}

class LegacyRecipeRecorder {
  constructor() {
    this.operations = [];
    this.moduleIdsByName = new Map([["Output", "output"]]);
    this.moduleOrdinal = 0;
  }

  setOutput(nameOrOptions = "Output", options = {}) {
    const normalized =
      nameOrOptions && typeof nameOrOptions === "object"
        ? nameOrOptions
        : { ...options, ...(nameOrOptions !== undefined ? { name: nameOrOptions } : {}) };
    this.operations.push({ op: "setOutput", options: normalized });
    return this;
  }

  setInputModule(selector) {
    this.operations.push({ op: "setInputModule", selector: inspectSelector(selector) });
    return this;
  }

  addModule(type, options = {}) {
    const id = options.id ?? stableModuleId(options.name ?? type, `module${this.moduleOrdinal + 1}`);
    this.moduleOrdinal += 1;
    const normalized = { ...options, id };
    this.operations.push({ op: "addModule", type, options: normalized });
    if (options.name) {
      this.moduleIdsByName.set(options.name, id);
    }
    return this;
  }

  connect(from, to, options = {}) {
    this.operations.push({ op: "connect", from: inspectSelector(from), to: inspectSelector(to), options });
    return this;
  }

  exposeController(label, module, controller, options = {}) {
    this.operations.push({
      op: "exposeController",
      label,
      module: inspectSelector(module),
      controller,
      options,
    });
    return this;
  }

  module(selector) {
    return new LegacyModuleRecorder(this, selector);
  }

  setRootController() {
    throw new Error("setRootController(...) is not supported by the scratch recipe migrator yet");
  }

  setRootControllers() {
    throw new Error("setRootControllers(...) is not supported by the scratch recipe migrator yet");
  }

  setModuleControllers() {
    throw new Error("setModuleControllers(...) is not supported by the scratch recipe migrator yet");
  }

  setModulesByType() {
    throw new Error("setModulesByType(...) is not supported by the scratch recipe migrator yet");
  }

  userController() {
    throw new Error("userController(...) is not supported by the scratch recipe migrator yet");
  }
}

function recipeCreateSpec(recipe, variant) {
  const create = variant.create ?? recipe.create ?? { name: variant.name ?? recipe.name };
  if (create && typeof create === "object" && create.moduleType) {
    const { moduleType, ...moduleOptions } = create;
    return { kind: "rootModule", moduleType, name: variant.name ?? recipe.name, ...moduleOptions };
  }
  if (create === true) {
    return { kind: "metaModule", name: variant.name ?? recipe.name };
  }
  if (typeof create === "string") {
    return { kind: "metaModule", name: create };
  }
  return { kind: "metaModule", name: variant.name ?? recipe.name, ...(create ?? {}) };
}

function outputFile(recipe, variant) {
  return join(recipe.outDir ?? "var/synth-lab", variantFileName(variant)).replaceAll("\\", "/");
}

async function recordedOperations(variant) {
  if (typeof variant.apply !== "function") {
    return [];
  }
  const recorder = new LegacyRecipeRecorder();
  await variant.apply(recorder, {});
  return recorder.operations;
}

function js(value) {
  return JSON.stringify(value, null, 2).replace(/\n/gu, "\n        ");
}

function selectorExpression(selector) {
  if (selector === "Output") {
    return "project.output";
  }
  if (typeof selector === "string") {
    return JSON.stringify({ id: stableModuleId(selector, selector) });
  }
  return js(selector);
}

function operationSource(operation) {
  if (operation.op === "setOutput") {
    return `project.setOutput(${js(operation.options)});`;
  }
  if (operation.op === "addModule") {
    return `project.addModule(${JSON.stringify(operation.type)}, ${js(operation.options)});`;
  }
  if (operation.op === "setInputModule") {
    return `synth.setInputModule(${selectorExpression(operation.selector)});`;
  }
  if (operation.op === "connect") {
    const options = Object.keys(operation.options ?? {}).length ? `, ${js(operation.options)}` : "";
    return `project.connect(${selectorExpression(operation.from)}, ${selectorExpression(operation.to)}${options});`;
  }
  if (operation.op === "exposeController") {
    const options = Object.keys(operation.options ?? {}).length ? `, ${js(operation.options)}` : "";
    return `synth.expose(${JSON.stringify(operation.label)}, ${selectorExpression(operation.module)}, ${JSON.stringify(operation.controller)}${options});`;
  }
  throw new Error(`Unsupported recorded operation: ${operation.op}`);
}

async function outputSpecSource(recipe, variant, index) {
  const operations = await recordedOperations(variant);
  const lines = operations.map((operation) => `        ${operationSource(operation)}`);
  const applySource = lines.length
    ? `,
      apply(synth) {
        const project = synth.embeddedProject();
${lines.join("\n")}
      }`
    : "";
  return `    ${stableOutputId(recipe, variant, index)}: {
      kind: "sunsynth",
      file: ${JSON.stringify(outputFile(recipe, variant))},
      create: ${js(recipeCreateSpec(recipe, variant))}${applySource}
    }`;
}

export async function migrateSunSynthRecipe(inputPath, options = {}) {
  const absoluteInput = resolve(inputPath);
  const recipe = await loadRecipe(absoluteInput);
  if (recipe.template) {
    throw new Error("Template-based SunSynthRecipe migration is not supported yet");
  }
  const outputSpecs = [];
  for (const [index, variant] of recipe.variants.entries()) {
    if (typeof variant === "function") {
      throw new Error("Function variants are not supported by the scratch recipe migrator yet");
    }
    outputSpecs.push(await outputSpecSource(recipe, variant, index));
  }
  const outputPath = resolve(options.out ?? `${absoluteInput.replace(/\.mjs$/u, "")}.edit-recipe.mjs`);
  const typePath = relative(dirname(outputPath), resolve("tools/sunvox-edit-recipe.d.ts")).replaceAll("\\", "/");
  const source = `// @ts-check

/** @satisfies {import("${typePath.startsWith(".") ? typePath : `./${typePath}`}").SunVoxEditRecipe} */
const recipe = {
  schemaVersion: 1,
  outputs: {
${outputSpecs.join(",\n")}
  },
};

export default recipe;
`;
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, source, "utf8");
  return outputPath;
}

function parseArgs(argv) {
  const options = { input: undefined, out: undefined, help: false };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--out") {
      index += 1;
      if (!argv[index]) {
        throw new Error("--out requires a file path");
      }
      options.out = argv[index];
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg.startsWith("-")) {
      throw new Error(`Unknown option: ${arg}`);
    } else if (!options.input) {
      options.input = arg;
    } else {
      throw new Error(`Unexpected argument: ${arg}`);
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
  if (!options.input) {
    usage();
    process.exitCode = 1;
    return;
  }
  try {
    const output = await migrateSunSynthRecipe(options.input, options);
    console.log(basename(output));
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  await main(process.argv.slice(2));
}

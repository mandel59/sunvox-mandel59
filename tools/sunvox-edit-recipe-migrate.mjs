#!/usr/bin/env node
import { mkdir, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { loadRecipe, variantFileName } from "./sunsynth-generate.mjs";
import { SunSynthLab } from "./sunsynth-lab.mjs";

function usage() {
  console.error(`Usage:
  node tools/sunvox-edit-recipe-migrate.mjs [--out <recipe.mjs>] <legacy-sunsynth-recipe.mjs>

Migrates supported SunSynthRecipe files to SunVox Edit Recipe.
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

function stableIdentifier(name, fallback) {
  return slugIdentifier(name, fallback);
}

function stableOutputId(recipe, variant, index) {
  return slugIdentifier(variant.name ?? variantFileName(variant) ?? recipe.name, `output${index + 1}`);
}

function inspectSelector(selector) {
  return selector;
}

class LegacyModuleRecorder {
  constructor(parent, selector) {
    this.parent = parent;
    this.selector = selector;
  }

  set(controllers) {
    this.parent.setModuleControllers(this.selector, controllers);
    return this.parent;
  }

  get() {
    throw new Error("module(...).get(...) is not supported by the scratch recipe migrator yet");
  }

  rename() {
    throw new Error("module(...).rename(...) is not supported by the scratch recipe migrator yet");
  }
}

class LegacyUserControllerRecorder {
  constructor(parent, selector) {
    this.parent = parent;
    this.selector = selector;
  }

  set(valueOrPatch) {
    this.parent.setUserController(this.selector, valueOrPatch);
    return this.parent;
  }

  get() {
    throw new Error("userController(...).get(...) is not supported by the recipe migrator yet");
  }
}

class LegacyRecipeRecorder {
  constructor(templateLab) {
    this.templateLab = templateLab;
    this.operations = [];
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
    const variable = stableIdentifier(options.name ?? type, `module${this.moduleOrdinal + 1}`);
    this.moduleOrdinal += 1;
    this.operations.push({ op: "addModule", type, variable, options: { ...options } });
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

  setRootController(path, value) {
    this.operations.push({ op: "setRootControllers", controllers: { [path]: value } });
    return this;
  }

  setRootControllers(controllers) {
    this.operations.push({ op: "setRootControllers", controllers });
    return this;
  }

  setModuleControllers(selector, controllers) {
    this.operations.push({ op: "setModuleControllers", selector: inspectSelector(selector), controllers });
    return this;
  }

  setModulesByType(type, updater) {
    if (!this.templateLab) {
      throw new Error("setModulesByType(...) migration requires a template SunSynth");
    }
    for (const [ordinal, match] of this.templateLab.findModules({ type }).entries()) {
      const result = updater(match.module, match.index, ordinal);
      if (result && typeof result === "object") {
        this.setModuleControllers({ index: match.index }, result);
      }
    }
    return this;
  }

  userController(selector) {
    return new LegacyUserControllerRecorder(this, selector);
  }

  setUserController(selector, valueOrPatch) {
    this.operations.push({ op: "setUserController", selector, valueOrPatch });
    return this;
  }
}

function recipeCreateSpec(recipe, variant) {
  const create = variant.create ?? recipe.create ?? { name: variant.name ?? recipe.name };
  if (create && typeof create === "object" && create.moduleType) {
    const { moduleType, ...moduleOptions } = create;
    return { module: moduleType, name: variant.name ?? recipe.name, ...moduleOptions };
  }
  if (create === true) {
    return { module: "MetaModule", name: variant.name ?? recipe.name };
  }
  if (typeof create === "string") {
    return { module: "MetaModule", name: create };
  }
  return { module: "MetaModule", name: variant.name ?? recipe.name, ...(create ?? {}) };
}

function outputFile(recipe, variant) {
  return join(recipe.outDir ?? "var/synth-lab", variantFileName(variant)).replaceAll("\\", "/");
}

function legacyTemplatePath(template, recipeDir) {
  if (!template) {
    return undefined;
  }
  return resolve(template.startsWith(".") ? resolve(recipeDir, template) : template);
}

async function loadTemplateLab(recipe, recipeDir) {
  const templatePath = legacyTemplatePath(recipe.template, recipeDir);
  return templatePath ? SunSynthLab.fromFile(templatePath) : undefined;
}

function relativeRecipePath(fromPath, toPath) {
  const relativePath = relative(dirname(fromPath), toPath).replaceAll("\\", "/");
  return relativePath.startsWith(".") ? relativePath : `./${relativePath}`;
}

async function recordedOperations(variant, templateLab) {
  if (typeof variant.apply !== "function") {
    return [];
  }
  const recorder = new LegacyRecipeRecorder(templateLab);
  await variant.apply(recorder, {});
  return recorder.operations;
}

function js(value) {
  return JSON.stringify(value, null, 2).replace(/\n/gu, "\n        ");
}

function uniqueIdentifier(base, used) {
  let candidate = base;
  let suffix = 2;
  while (used.has(candidate)) {
    candidate = `${base}${suffix}`;
    suffix += 1;
  }
  used.add(candidate);
  return candidate;
}

function selectorVariables(operations) {
  const used = new Set(["project", "synth"]);
  const variables = new Map([["Output", "project.output"]]);
  for (const operation of operations) {
    if (operation.op !== "addModule") {
      continue;
    }
    operation.variable = uniqueIdentifier(operation.variable, used);
    if (operation.options.name) {
      variables.set(operation.options.name, operation.variable);
    }
  }
  return variables;
}

function selectorExpression(selector, context = {}) {
  if (selector === "Output") {
    return "project.output";
  }
  if (typeof selector === "string") {
    return context.selectorVariables?.get(selector) ?? JSON.stringify(selector);
  }
  return js(selector);
}

function operationSource(operation, context = {}) {
  if (operation.op === "renameRoot") {
    return `synth.rootModule.rename(${JSON.stringify(operation.name)});`;
  }
  if (operation.op === "setOutput") {
    return `project.setOutput(${js(operation.options)});`;
  }
  if (operation.op === "setRootControllers") {
    return `synth.rootModule.controllers.set(${js(operation.controllers)});`;
  }
  if (operation.op === "addModule") {
    return `const ${operation.variable} = project.addModule(${JSON.stringify(operation.type)}, ${js(operation.options)});`;
  }
  if (operation.op === "setModuleControllers") {
    return `project.findModule(${selectorExpression(operation.selector, context)}).controllers.set(${js(operation.controllers)});`;
  }
  if (operation.op === "setUserController") {
    return `synth.userController(${JSON.stringify(operation.selector)}).set(${js(operation.valueOrPatch)});`;
  }
  if (operation.op === "setInputModule") {
    return `synth.setInputModule(${selectorExpression(operation.selector, context)});`;
  }
  if (operation.op === "connect") {
    const options = Object.keys(operation.options ?? {}).length ? `, ${js(operation.options)}` : "";
    return `project.connect(${selectorExpression(operation.from, context)}, ${selectorExpression(operation.to, context)}${options});`;
  }
  if (operation.op === "exposeController") {
    const options = Object.keys(operation.options ?? {}).length ? `, ${js(operation.options)}` : "";
    return `synth.expose(${JSON.stringify(operation.label)}, ${selectorExpression(operation.module, context)}, ${JSON.stringify(operation.controller)}${options});`;
  }
  throw new Error(`Unsupported recorded operation: ${operation.op}`);
}

async function outputSpecSource(recipe, variant, index, context) {
  const operations = [
    ...(recipe.template && variant.name ? [{ op: "renameRoot", name: variant.name }] : []),
    ...(variant.rootControllers ? [{ op: "setRootControllers", controllers: variant.rootControllers }] : []),
    ...(variant.modules ?? []).map((edit) => ({
      op: "setModuleControllers",
      selector: inspectSelector(edit.selector),
      controllers: edit.controllers ?? {},
    })),
    ...(variant.userControllers ?? []).map((edit) => ({
      op: "setUserController",
      selector: edit.index,
      valueOrPatch: edit,
    })),
    ...await recordedOperations(variant, context.templateLab),
  ];
  const sourceContext = recipe.template ? {} : { selectorVariables: selectorVariables(operations) };
  const lines = operations.map((operation) => `        ${operationSource(operation, sourceContext)}`);
  const applySource = lines.length
    ? `,
      apply(synth) {
        const project = synth.embeddedProject();
${lines.join("\n")}
      }`
    : "";
  const sourceSpec = recipe.template
    ? `from: "template"`
    : `create: ${js(recipeCreateSpec(recipe, variant))}`;
  return `    ${stableOutputId(recipe, variant, index)}: {
      kind: "sunsynth",
      file: ${JSON.stringify(outputFile(recipe, variant))},
      ${sourceSpec}${applySource}
    }`;
}

export async function migrateSunSynthRecipe(inputPath, options = {}) {
  const absoluteInput = resolve(inputPath);
  const recipe = await loadRecipe(absoluteInput);
  const recipeDir = dirname(absoluteInput);
  const templatePath = legacyTemplatePath(recipe.template, recipeDir);
  const templateLab = await loadTemplateLab(recipe, recipeDir);
  const outputSpecs = [];
  for (const [index, variant] of recipe.variants.entries()) {
    if (typeof variant === "function") {
      throw new Error("Function variants are not supported by the scratch recipe migrator yet");
    }
    outputSpecs.push(await outputSpecSource(recipe, variant, index, { templateLab }));
  }
  const outputPath = resolve(options.out ?? `${absoluteInput.replace(/\.mjs$/u, "")}.edit-recipe.mjs`);
  const typePath = relative(dirname(outputPath), resolve("tools/sunvox-edit-recipe.d.ts")).replaceAll("\\", "/");
  const inputsSource = templatePath
    ? `  inputs: {
    template: { kind: "sunsynth", path: ${JSON.stringify(relativeRecipePath(outputPath, templatePath))} },
  },
`
    : "";
  const source = `// @ts-check

/** @satisfies {import("${typePath.startsWith(".") ? typePath : `./${typePath}`}").SunVoxEditRecipe} */
const recipe = {
  schemaVersion: 1,
${inputsSource}  outputs: {
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

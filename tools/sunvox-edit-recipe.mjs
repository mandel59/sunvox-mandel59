#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { basename, dirname, isAbsolute, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { SunSynthLab } from "./sunsynth-lab.mjs";

function usage() {
  console.error(`Usage:
  node tools/sunvox-edit-recipe.mjs [--out <directory>] <recipe.mjs>

SunVox Edit Recipe files export a plain object annotated with
tools/sunvox-edit-recipe.d.ts. The MVP runner supports sunsynth outputs.`);
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function normalizeRecipe(value) {
  if (!isPlainObject(value)) {
    throw new Error("SunVox Edit Recipe must be an object");
  }
  if (value.schemaVersion !== 1) {
    throw new Error(`Unsupported SunVox Edit Recipe schemaVersion: ${JSON.stringify(value.schemaVersion)}`);
  }
  if (!isPlainObject(value.outputs) || !Object.keys(value.outputs).length) {
    throw new Error("SunVox Edit Recipe must include at least one output");
  }
  return value;
}

function resolveRecipePath(value, recipeDir) {
  if (!value || isAbsolute(value)) {
    return value;
  }
  return resolve(recipeDir, value);
}

export async function loadEditRecipe(recipePath) {
  const module = await import(pathToFileURL(recipePath));
  return normalizeRecipe(module.default ?? module.recipe);
}

class ControllerCollectionEditor {
  constructor(getter, setter) {
    this.getter = getter;
    this.setter = setter;
  }

  set(controllers) {
    this.setter(controllers);
  }

  get(path) {
    return path.split(".").reduce((value, key) => value?.[key], this.getter());
  }
}

class RootModuleEditor {
  constructor(lab) {
    this.lab = lab;
    this.controllers = new ControllerCollectionEditor(
      () => this.lab.document.module.controllers ?? {},
      (controllers) => this.lab.setRootControllers(controllers),
    );
  }

  get index() {
    return 0;
  }

  get name() {
    return this.lab.document.module.name;
  }

  get type() {
    return this.lab.document.module.type;
  }

  rename(name) {
    this.lab.rename(name);
  }
}

class UserControllerEditor {
  constructor(lab, selector) {
    this.lab = lab;
    this.selector = selector;
  }

  set(valueOrPatch) {
    this.lab.setUserController(this.selector, valueOrPatch);
  }

  get(path = "value") {
    return this.lab.userController(this.selector).get(path);
  }
}

class ModuleEditor {
  constructor(project, selector) {
    this.project = project;
    this.selector = selector;
    this.controllers = new ControllerCollectionEditor(
      () => this.match().module.controllers ?? {},
      (controllers) => this.project.lab.setModuleControllers(this.index, controllers),
    );
  }

  match() {
    return this.project.lab.findModule(this.selector);
  }

  get index() {
    return this.match().index;
  }

  get name() {
    return this.match().module.name;
  }

  get type() {
    return this.match().module.type;
  }

  rename(name) {
    this.match().module.name = name;
  }
}

class SunVoxProjectEditor {
  constructor(lab, inputs, params) {
    this.lab = lab;
    this.inputs = inputs;
    this.params = params;
  }

  get output() {
    return new ModuleEditor(this, 0);
  }

  setOutput(options = {}) {
    this.lab.setOutput(options);
    return this.output;
  }

  addModule(type, options = {}) {
    const index = this.lab.modules().length;
    this.lab.addModule(type, options);
    return new ModuleEditor(this, index);
  }

  findModule(selector) {
    if (selector instanceof ModuleEditor) {
      return selector;
    }
    return new ModuleEditor(this, selector);
  }

  connect(from, to, options = {}) {
    this.lab.connect(this.findModule(from).index, this.findModule(to).index, options);
  }

  disconnect(from, to, options = {}) {
    const fromEditor = this.findModule(from);
    const toEditor = this.findModule(to);
    const fromModule = fromEditor.match().module;
    const toModule = toEditor.match().module;
    const matches = (link, moduleIndex) =>
      link.module === moduleIndex &&
      (options.slot === undefined || link.slot === options.slot) &&
      (options.peerSlot === undefined || link.peerSlot === options.peerSlot);
    const beforeInputs = toModule.inputs?.length ?? 0;
    const beforeOutputs = fromModule.outputs?.length ?? 0;
    toModule.inputs = (toModule.inputs ?? []).filter((link) => !matches(link, fromEditor.index));
    fromModule.outputs = (fromModule.outputs ?? []).filter((link) => !matches(link, toEditor.index));
    if (!toModule.inputs.length) {
      delete toModule.inputs;
    }
    if (!fromModule.outputs.length) {
      delete fromModule.outputs;
    }
    return beforeInputs - (toModule.inputs?.length ?? 0) + beforeOutputs - (fromModule.outputs?.length ?? 0);
  }

  removeModule(selector, options = {}) {
    const mode = options.mode ?? "leaveHole";
    if (mode !== "leaveHole") {
      throw new Error(`Unsupported removeModule mode: ${JSON.stringify(mode)}`);
    }
    const editor = this.findModule(selector);
    const index = editor.index;
    if (index === 0) {
      throw new Error("Cannot remove the default Output module");
    }
    for (const module of this.lab.modules()) {
      if (!module) {
        continue;
      }
      module.inputs = (module.inputs ?? []).filter((link) => link.module !== index);
      module.outputs = (module.outputs ?? []).filter((link) => link.module !== index);
      if (!module.inputs.length) {
        delete module.inputs;
      }
      if (!module.outputs.length) {
        delete module.outputs;
      }
    }
    this.lab.modules()[index] = {};
    return index;
  }
}

class SunSynthEditor {
  constructor(lab, inputs, params) {
    this.lab = lab;
    this.inputs = inputs;
    this.params = params;
    this.rootModule = new RootModuleEditor(lab);
    this.projectEditor = undefined;
  }

  embeddedProject() {
    if (!this.lab.embeddedProject()) {
      throw new Error("SunSynth root module has no embedded project");
    }
    this.projectEditor ??= new SunVoxProjectEditor(this.lab, this.inputs, this.params);
    return this.projectEditor;
  }

  setInputModule(module) {
    const project = this.embeddedProject();
    const editor = project.findModule(module);
    this.lab.setRootController("inputModule", editor.index);
    this.lab.embeddedProject().project.lastSelectedGenerator = editor.index;
    return editor;
  }

  expose(label, module, controller, options = {}) {
    const project = this.embeddedProject();
    this.lab.exposeController(label, project.findModule(module).index, controller, options);
  }

  userController(selector) {
    return new UserControllerEditor(this.lab, selector);
  }
}

async function loadInputAssets(recipe, recipeDir) {
  const assets = {};
  for (const [id, input] of Object.entries(recipe.inputs ?? {})) {
    const path = resolveRecipePath(input.path, recipeDir);
    if (input.kind === "sunsynth") {
      assets[id] = { ...input, path, lab: await SunSynthLab.fromFile(path) };
    } else if (input.kind === "sunvox") {
      assets[id] = { ...input, path };
    } else {
      throw new Error(`Unsupported input kind for ${id}: ${JSON.stringify(input.kind)}`);
    }
  }
  return assets;
}

function createSunSynthLab(outputId, output, inputs) {
  if (output.from) {
    const input = inputs[output.from];
    if (!input) {
      throw new Error(`Output ${outputId} references unknown input: ${JSON.stringify(output.from)}`);
    }
    if (input.kind !== "sunsynth" || !input.lab) {
      throw new Error(`Output ${outputId} can only create a sunsynth from a sunsynth input in the MVP`);
    }
    return input.lab.clone();
  }

  const create = output.create ?? { module: "MetaModule", name: outputId };
  if (!isPlainObject(create)) {
    throw new Error(`Output ${outputId} create must be an object`);
  }

  const options = { ...create };
  const moduleType = options.module ?? "MetaModule";
  const name = options.name ?? outputId;
  delete options.module;
  delete options.name;
  return moduleType === "MetaModule"
    ? SunSynthLab.create(name, options)
    : SunSynthLab.createModule(moduleType, { ...options, name });
}

async function runSunSynthOutput(outputId, output, inputs, options) {
  const lab = createSunSynthLab(outputId, output, inputs);
  const editor = new SunSynthEditor(lab, inputs, output.params ?? {});
  if (typeof output.apply === "function") {
    await output.apply(editor);
  }
  const outputPath = resolve(options.outDir ?? ".", output.file);
  await mkdir(dirname(outputPath), { recursive: true });
  await lab.writeSunsynth(outputPath);
  return outputPath;
}

export async function runEditRecipe(recipePath, options = {}) {
  const absoluteRecipePath = resolve(recipePath);
  const recipeDir = dirname(absoluteRecipePath);
  const recipe = await loadEditRecipe(absoluteRecipePath);
  const inputs = await loadInputAssets(recipe, recipeDir);
  const outputs = [];
  for (const [outputId, output] of Object.entries(recipe.outputs)) {
    if (output.kind === "sunsynth") {
      outputs.push(await runSunSynthOutput(outputId, output, inputs, options));
    } else if (output.kind === "sunvox") {
      throw new Error("sunvox outputs are not supported by the SunVox Edit Recipe MVP runner yet");
    } else {
      throw new Error(`Unsupported output kind for ${outputId}: ${JSON.stringify(output.kind)}`);
    }
  }
  return outputs;
}

function parseArgs(argv) {
  const options = { outDir: undefined, recipePath: undefined };
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
    } else if (!options.recipePath) {
      options.recipePath = arg;
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
  if (!options.recipePath) {
    usage();
    process.exitCode = 1;
    return;
  }

  try {
    const outputs = await runEditRecipe(options.recipePath, options);
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

#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

import { buildContainer, parseContainer, SUNVOX_DB, TEXT_FORMAT } from "./sunvox-codec.mjs";

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function getPath(object, path) {
  return path.split(".").reduce((current, key) => current?.[key], object);
}

function setPath(object, path, value) {
  const keys = path.split(".");
  let target = object;
  for (const key of keys.slice(0, -1)) {
    target[key] ??= {};
    target = target[key];
  }
  target[keys.at(-1)] = value;
}

function moduleDefinition(type) {
  const definition = SUNVOX_DB.modules[type];
  if (!definition) {
    throw new Error(`Unknown SunVox module type: ${JSON.stringify(type)}`);
  }
  return definition;
}

function controllerPath(controller) {
  return controller.path ?? controller.name;
}

function enumName(enumName, value) {
  return SUNVOX_DB.enums[enumName]?.[String(value)] ?? value;
}

function controllerDefaultValue(controller) {
  if (controller.default === undefined || Array.isArray(controller.default)) {
    return undefined;
  }
  const value = cloneJson(controller.default);
  return controller.type === "enum" ? enumName(controller.enum, value) : value;
}

function defaultControllers(type) {
  const controllers = {};
  for (const controller of moduleDefinition(type).controllers ?? []) {
    const value = controllerDefaultValue(controller);
    if (value !== undefined) {
      setPath(controllers, controllerPath(controller), value);
    }
  }
  return controllers;
}

function flagsObject(flags) {
  return Object.fromEntries(flags.map((flag) => [flag, true]));
}

function moduleDisplayName(module, index) {
  return `#${index} ${module?.name ?? "(unnamed)"} [${module?.type ?? "module"}]`;
}

function normalizeSelector(selector) {
  if (typeof selector === "number") {
    return { index: selector };
  }
  if (typeof selector === "string") {
    const indexMatch = /^#?(\d+)$/u.exec(selector);
    if (indexMatch) {
      return { index: Number(indexMatch[1]) };
    }
    return { nameOrType: selector };
  }
  if (selector && typeof selector === "object") {
    return selector;
  }
  throw new Error(`Unsupported module selector: ${JSON.stringify(selector)}`);
}

function moduleMatches(module, index, selector) {
  const normalized = normalizeSelector(selector);
  let checked = false;
  if (normalized.index !== undefined) {
    checked = true;
    if (index !== normalized.index) {
      return false;
    }
  }
  if (normalized.name !== undefined && module?.name !== normalized.name) {
    checked = true;
    return false;
  }
  if (normalized.name !== undefined) {
    checked = true;
  }
  if (normalized.type !== undefined) {
    checked = true;
    if (module?.type !== normalized.type) {
      return false;
    }
  }
  if (normalized.nameOrType !== undefined) {
    checked = true;
    if (module?.name !== normalized.nameOrType && module?.type !== normalized.nameOrType) {
      return false;
    }
  }
  if (typeof normalized.match === "function") {
    checked = true;
    if (!normalized.match(module, index)) {
      return false;
    }
  }
  return checked;
}

function controllerUserNames(module) {
  return module?.dataChunks?.filter((chunk) => chunk.name === "userControllerName") ?? [];
}

function normalizeControllerPatch(valueOrPatch) {
  if (valueOrPatch && typeof valueOrPatch === "object" && !Array.isArray(valueOrPatch)) {
    return valueOrPatch;
  }
  return { value: valueOrPatch };
}

function userControllerLabel(controller) {
  return controller?._label ?? `user#${controller?.index}`;
}

function nextLinkSlot(links) {
  return links?.length ? Math.max(...links.map((link) => link.slot ?? 0)) + 1 : 0;
}

function normalizeNameOptions(nameOrOptions, options) {
  if (nameOrOptions && typeof nameOrOptions === "object") {
    return nameOrOptions;
  }
  return { ...options, ...(nameOrOptions !== undefined ? { name: nameOrOptions } : {}) };
}

function defaultPosition(index, role) {
  const y = 512;
  if (role === "input") {
    return { x: 0, y, z: 0 };
  }
  if (role === "output") {
    return { x: 512, y, z: 0 };
  }
  return { x: 192 + Math.max(0, index - 2) * 128, y, z: 0 };
}

function moduleBaseFields(index, options = {}, role = "module") {
  return {
    flags: { exists: true, initialized: true, ...(options.flags ?? {}) },
    name: options.name,
    finetune: options.finetune ?? 0,
    relativeNote: options.relativeNote ?? 0,
    position: options.position ?? defaultPosition(index, role),
    scale: options.scale ?? 256,
    visualizerParameters: options.visualizerParameters ?? {},
    color: options.color,
  };
}

function makeOutputModule(index, options = {}) {
  return {
    ...moduleBaseFields(index, { name: "Output", color: "#ffffff", ...options }, "output"),
    flags: { exists: true, output: true, initialized: true, ...(options.flags ?? {}) },
  };
}

function makeTypedModule(index, type, options = {}) {
  const definition = moduleDefinition(type);
  const name = options.name ?? type;
  return {
    ...moduleBaseFields(index, { color: definition.color?.toLowerCase(), ...options, name }),
    type,
    flags: {
      exists: true,
      initialized: true,
      ...flagsObject(definition.flags ?? []),
      ...(options.flags ?? {}),
    },
    controllers: {
      ...defaultControllers(type),
      ...(options.controllers ?? {}),
    },
    ...(options.dataChunks ? { dataChunks: cloneJson(options.dataChunks) } : {}),
  };
}

function makeScratchDocument(name, options = {}) {
  const volume = options.volume ?? 256;
  return {
    format: TEXT_FORMAT,
    magic: "SSYN",
    headerTailHex: "00000000",
    _comments: [],
    preludeChunks: [],
    module: {
      flags: {
        exists: true,
        generator: true,
        initialized: true,
        useMutex: true,
        selected: true,
      },
      name,
      type: "MetaModule",
      controllers: {
        volume,
        inputModule: options.inputModule ?? 1,
        playPatterns: "off",
        bpm: options.bpm ?? 125,
        tpl: options.tpl ?? 6,
      },
      dataChunks: [
        {
          index: 0,
          name: "embeddedProject",
          container: {
            format: TEXT_FORMAT,
            magic: "SVOX",
            headerTailHex: "00000000",
            _comments: [],
            project: {
              version: options.version ?? 33554437,
              baseVersion: options.baseVersion ?? 33554437,
              flags: {},
              syncFlags: {
                midiStartStopContinue: true,
                otherStartStopContinue: true,
              },
              bpm: options.bpm ?? 125,
              speed: options.tpl ?? 6,
              timeline: { grid: 4, grid2: 4 },
              globalVolume: volume,
              name,
              view: {
                moduleScale: 256,
                moduleZoom: 128,
                xOffset: 0,
                yOffset: 0,
              },
              layerMask: 0,
              currentLayer: 0,
              selectedModule: 0,
              lastSelectedGenerator: 1,
              currentPattern: 0,
              currentPatternTrack: 0,
              currentPatternLine: 0,
            },
            patterns: [],
            modules: [],
            trailingChunks: [],
          },
        },
        {
          index: 1,
          name: "controllerLinks",
          count: 96,
          links: [],
        },
        {
          index: 2,
          name: "options",
          options: {
            userControllers: 0,
            arpeggiator: false,
            useVelocity: false,
            eventOutput: true,
            flags: {},
          },
        },
      ],
    },
    trailingChunks: [],
  };
}

function moduleControllerDefinition(module, selector) {
  if (typeof selector === "number") {
    const controller = moduleDefinition(module.type).controllers?.find((item) => item.index === selector);
    if (!controller) {
      throw new Error(`Controller ${selector} does not exist on ${moduleDisplayName(module, "?")}`);
    }
    return controller;
  }
  const controllers = moduleDefinition(module.type).controllers ?? [];
  const matches = controllers.filter(
    (controller) => controller.name === selector || controller.label === selector || controllerPath(controller) === selector,
  );
  if (matches.length !== 1) {
    throw new Error(`Expected one controller for ${JSON.stringify(selector)} on ${module.type}, found ${matches.length}`);
  }
  return matches[0];
}

function rootDataChunk(module, name) {
  const chunk = module.dataChunks?.find((candidate) => candidate.name === name);
  if (!chunk) {
    throw new Error(`Root MetaModule has no ${name} data chunk`);
  }
  return chunk;
}

class ModuleHandle {
  constructor(lab, selector) {
    this.lab = lab;
    this.selector = selector;
  }

  match() {
    return this.lab.findModule(this.selector);
  }

  set(controllers) {
    this.lab.setModuleControllers(this.selector, controllers);
    return this.lab;
  }

  get(path) {
    return getPath(this.match().module.controllers, path);
  }

  rename(name) {
    this.match().module.name = name;
    return this.lab;
  }
}

class UserControllerHandle {
  constructor(lab, selector) {
    this.lab = lab;
    this.selector = selector;
  }

  match() {
    return this.lab.findUserController(this.selector);
  }

  set(valueOrPatch) {
    this.lab.setUserController(this.selector, valueOrPatch);
    return this.lab;
  }

  get(path = "value") {
    return getPath(this.match().controller, path);
  }
}

export class SunSynthLab {
  constructor(document) {
    if (document?.magic !== "SSYN") {
      throw new Error(`Expected an SSYN SunSynth document, got ${JSON.stringify(document?.magic)}`);
    }
    if (!document.module) {
      throw new Error("SunSynth document has no root module");
    }
    this.document = document;
  }

  static async fromFile(filePath) {
    const buffer = await readFile(filePath);
    const document = parseContainer(buffer);
    document._sourceName = filePath.split(/[\\/]/u).at(-1);
    return new SunSynthLab(document);
  }

  static create(name = "Scratch Synth", options = {}) {
    return new SunSynthLab(makeScratchDocument(name, options));
  }

  clone() {
    return new SunSynthLab(cloneJson(this.document));
  }

  rename(name) {
    this.document.module.name = name;
    const embedded = this.embeddedProject();
    if (embedded?.project) {
      embedded.project.name = name;
    }
    return this;
  }

  embeddedProject() {
    return this.document.module.dataChunks?.find((chunk) => chunk.name === "embeddedProject")?.container;
  }

  modules() {
    return this.embeddedProject()?.modules ?? [];
  }

  addOutput(nameOrOptions = "Output", options = {}) {
    const normalized = normalizeNameOptions(nameOrOptions, options);
    const modules = this.modules();
    modules.push(makeOutputModule(modules.length, normalized));
    return this;
  }

  addInput(nameOrOptions = "Input", options = {}) {
    const normalized = normalizeNameOptions(nameOrOptions, options);
    const modules = this.modules();
    const index = modules.length;
    modules.push(
      makeTypedModule(index, "MultiSynth", {
        name: "Input",
        ...normalized,
        position: normalized.position ?? defaultPosition(index, "input"),
      }),
    );
    this.setRootController("inputModule", index);
    this.embeddedProject().project.lastSelectedGenerator = index;
    return this;
  }

  addModule(type, options = {}) {
    const modules = this.modules();
    modules.push(makeTypedModule(modules.length, type, options));
    return this;
  }

  findModules(selector) {
    return this.modules()
      .map((module, index) => ({ module, index }))
      .filter(({ module, index }) => moduleMatches(module, index, selector));
  }

  findModule(selector) {
    const matches = this.findModules(selector);
    if (matches.length !== 1) {
      const description = matches.map(({ module, index }) => moduleDisplayName(module, index)).join(", ");
      throw new Error(`Expected one module for ${JSON.stringify(selector)}, found ${matches.length}${description ? `: ${description}` : ""}`);
    }
    return matches[0];
  }

  module(selector) {
    return new ModuleHandle(this, selector);
  }

  setRootController(path, value) {
    this.document.module.controllers ??= {};
    setPath(this.document.module.controllers, path, value);
    return this;
  }

  setRootControllers(controllers) {
    for (const [path, value] of Object.entries(controllers)) {
      this.setRootController(path, value);
    }
    return this;
  }

  setModuleControllers(selector, controllers) {
    const { module } = this.findModule(selector);
    module.controllers ??= {};
    for (const [path, value] of Object.entries(controllers)) {
      setPath(module.controllers, path, value);
    }
    return this;
  }

  setModulesByType(type, updater) {
    const matches = this.findModules({ type });
    for (const [ordinal, match] of matches.entries()) {
      const result = updater(match.module, match.index, ordinal);
      if (result && typeof result === "object") {
        match.module.controllers ??= {};
        for (const [path, value] of Object.entries(result)) {
          setPath(match.module.controllers, path, value);
        }
      }
    }
    return this;
  }

  connect(fromSelector, toSelector, options = {}) {
    const from = this.findModule(fromSelector);
    const to = this.findModule(toSelector);
    to.module.inputs ??= [];
    const slot = options.slot ?? nextLinkSlot(to.module.inputs);
    const link = { slot, module: from.index };
    if (options.peerSlot !== undefined) {
      link.peerSlot = options.peerSlot;
    }
    to.module.inputs = to.module.inputs.filter((input) => input.slot !== slot);
    to.module.inputs.push(link);
    to.module.inputs.sort((a, b) => a.slot - b.slot);
    return this;
  }

  exposeController(label, moduleSelector, controllerSelector, options = {}) {
    const { module, index: moduleIndex } = this.findModule(moduleSelector);
    if (!module.type) {
      throw new Error(`Cannot expose a controller from an untyped module: ${moduleDisplayName(module, moduleIndex)}`);
    }
    const controller = moduleControllerDefinition(module, controllerSelector);
    const userIndex = options.index ?? (this.document.module.controllers.user?.length ?? 0);
    const value = options.value ?? getPath(module.controllers, controllerPath(controller)) ?? controllerDefaultValue(controller) ?? 0;
    this.document.module.controllers.user ??= [];
    this.setUserController(userIndex, {
      value,
      label,
      ...(options.group !== undefined ? { group: options.group } : {}),
    });

    const links = rootDataChunk(this.document.module, "controllerLinks");
    links.links = [
      ...(links.links ?? []).filter((link) => link.index !== userIndex),
      {
        index: userIndex,
        module: moduleIndex,
        controller: controller.index,
        _moduleName: module.name,
        _moduleType: module.type,
        _controllerName: controllerPath(controller),
        _controllerLabel: controller.label,
      },
    ].sort((a, b) => a.index - b.index);

    const optionsChunk = rootDataChunk(this.document.module, "options");
    optionsChunk.options.userControllers = Math.max(optionsChunk.options.userControllers ?? 0, userIndex + 1);

    const names = this.document.module.dataChunks.filter((chunk) => chunk.name !== "userControllerName" || chunk.controller !== userIndex);
    names.push({
      index: userIndex + 8,
      name: "userControllerName",
      controller: userIndex,
      ...(options.group !== undefined ? { group: options.group } : {}),
      label,
    });
    names.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    this.document.module.dataChunks = names;
    return this;
  }

  userController(selector) {
    return new UserControllerHandle(this, selector);
  }

  findUserController(selector) {
    const controllers = this.document.module.controllers?.user;
    if (!Array.isArray(controllers)) {
      throw new Error("Root MetaModule has no user controllers");
    }
    if (typeof selector === "number") {
      const controller = controllers.find((item) => item.index === selector) ?? controllers[selector];
      if (!controller) {
        throw new Error(`User controller ${selector} does not exist`);
      }
      return { controller, index: controller.index ?? controllers.indexOf(controller) };
    }
    if (typeof selector === "string") {
      const matches = controllers
        .map((controller, ordinal) => ({ controller, index: controller.index ?? ordinal }))
        .filter(({ controller, index }) => userControllerLabel(controller) === selector || `user#${index}` === selector);
      if (matches.length !== 1) {
        const description = matches.map(({ controller, index }) => `user#${index} ${userControllerLabel(controller)}`).join(", ");
        throw new Error(`Expected one user controller for ${JSON.stringify(selector)}, found ${matches.length}${description ? `: ${description}` : ""}`);
      }
      return matches[0];
    }
    throw new Error(`Unsupported user controller selector: ${JSON.stringify(selector)}`);
  }

  setUserController(selector, valueOrPatch) {
    const patch = normalizeControllerPatch(valueOrPatch);
    let match;
    try {
      match = this.findUserController(selector);
    } catch (error) {
      if (typeof selector !== "number") {
        throw error;
      }
      this.document.module.controllers.user ??= [];
      const controller = { index: selector, value: 0 };
      this.document.module.controllers.user.push(controller);
      this.document.module.controllers.user.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      match = { controller, index: selector };
    }
    const { controller, index } = match;
    if (patch.value !== undefined) {
      controller.value = patch.value;
    }
    if (patch.label !== undefined) {
      controller._label = patch.label;
      for (const nameChunk of controllerUserNames(this.document.module).filter((chunk) => chunk.controller === index)) {
        nameChunk.label = patch.label;
      }
    }
    if (patch.group !== undefined) {
      controller._group = patch.group;
      for (const nameChunk of controllerUserNames(this.document.module).filter((chunk) => chunk.controller === index)) {
        nameChunk.group = patch.group;
      }
    }
    return this;
  }

  getModuleController(selector, path) {
    return getPath(this.findModule(selector).module.controllers, path);
  }

  toBuffer() {
    return buildContainer(this.document);
  }

  async writeSunsynth(filePath) {
    await writeFile(filePath, this.toBuffer());
    return this;
  }

  async writeJson(filePath) {
    await writeFile(filePath, `${JSON.stringify(this.document, null, 2)}\n`, "utf8");
    return this;
  }
}

export async function loadSunsynthTemplate(filePath) {
  return SunSynthLab.fromFile(filePath);
}

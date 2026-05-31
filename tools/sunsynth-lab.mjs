#!/usr/bin/env node
import { readFile, writeFile } from "node:fs/promises";

import { buildContainer, parseContainer } from "./sunvox-codec.mjs";

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
    const { controller, index } = this.findUserController(selector);
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

#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { basename, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseContainer } from "./sunvox-codec.mjs";

const DEFAULT_EVENT_LIMIT = 8;

function usage() {
  console.error(`Usage:
  node tools/sunvox-outline.mjs [--json] [--events <count>] [--no-embedded] <input.sunvox|input.sunsynth>`);
}

function flagNames(flags) {
  if (!flags || typeof flags !== "object") {
    return [];
  }
  return Object.entries(flags)
    .filter(([, value]) => value === true)
    .map(([name]) => name);
}

function moduleKind(module) {
  if (module?.type) {
    return module.type;
  }
  if (module?.flags?.output) {
    return "output";
  }
  if (module?.flags?.exists) {
    return "module";
  }
  return "empty";
}

function moduleName(module, fallback = "(unnamed)") {
  return module?.name || fallback;
}

function userControllerSummary(module) {
  const controllers = module?.controllers?.user;
  if (!Array.isArray(controllers)) {
    return [];
  }
  return controllers.map((controller, arrayIndex) => {
    const link = controller?._link;
    return {
      index: Number.isInteger(controller?.index) ? controller.index : arrayIndex,
      ...(controller?._label !== undefined ? { label: controller._label } : {}),
      ...(controller?._group !== undefined ? { group: controller._group } : {}),
      ...(controller?.value !== undefined ? { value: controller.value } : {}),
      ...(link
        ? {
            link: {
              module: link.module,
              controller: link.controller,
              ...(link._moduleName !== undefined ? { _moduleName: link._moduleName } : {}),
              ...(link._moduleType !== undefined ? { _moduleType: link._moduleType } : {}),
              ...(link._controllerName !== undefined ? { _controllerName: link._controllerName } : {}),
              ...(link._controllerLabel !== undefined ? { _controllerLabel: link._controllerLabel } : {}),
            },
          }
        : {}),
    };
  });
}

function moduleSummary(module, index) {
  const dataChunks = module?.dataChunks ?? [];
  return {
    index,
    name: moduleName(module),
    type: module?.type,
    kind: moduleKind(module),
    flags: flagNames(module?.flags),
    position: module?.position,
    color: module?.color,
    inputs: compactModuleLinks(module, "inputs", "inputLinks", "inputLinkSlots"),
    outputs: compactModuleLinks(module, "outputs", "outputLinks", "outputLinkSlots"),
    controllerCount: countControllers(module?.controllers),
    userControllers: userControllerSummary(module),
    dataChunkCount: module?.dataChunkCount ?? dataChunks.length,
    embeddedCount: dataChunks.filter((chunk) => chunk.container).length,
  };
}

function countControllers(controllers) {
  if (Array.isArray(controllers)) {
    return controllers.filter((value) => value !== undefined).length;
  }
  if (!controllers || typeof controllers !== "object") {
    return 0;
  }
  return Object.keys(controllers).filter((key) => key !== "extra").length;
}

function compactLinks(links) {
  return (links ?? []).filter((link) => Number.isInteger(link) && link >= 0);
}

function compactModuleLinks(module, semanticPath, legacyLinksPath, legacySlotsPath) {
  const semanticLinks = module?.[semanticPath];
  if (Array.isArray(semanticLinks)) {
    return semanticLinks
      .filter((link) => Number.isInteger(link?.module) && link.module >= 0)
      .map((link, index) => ({
        slot: Number.isInteger(link.slot) ? link.slot : index,
        module: link.module,
        ...(Number.isInteger(link.peerSlot) ? { peerSlot: link.peerSlot } : {}),
      }));
  }

  const legacyLinks = compactLinks(module?.[legacyLinksPath]);
  const compact = [];
  for (const [index, link] of (module?.[legacyLinksPath] ?? []).entries()) {
    if (Number.isInteger(link) && link >= 0) {
      compact.push({
        slot: index,
        module: link,
        ...(Number.isInteger(module?.[legacySlotsPath]?.[index])
          ? { peerSlot: module[legacySlotsPath][index] }
          : {}),
      });
    }
  }
  return compact.length ? compact : legacyLinks.map((moduleIndex, slot) => ({ slot, module: moduleIndex }));
}

function linkName(modules, index) {
  const module = modules[index];
  return `#${index} ${moduleName(module, moduleKind(module))}`;
}

function addEdges(edges, modules, sourceModule, links, direction, kind) {
  for (const link of links ?? []) {
    const linkedModule = link.module;
    if (!Number.isInteger(linkedModule) || linkedModule < 0) {
      continue;
    }
    const from = direction === "input" ? linkedModule : sourceModule;
    const to = direction === "input" ? sourceModule : linkedModule;
    const fromSlot = direction === "input" ? link.peerSlot : link.slot;
    const toSlot = direction === "input" ? link.slot : link.peerSlot;
    edges.push({
      from,
      to,
      kind,
      ...(Number.isInteger(fromSlot) ? { fromSlot } : {}),
      ...(Number.isInteger(toSlot) ? { toSlot } : {}),
      valid: Boolean(modules[from]) && Boolean(modules[to]) && moduleKind(modules[from]) !== "empty" && moduleKind(modules[to]) !== "empty",
      _fromName: moduleName(modules[from], moduleKind(modules[from])),
      _toName: moduleName(modules[to], moduleKind(modules[to])),
    });
  }
}

function moduleEdges(modules) {
  const edges = [];
  modules.forEach((module, index) => {
    addEdges(edges, modules, index, module.inputs, "input", "input");
    addEdges(edges, modules, index, module.outputs, "output", "output");
  });

  const seen = new Set();
  return edges.filter((edge) => {
    const key = `${edge.from}:${edge.to}:${edge.kind}:${edge.fromSlot ?? ""}:${edge.toSlot ?? ""}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function graphSummary(modules, edges) {
  return {
    modules: modules.length,
    activeModules: modules.filter((module) => moduleKind(module) !== "empty").length,
    edges: edges.length,
    inputEdges: edges.filter((edge) => edge.kind === "input").length,
    outputEdges: edges.filter((edge) => edge.kind === "output").length,
    danglingEdges: edges.filter((edge) => !edge.valid).length,
  };
}

function patternSummary(pattern, index) {
  const events = pattern?.events ?? [];
  return {
    index,
    name: pattern?.name,
    position: pattern?.position,
    tracks: pattern?.tracks,
    lines: pattern?.lines,
    eventColumns: pattern?.eventColumns,
    eventRows: pattern?.eventRows,
    flags: pattern?.flags,
    infoFlags: pattern?.infoFlags,
    parent: pattern?.parent,
    parentId: pattern?.parentId,
    iconBase64: pattern?.iconBase64,
    foreground: pattern?.foreground,
    background: pattern?.background,
    eventCount: events.length,
    events,
  };
}

function embeddedOutlines(module, moduleIndex, options, hostLabel) {
  if (options.embedded === false) {
    return [];
  }
  return (module?.dataChunks ?? [])
    .filter((chunk) => chunk.container)
    .map((chunk) => ({
      hostModule: moduleIndex,
      hostName: moduleName(module, moduleKind(module)),
      hostLabel,
      dataChunkIndex: chunk.index,
      dataChunkName: chunk.name,
      document: buildOutline(chunk.container, {
        ...options,
        sourceName: `${hostLabel} dataChunk#${chunk.index}`,
        embeddedDepth: (options.embeddedDepth ?? 0) + 1,
      }),
    }));
}

export function buildOutline(document, options = {}) {
  const sourceName = options.sourceName ?? document._sourceName ?? basename(options.filePath ?? "SunVox document");
  if (document.magic === "SSYN") {
    const rootModule = moduleSummary(document.module, 0);
    const modules = [rootModule];
    const links = [];
    return {
      sourceName,
      magic: document.magic,
      synth: rootModule,
      modules,
      links,
      graph: graphSummary(modules, links),
      patterns: [],
      embedded: embeddedOutlines(document.module, 0, options, "#0 root"),
    };
  }

  const modules = document.modules ?? [];
  const links = moduleEdges(modules);
  return {
    sourceName,
    magic: document.magic,
    project: {
      name: document.project?.name,
      flags: document.project?.flags,
      bpm: document.project?.bpm,
      speed: document.project?.speed,
      timeline: document.project?.timeline,
      globalVolume: document.project?.globalVolume,
      patternCount: document.patterns?.length ?? 0,
      moduleCount: modules.length,
    },
    modules: modules.map(moduleSummary),
    links,
    graph: graphSummary(modules, links),
    patterns: (document.patterns ?? []).map(patternSummary),
    embedded: modules.flatMap((module, index) => embeddedOutlines(module, index, options, linkName(modules, index))),
  };
}

export async function buildOutlineFromFile(filePath, options = {}) {
  const resolved = resolve(filePath);
  const buffer = await readFile(resolved);
  return buildOutline(parseContainer(buffer), {
    ...options,
    filePath: resolved,
    sourceName: relative(process.cwd(), resolved),
  });
}

function indent(text, level) {
  return `${" ".repeat(level)}${text}`;
}

function formatValue(value) {
  return value === undefined || value === null || value === "" ? "-" : String(value);
}

function formatEventValue(value) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return `{${Object.entries(value)
      .map(([key, fieldValue]) => `${key}=${fieldValue}`)
      .join(",")}}`;
  }
  return formatValue(value);
}

function formatPosition(position) {
  if (!position) {
    return "";
  }
  const values = [position.x, position.y, position.z].filter((value) => value !== undefined);
  return values.length ? ` pos=(${values.join(",")})` : "";
}

function formatLinkList(title, links, modules) {
  if (!links?.length) {
    return "";
  }
  return ` ${title}=[${links
    .map((link) => {
      const slot = Number.isInteger(link.slot) ? ` slot=${link.slot}` : "";
      const peerSlot = Number.isInteger(link.peerSlot) ? ` peerSlot=${link.peerSlot}` : "";
      return `${linkName(modules, link.module)}${slot}${peerSlot}`;
    })
    .join(", ")}]`;
}

function formatModule(module, modules, level) {
  const flags = module.flags.length ? ` flags=${module.flags.join(",")}` : "";
  const links = [
    formatLinkList("in", module.inputs, modules),
    formatLinkList("out", module.outputs, modules),
  ].join("");
  const chunks = module.dataChunkCount ? ` dataChunks=${module.dataChunkCount}` : "";
  const embedded = module.embeddedCount ? ` embedded=${module.embeddedCount}` : "";
  const userControllers = module.userControllers?.length ? ` userControllers=${module.userControllers.length}` : "";
  return indent(
    `#${module.index} ${module.name} [${module.type ?? module.kind}]${formatPosition(module.position)}${flags}${links}${chunks}${embedded}${userControllers}`,
    level,
  );
}

function formatUserController(controller) {
  const label = controller.label ? ` "${controller.label}"` : "";
  const group = controller.group !== undefined ? ` group=${controller.group}` : "";
  const value = controller.value !== undefined ? ` value=${controller.value}` : "";
  const link = controller.link;
  const targetModuleName = link?._moduleName ? ` ${link._moduleName}` : "";
  const targetModuleType = link?._moduleType ? ` [${link._moduleType}]` : "";
  const targetController = link?._controllerName ?? link?.controller;
  const target = link ? ` -> #${link.module}${targetModuleName}${targetModuleType} controller=${targetController}` : "";
  return `user#${controller.index}${label}${group}${value}${target}`;
}

function formatModuleDetails(module, level) {
  const lines = [];
  if (module.userControllers?.length) {
    lines.push(indent("User controllers", level));
    for (const controller of module.userControllers) {
      lines.push(indent(formatUserController(controller), level + 2));
    }
  }
  return lines;
}

function formatEvent(event) {
  const parts = [`L${String(event.line ?? 0).padStart(3, "0")}`, `T${event.track ?? 0}`];
  if (event.note !== undefined) {
    parts.push(`note=${event.note}`);
  }
  if (event.velocity !== undefined) {
    parts.push(`vel=${event.velocity}`);
  }
  if (event.module !== undefined) {
    parts.push(`module=#${event.module}${event._moduleName ? ` ${event._moduleName}` : ""}`);
  }
  if (event.controller !== undefined) {
    parts.push(`controller=${event.controller}`);
  }
  if (event.midiController !== undefined) {
    parts.push(`midiController=${event.midiController}`);
  }
  if (event.effect !== undefined) {
    parts.push(`effect=${event.effect}`);
  }
  const value = event.parameter ?? event.value;
  if (value !== undefined) {
    parts.push(`${event.effect !== undefined ? "parameter" : "value"}=${formatEventValue(value)}`);
  }
  return parts.join(" ");
}

function formatPattern(pattern, level, eventLimit) {
  const header = [
    `#${formatValue(pattern.index)}`,
    pattern.name ? `"${pattern.name}"` : "",
    `lines=${formatValue(pattern.lines)}`,
    `tracks=${formatValue(pattern.tracks)}`,
    `events=${pattern.eventCount}`,
    formatPosition(pattern.position).trim(),
  ]
    .filter(Boolean)
    .join(" ");
  const lines = [indent(header, level)];
  for (const event of pattern.events.slice(0, eventLimit)) {
    lines.push(indent(formatEvent(event), level + 2));
  }
  if (pattern.events.length > eventLimit) {
    lines.push(indent(`... ${pattern.events.length - eventLimit} more events`, level + 2));
  }
  return lines;
}

function formatOutlineNode(outline, options, level = 0) {
  const eventLimit = options.eventLimit ?? DEFAULT_EVENT_LIMIT;
  const lines = [
    indent(`${outline.magic === "SSYN" ? "SunSynth" : "SunVox"} Outline: ${outline.sourceName}`, level),
    indent(`Magic: ${outline.magic}`, level),
  ];

  if (outline.project) {
    lines.push("", indent("Project", level));
    lines.push(indent(`Name: ${formatValue(outline.project.name)}`, level + 2));
    lines.push(indent(`BPM/Speed: ${formatValue(outline.project.bpm)} / ${formatValue(outline.project.speed)}`, level + 2));
    lines.push(indent(`Global volume: ${formatValue(outline.project.globalVolume)}`, level + 2));
    lines.push(indent(`Patterns: ${outline.project.patternCount}`, level + 2));
    lines.push(indent(`Modules: ${outline.project.moduleCount}`, level + 2));
    if (outline.graph) {
      lines.push(indent(`Graph: active=${outline.graph.activeModules} edges=${outline.graph.edges} dangling=${outline.graph.danglingEdges}`, level + 2));
    }
  }

  if (outline.synth) {
    lines.push("", indent("Synth Module", level));
    lines.push(formatModule(outline.synth, outline.modules, level + 2));
    lines.push(...formatModuleDetails(outline.synth, level + 4));
  }

  if (outline.modules?.length && !outline.synth) {
    lines.push("", indent("Modules", level));
    for (const module of outline.modules) {
      lines.push(formatModule(module, outline.modules, level + 2));
      lines.push(...formatModuleDetails(module, level + 4));
    }
  }

  if (outline.links?.length) {
    lines.push("", indent("Links", level));
    for (const edge of outline.links) {
      const slots = [
        Number.isInteger(edge.fromSlot) ? `fromSlot=${edge.fromSlot}` : "",
        Number.isInteger(edge.toSlot) ? `toSlot=${edge.toSlot}` : "",
      ]
        .filter(Boolean)
        .join(" ");
      const slotSuffix = slots ? ` ${slots}` : "";
      const validity = edge.valid === false ? " invalid" : "";
      lines.push(indent(`#${edge.from} ${edge._fromName} -> #${edge.to} ${edge._toName} (${edge.kind}${slotSuffix}${validity})`, level + 2));
    }
  }

  if (outline.patterns?.length) {
    lines.push("", indent("Patterns", level));
    for (const pattern of outline.patterns) {
      lines.push(...formatPattern(pattern, level + 2, eventLimit));
    }
  }

  if (outline.embedded?.length) {
    lines.push("", indent("Embedded Containers", level));
    for (const embedded of outline.embedded) {
      lines.push(
        indent(
          `${embedded.hostLabel}: dataChunk#${embedded.dataChunkIndex} ${embedded.dataChunkName ?? "container"}`,
          level + 2,
        ),
      );
      lines.push(...formatOutlineNode(embedded.document, options, level + 4));
    }
  }

  return lines;
}

export function formatOutline(outline, options = {}) {
  return `${formatOutlineNode(outline, options).join("\n")}\n`;
}

function parseArgs(args) {
  const options = { eventLimit: DEFAULT_EVENT_LIMIT, embedded: true };
  const paths = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else if (arg === "--json") {
      options.json = true;
    } else if (arg === "--no-embedded") {
      options.embedded = false;
    } else if (arg === "--events") {
      options.eventLimit = Number(args[++index]);
    } else if (arg.startsWith("--events=")) {
      options.eventLimit = Number(arg.slice("--events=".length));
    } else {
      paths.push(arg);
    }
  }
  return { options, paths };
}

async function main() {
  const { options, paths } = parseArgs(process.argv.slice(2));
  if (options.help || paths.length !== 1 || !Number.isFinite(options.eventLimit)) {
    usage();
    process.exitCode = options.help ? 0 : 1;
    return;
  }

  const outline = await buildOutlineFromFile(paths[0], options);
  console.log(options.json ? JSON.stringify(outline, null, 2) : formatOutline(outline, options));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

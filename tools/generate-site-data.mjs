#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildOutlineFromFile } from "./sunvox-outline.mjs";

const DEFAULT_ROOTS = ["music", "instruments"];
const DEFAULT_OUTPUT = "site-data/sunvox-projects.json";
const SUNVOX_EXTENSIONS = new Set([".sunvox", ".sunsynth"]);
const EVENT_PREVIEW_LIMIT = 4;

async function findSunVoxFiles(paths) {
  const files = [];
  for (const input of paths) {
    const path = resolve(input);
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      if (SUNVOX_EXTENSIONS.has(extname(path).toLowerCase())) {
        files.push(path);
      }
      continue;
    }
    for (const entry of entries) {
      files.push(...await findSunVoxFiles([join(path, entry.name)]));
    }
  }
  return files.sort((a, b) => a.localeCompare(b, "en"));
}

function fileTitle(path, outline) {
  return outline.project?.name || outline.synth?.name || path.replace(/^.*[\\/]/u, "");
}

function eventSummary(event) {
  return {
    line: event.line,
    track: event.track,
    ...(event.note !== undefined ? { note: event.note } : {}),
    ...(event.velocity !== undefined ? { velocity: event.velocity } : {}),
    ...(event.module !== undefined ? { module: event.module } : {}),
    ...(event._moduleName !== undefined ? { moduleName: event._moduleName } : {}),
    ...(event.controller !== undefined ? { controller: event.controller } : {}),
    ...(event.effect !== undefined ? { effect: event.effect } : {}),
  };
}

function patternSummary(pattern) {
  return {
    index: pattern.index,
    ...(pattern.name ? { name: pattern.name } : {}),
    ...(pattern.position ? { position: pattern.position } : {}),
    ...(pattern.lines !== undefined ? { lines: pattern.lines } : {}),
    ...(pattern.tracks !== undefined ? { tracks: pattern.tracks } : {}),
    eventCount: pattern.eventCount,
    eventPreview: pattern.events.slice(0, EVENT_PREVIEW_LIMIT).map(eventSummary),
  };
}

function moduleSummary(module) {
  return {
    index: module.index,
    name: module.name,
    kind: module.kind,
    ...(module.type ? { type: module.type } : {}),
    ...(module.position ? { position: module.position } : {}),
    ...(module.color ? { color: module.color } : {}),
    flags: module.flags,
    inputCount: module.inputs.length,
    outputCount: module.outputs.length,
    controllerCount: module.controllerCount,
    dataChunkCount: module.dataChunkCount,
    embeddedCount: module.embeddedCount,
  };
}

function linkSummary(link) {
  return {
    from: link.from,
    to: link.to,
    kind: link.kind,
    ...(link.fromSlot !== undefined ? { fromSlot: link.fromSlot } : {}),
    ...(link.toSlot !== undefined ? { toSlot: link.toSlot } : {}),
    fromName: link._fromName,
    toName: link._toName,
    valid: link.valid,
  };
}

function outlineStats(outline) {
  return {
    modules: outline.graph?.modules ?? outline.modules?.length ?? 0,
    activeModules: outline.graph?.activeModules ?? 0,
    links: outline.graph?.edges ?? outline.links?.length ?? 0,
    patterns: outline.patterns?.length ?? 0,
    events: (outline.patterns ?? []).reduce((total, pattern) => total + pattern.eventCount, 0),
    embeddedContainers: outline.embedded?.length ?? 0,
  };
}

function embeddedSummary(embedded) {
  return {
    hostModule: embedded.hostModule,
    hostName: embedded.hostName,
    dataChunkIndex: embedded.dataChunkIndex,
    ...(embedded.dataChunkName ? { dataChunkName: embedded.dataChunkName } : {}),
    document: documentSummary(embedded.document, embedded.document.sourceName),
  };
}

function documentSummary(outline, path) {
  const modules = outline.modules ?? [];
  return {
    path,
    title: fileTitle(path, outline),
    magic: outline.magic,
    type: outline.magic === "SSYN" ? "synth" : "project",
    ...(outline.project ? { project: outline.project } : {}),
    ...(outline.synth ? { synth: moduleSummary(outline.synth) } : {}),
    stats: outlineStats(outline),
    modules: modules.filter((module) => module.kind !== "empty").map(moduleSummary),
    links: (outline.links ?? []).map(linkSummary),
    patterns: (outline.patterns ?? []).map(patternSummary),
    embedded: (outline.embedded ?? []).map(embeddedSummary),
  };
}

export async function collectSiteData(paths = DEFAULT_ROOTS) {
  const files = await findSunVoxFiles(paths);
  const projects = [];
  for (const file of files) {
    const outline = await buildOutlineFromFile(file, { eventLimit: EVENT_PREVIEW_LIMIT });
    const path = relative(process.cwd(), file).replaceAll("\\", "/");
    projects.push(documentSummary(outline, path));
  }
  return {
    schemaVersion: 1,
    sourceRoots: paths,
    projects,
  };
}

export async function writeSiteData(outputPath = DEFAULT_OUTPUT, paths = DEFAULT_ROOTS) {
  const data = await collectSiteData(paths);
  const output = resolve(outputPath);
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, `${JSON.stringify(data, null, 2)}\n`);
  return data;
}

async function main(argv) {
  const outputIndex = argv.indexOf("--output");
  const outputPath = outputIndex === -1 ? DEFAULT_OUTPUT : argv[outputIndex + 1];
  const roots = argv.filter((arg, index) => arg !== "--output" && index !== outputIndex + 1);
  const data = await writeSiteData(outputPath, roots.length ? roots : DEFAULT_ROOTS);
  const bytes = (await readFile(resolve(outputPath))).byteLength;
  console.log(`Generated ${outputPath} with ${data.projects.length} SunVox entries (${bytes} bytes).`);
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

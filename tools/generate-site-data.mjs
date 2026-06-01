#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

import { buildOutlineFromFile } from "./sunvox-outline.mjs";
import { loadEditRecipe } from "./sunvox-edit-recipe.mjs";

const DEFAULT_ROOTS = ["music", "instruments", "generated/music", "generated/instruments"];
const DEFAULT_RECIPE_ROOTS = ["generated/recipes/sunvox-edit"];
const DEFAULT_OUTPUT = "site-data/sunvox-projects.json";
const SUNVOX_EXTENSIONS = new Set([".sunvox", ".sunsynth"]);
const RECIPE_EXTENSIONS = new Set([".mjs"]);
const PATTERN_ICON_SIZE = 16;

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

async function findRecipeFiles(paths) {
  const files = [];
  for (const input of paths) {
    const path = resolve(input);
    let entries;
    try {
      entries = await readdir(path, { withFileTypes: true });
    } catch {
      if (RECIPE_EXTENSIONS.has(extname(path).toLowerCase())) {
        files.push(path);
      }
      continue;
    }
    for (const entry of entries) {
      files.push(...await findRecipeFiles([join(path, entry.name)]));
    }
  }
  return files.sort((a, b) => a.localeCompare(b, "en"));
}

async function collectGeneratedSourceRecipes(paths = DEFAULT_RECIPE_ROOTS) {
  const recipeFiles = await findRecipeFiles(paths);
  const sources = new Map();
  for (const recipeFile of recipeFiles) {
    const recipe = await loadEditRecipe(recipeFile);
    const recipePath = relative(process.cwd(), recipeFile).replaceAll("\\", "/");
    for (const output of Object.values(recipe.outputs)) {
      if (output.kind !== "sunsynth" || extname(output.file).toLowerCase() !== ".sunsynth") {
        continue;
      }
      const generatedPath = `generated/instruments/${basename(output.file)}`;
      sources.set(generatedPath, {
        path: recipePath,
        name: basename(recipePath),
      });
    }
  }
  return sources;
}

function fileTitle(path, outline) {
  return outline.project?.name || outline.synth?.name || path.replace(/^.*[\\/]/u, "");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, "ascii");
  const chunk = Buffer.alloc(8 + data.length + 4);
  chunk.writeUInt32BE(data.length, 0);
  typeBuffer.copy(chunk, 4);
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])), 8 + data.length);
  return chunk;
}

function rgbBytes(color, fallback) {
  const match = /^#?([0-9a-f]{6})$/iu.exec(color ?? "");
  const value = match?.[1] ?? fallback;
  return [0, 2, 4].map((offset) => Number.parseInt(value.slice(offset, offset + 2), 16));
}

function patternIconDataUrl(pattern) {
  if (pattern.flags?.noIcon || !pattern.iconBase64) {
    return undefined;
  }
  const iconBytes = Buffer.from(pattern.iconBase64, "base64");
  const expectedBytes = (PATTERN_ICON_SIZE * PATTERN_ICON_SIZE) / 8;
  if (iconBytes.length !== expectedBytes) {
    return undefined;
  }

  const rows = [];
  for (let y = 0; y < PATTERN_ICON_SIZE; y += 1) {
    const row = iconBytes.readUInt16LE(y * 2);
    rows.push(0);
    for (let x = 0; x < PATTERN_ICON_SIZE; x += 1) {
      const bit = (row >> (15 - x)) & 1;
      rows.push(bit);
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(PATTERN_ICON_SIZE, 0);
  header.writeUInt32BE(PATTERN_ICON_SIZE, 4);
  header[8] = 8;
  header[9] = 3;
  const palette = Buffer.from([
    ...rgbBytes(pattern.background, "ffffff"),
    ...rgbBytes(pattern.foreground, "000000"),
  ]);
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("PLTE", palette),
    pngChunk("IDAT", deflateSync(Buffer.from(rows))),
    pngChunk("IEND"),
  ]);
  return `data:image/png;base64,${png.toString("base64")}`;
}

function patternModuleReferences(pattern, modules) {
  const moduleByIndex = new Map(modules.map((module) => [module.index, module]));
  const references = new Map();
  for (const event of pattern.events ?? []) {
    if (event.module === undefined) {
      continue;
    }
    const module = moduleByIndex.get(event.module);
    const previous = references.get(event.module);
    references.set(event.module, {
      index: event.module,
      name: event._moduleName ?? module?.name ?? `#${event.module}`,
      ...(event._moduleType ?? module?.type ? { type: event._moduleType ?? module?.type } : {}),
      ...(module?.color ? { color: module.color } : {}),
      eventCount: (previous?.eventCount ?? 0) + 1,
    });
  }
  return [...references.values()].sort((a, b) => a.index - b.index);
}

function isClonePattern(pattern) {
  return pattern.infoFlags?.clone === true;
}

function patternSource(pattern, patternsByIndex) {
  if (!isClonePattern(pattern) || !Number.isInteger(pattern.parent)) {
    return pattern;
  }
  return patternsByIndex.get(pattern.parent) ?? pattern;
}

function patternSummary(pattern, modules, patternsByIndex) {
  const clone = isClonePattern(pattern);
  const source = patternSource(pattern, patternsByIndex);
  const iconDataUrl = patternIconDataUrl(pattern) ?? (clone ? patternIconDataUrl(source) : undefined);
  const lines = pattern.lines ?? (clone ? source.lines : undefined);
  const tracks = pattern.tracks ?? (clone ? source.tracks : undefined);
  return {
    index: pattern.index,
    ...(pattern.name ? { name: pattern.name } : {}),
    ...(pattern.position ? { position: pattern.position } : {}),
    ...(lines !== undefined ? { lines } : {}),
    ...(tracks !== undefined ? { tracks } : {}),
    ...(clone ? { infoFlags: { clone: true } } : {}),
    ...(pattern.parent !== undefined ? { parent: pattern.parent } : {}),
    ...(pattern.parentId !== undefined ? { parentId: pattern.parentId } : {}),
    ...(iconDataUrl ? { icon: { src: iconDataUrl, width: PATTERN_ICON_SIZE, height: PATTERN_ICON_SIZE } } : {}),
    eventCount: pattern.eventCount,
    moduleReferences: patternModuleReferences(source, modules),
  };
}

function isVisiblePattern(pattern) {
  return pattern.eventCount > 0 || Boolean(pattern.name?.trim()) || isClonePattern(pattern);
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
    ...(module.controllers?.length ? { controllers: module.controllers } : {}),
    ...(module.userControllers?.length ? { userControllers: module.userControllers } : {}),
    dataChunkCount: module.dataChunkCount,
    ...(module.dataChunks?.length ? { dataChunks: module.dataChunks } : {}),
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
  const visiblePatterns = (outline.patterns ?? []).filter(isVisiblePattern);
  return {
    modules: outline.graph?.modules ?? outline.modules?.length ?? 0,
    activeModules: outline.graph?.activeModules ?? 0,
    links: outline.graph?.edges ?? outline.links?.length ?? 0,
    patterns: visiblePatterns.length,
    events: (outline.patterns ?? []).reduce((total, pattern) => total + pattern.eventCount, 0),
    embeddedContainers: outline.embedded?.length ?? 0,
  };
}

function embeddedSummary(embedded) {
  return {
    hostModule: embedded.hostModule,
    hostName: embedded.hostName,
    hostType: embedded.hostType,
    hostKind: embedded.hostKind,
    ...(embedded.hostColor ? { hostColor: embedded.hostColor } : {}),
    dataChunkIndex: embedded.dataChunkIndex,
    ...(embedded.dataChunkName ? { dataChunkName: embedded.dataChunkName } : {}),
    document: documentSummary(embedded.document, embedded.document.sourceName),
  };
}

function documentSummary(outline, path, metadata = {}) {
  const modules = outline.modules ?? [];
  const visiblePatterns = (outline.patterns ?? []).filter(isVisiblePattern);
  const patternsByIndex = new Map((outline.patterns ?? []).map((pattern) => [pattern.index, pattern]));
  return {
    path,
    title: fileTitle(path, outline),
    magic: outline.magic,
    type: outline.magic === "SSYN" ? "synth" : "project",
    ...(metadata.sourceRecipe ? { sourceRecipe: metadata.sourceRecipe } : {}),
    ...(outline.project ? { project: outline.project } : {}),
    ...(outline.synth ? { synth: moduleSummary(outline.synth) } : {}),
    stats: outlineStats(outline),
    modules: modules.filter((module) => module.kind !== "empty").map(moduleSummary),
    links: (outline.links ?? []).map(linkSummary),
    patterns: visiblePatterns.map((pattern) => patternSummary(pattern, modules, patternsByIndex)),
    embedded: (outline.embedded ?? []).map(embeddedSummary),
  };
}

export async function collectSiteData(paths = DEFAULT_ROOTS) {
  const files = await findSunVoxFiles(paths);
  const generatedSourceRecipes = await collectGeneratedSourceRecipes();
  const projects = [];
  for (const file of files) {
    const outline = await buildOutlineFromFile(file);
    const path = relative(process.cwd(), file).replaceAll("\\", "/");
    projects.push(documentSummary(outline, path, { sourceRecipe: generatedSourceRecipes.get(path) }));
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

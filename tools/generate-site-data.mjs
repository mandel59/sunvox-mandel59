#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

import { analyzeSunsynthFile, parseProbe } from "./sunsynth-characterize.mjs";
import { buildOutlineFromFile } from "./sunvox-outline.mjs";
import { loadEditRecipe } from "./sunvox-edit-recipe.mjs";

export const DEFAULT_ROOTS = ["music", "instruments", "generated/music", "generated/instruments"];
const DEFAULT_RECIPE_ROOTS = ["generated/recipes/sunvox-edit"];
const DEFAULT_OUTPUT = "site-data/sunvox-projects.json";
const SUNVOX_EXTENSIONS = new Set([".sunvox", ".sunsynth"]);
const RECIPE_EXTENSIONS = new Set([".mjs"]);
const PATTERN_ICON_SIZE = 16;
const CATALOG_SCHEMA_VERSION = 1;
const CATALOG_PROBE = parseProbe("C4:96:0.25");
const CATALOG_RENDER_METHOD = "pattern-playback";
const FMX_ATLAS_RECIPE_PATH = "generated/recipes/sunvox-edit/scratch-fmx.mjs";

export function mergeRootLists(...rootLists) {
  const merged = [];
  const seen = new Set();
  for (const roots of rootLists) {
    for (const root of roots ?? []) {
      if (typeof root !== "string") {
        continue;
      }
      const trimmed = root.trim();
      if (!trimmed || seen.has(trimmed)) {
        continue;
      }
      seen.add(trimmed);
      merged.push(trimmed);
    }
  }
  return merged;
}

export function parsePreviewRoots(value) {
  if (typeof value !== "string") {
    return [];
  }
  return value
    .split(/[;\r\n]+/u)
    .map((root) => root.trim())
    .filter(Boolean);
}

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
    const recipe = await loadEditRecipe(recipeFile, { cacheBust: true });
    const recipePath = relative(process.cwd(), recipeFile).replaceAll("\\", "/");
    for (const output of Object.values(recipe.outputs)) {
      if (output.kind !== "sunsynth" || extname(output.file).toLowerCase() !== ".sunsynth") {
        continue;
      }
      const recipeSource = {
        path: recipePath,
        name: basename(recipePath),
      };
      const outputPath = output.file.replaceAll("\\", "/");
      sources.set(outputPath, recipeSource);
      const generatedPath = `generated/instruments/${basename(output.file)}`;
      sources.set(generatedPath, recipeSource);
    }
  }
  return sources;
}

function sourceRootForPath(path, roots) {
  return roots.find((root) => path === root || path.startsWith(`${root}/`));
}

function deploymentSummary(path, roots) {
  const defaultRoot = sourceRootForPath(path, DEFAULT_ROOTS);
  const sourceRoot = sourceRootForPath(path, roots);
  return {
    status: defaultRoot ? "deploy" : "preview-only",
    deploy: Boolean(defaultRoot),
    previewOnly: Boolean(sourceRoot && !defaultRoot),
    root: sourceRoot ?? defaultRoot,
  };
}

function finiteRounded(value, digits = 3) {
  return Number.isFinite(value) ? Number(value.toFixed(digits)) : undefined;
}

function roundedInteger(value) {
  return Number.isFinite(value) ? Math.round(value) : undefined;
}

function stripUndefinedEntries(value) {
  return Object.fromEntries(Object.entries(value).filter(([, entry]) => entry !== undefined));
}

function compactMeasurement(result) {
  const { features, measurement } = result;
  const release = features.envelope.release;
  return {
    tool: "sunsynth-characterize",
    sourceFile: measurement.sourceFile.replaceAll("\\", "/"),
    renderMethod: measurement.renderMethod,
    input: {
      id: measurement.input.id,
      noteLabel: measurement.input.noteLabel,
      velocity: measurement.input.velocity,
      gateSeconds: measurement.input.requestedGateSeconds,
    },
    playback: {
      sampleRate: measurement.playback.sampleRate,
      channels: measurement.playback.channels,
      actualGateSeconds: finiteRounded(measurement.playback.actualGateSeconds, 6),
    },
    level: stripUndefinedEntries({
      peak: finiteRounded(features.level.peak, 2),
      rms: finiteRounded(features.level.rms, 2),
      bodyRms: finiteRounded(features.level.bodyRms, 2),
      tailToBodyRatio: finiteRounded(features.level.tailToBodyRatio, 2),
    }),
    envelope: stripUndefinedEntries({
      attackMs: roundedInteger(features.envelope.attackMs),
      releaseStatus: release.status,
      releaseMs: roundedInteger(release.ms),
      tailDurationMs: roundedInteger(features.envelope.tailDurationMs),
    }),
    spectrum: stripUndefinedEntries({
      bodyCentroidHz: roundedInteger(features.spectrum.body.centroidHz),
      bodyInharmonicityCents: finiteRounded(features.spectrum.body.inharmonicityCents, 1),
      transientHighRatio: finiteRounded(features.spectrum.transient.highRatio, 2),
    }),
    stereo: stripUndefinedEntries({
      sideToMidRatio: finiteRounded(features.stereo.sideToMidRatio, 2),
    }),
    tags: features.tags,
    diagnosis: features.diagnosis,
  };
}

function shouldCatalogAsset(project) {
  return project.type === "synth";
}

function shouldMeasureCatalogAsset(project, sourceRecipe) {
  return project.synth?.type === "FMX" && sourceRecipe?.path === FMX_ATLAS_RECIPE_PATH;
}

async function generatedAssetCatalogEntry({ file, path, project, sourceRecipe, sourceRoots }) {
  if (!shouldCatalogAsset(project)) {
    return undefined;
  }
  const measurement = shouldMeasureCatalogAsset(project, sourceRecipe)
    ? compactMeasurement(await analyzeSunsynthFile(file, CATALOG_PROBE, CATALOG_RENDER_METHOD))
    : undefined;
  return {
    schemaVersion: CATALOG_SCHEMA_VERSION,
    path,
    title: project.title,
    type: project.type,
    synthType: project.synth.type,
    ...(sourceRecipe ? { sourceRecipe } : {}),
    deployment: deploymentSummary(path, sourceRoots),
    ...(measurement ? { measurement } : {}),
  };
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

function siteControllerSummary(controller, { includeRanges = false } = {}) {
  if (includeRanges && typeof controller.value === "number") {
    return controller;
  }
  const { min, max, ...summary } = controller;
  return summary;
}

function moduleSummary(module, options = {}) {
  return {
    index: module.index,
    name: module.name,
    kind: module.kind,
    ...(module.type ? { type: module.type } : {}),
    ...(module.position ? { position: module.position } : {}),
    ...(module.scale !== undefined ? { scale: module.scale } : {}),
    ...(module.color ? { color: module.color } : {}),
    flags: module.flags,
    inputCount: module.inputs.length,
    outputCount: module.outputs.length,
    controllerCount: module.controllerCount,
    ...(module.controllers?.length
      ? { controllers: module.controllers.map((controller) => siteControllerSummary(controller, options)) }
      : {}),
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

function documentSummary(outline, path) {
  const modules = outline.modules ?? [];
  const visiblePatterns = (outline.patterns ?? []).filter(isVisiblePattern);
  const patternsByIndex = new Map((outline.patterns ?? []).map((pattern) => [pattern.index, pattern]));
  return {
    path,
    title: fileTitle(path, outline),
    magic: outline.magic,
    type: outline.magic === "SSYN" ? "synth" : "project",
    ...(outline.project ? { project: outline.project } : {}),
    ...(outline.synth ? { synth: moduleSummary(outline.synth, { includeRanges: true }) } : {}),
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
  const catalogEntries = [];
  for (const file of files) {
    const outline = await buildOutlineFromFile(file);
    const path = relative(process.cwd(), file).replaceAll("\\", "/");
    const sourceRecipe = generatedSourceRecipes.get(path);
    const project = documentSummary(outline, path);
    const catalog = await generatedAssetCatalogEntry({ file, path, project, sourceRecipe, sourceRoots: paths });
    if (catalog) {
      project.catalog = catalog;
      catalogEntries.push(catalog);
    }
    projects.push(project);
  }
  return {
    schemaVersion: 2,
    sourceRoots: paths,
    assetCatalog: {
      schemaVersion: CATALOG_SCHEMA_VERSION,
      entries: catalogEntries,
    },
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

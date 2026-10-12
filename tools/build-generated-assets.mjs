#!/usr/bin/env node
import { createHash } from "node:crypto";
import { copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { loadEditRecipe, runEditRecipe } from "./sunvox-edit-recipe.mjs";
import { loadMusicRecipe, runMusicRecipe } from "./sunvox-music-recipe.mjs";

export function assetDigest(bytes) {
  return { sha256: createHash("sha256").update(bytes).digest("hex"), bytes: bytes.length };
}

export function validateManifest(manifest) {
  if (manifest?.schemaVersion !== 1 || !Array.isArray(manifest.assets) || !manifest.assets.length) {
    throw new Error("Expected a non-empty generated manifest with schemaVersion 1");
  }
  const paths = new Set();
  const outputs = new Set();
  for (const asset of manifest.assets) {
    const music = /^generated\/music\/[^/]+\.sunvox$/u.test(asset.path);
    const synth = /^generated\/instruments\/[^/]+\.sunsynth$/u.test(asset.path);
    const recipePattern = music
      ? /^generated\/recipes\/music\/[\w-]+\.mjs$/u
      : /^generated\/recipes\/sunvox-edit\/[\w-]+\.mjs$/u;
    if ((!music && !synth) || asset.path.includes("\\") || !recipePattern.test(asset.recipe) ||
        typeof asset.outputId !== "string" || !asset.outputId ||
        !/^[a-f0-9]{64}$/u.test(asset.sha256) || !Number.isSafeInteger(asset.bytes) || asset.bytes <= 0) {
      throw new Error(`Invalid generated asset: ${JSON.stringify(asset)}`);
    }
    const output = `${asset.recipe}:${asset.outputId}`;
    if (paths.has(asset.path) || outputs.has(output)) throw new Error(`Duplicate generated asset: ${asset.path}`);
    paths.add(asset.path);
    outputs.add(output);
  }
  return manifest;
}

export async function readGeneratedManifest(root = process.cwd()) {
  return validateManifest(JSON.parse(await readFile(resolve(root, "generated/manifest.json"), "utf8")));
}

function assertDigest(asset, bytes) {
  const actual = assetDigest(bytes);
  if (actual.sha256 !== asset.sha256 || actual.bytes !== asset.bytes) {
    throw new Error(`Generated asset hash/size mismatch: ${asset.path}; expected ${asset.sha256} (${asset.bytes}), got ${actual.sha256} (${actual.bytes}). Review the change before --update-manifest.`);
  }
}

async function assetsPresent(root, manifest) {
  let present = true;
  for (const asset of manifest.assets) {
    let bytes;
    try { bytes = await readFile(resolve(root, asset.path)); }
    catch (error) {
      if (error.code !== "ENOENT") throw error;
      present = false;
      continue;
    }
    assertDigest(asset, bytes);
  }
  for (const directory of ["generated/instruments", "generated/music"]) {
    let files;
    try { files = await readdir(resolve(root, directory)); }
    catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (files.some((file) => /\.(sunvox|sunsynth)$/u.test(file) && !manifest.assets.some((asset) => asset.path === `${directory}/${file}`))) present = false;
  }
  return present;
}

async function buildRecipeGroup(root, staging, recipePath, assets) {
  const music = assets[0].path.endsWith(".sunvox");
  const absoluteRecipe = resolve(root, recipePath);
  const recipe = await (music ? loadMusicRecipe : loadEditRecipe)(absoluteRecipe);
  for (const asset of assets) {
    const output = recipe.outputs[asset.outputId];
    if (!output) throw new Error(`Unknown output ${asset.outputId} in ${recipePath}`);
    const path = typeof output.file === "string" ? output.file : "";
    const relativePath = relative(staging, resolve(staging, path));
    if (!path || isAbsolute(path) || relativePath === ".." || relativePath.startsWith("../") || relativePath.startsWith("..\\")) {
      throw new Error(`Recipe output escapes staging: ${recipePath}`);
    }
  }
  const options = { outDir: staging, assetRoot: staging, outputIds: assets.map((asset) => asset.outputId) };
  await (music ? runMusicRecipe : runEditRecipe)(absoluteRecipe, options);
  for (const asset of assets) {
    const output = resolve(staging, recipe.outputs[asset.outputId].file);
    const destination = resolve(staging, asset.path);
    if (output !== destination) {
      await mkdir(dirname(destination), { recursive: true });
      await copyFile(output, destination);
    }
  }
}

export async function buildGeneratedAssets({ root = process.cwd(), outDir = root, ifMissing = false, updateManifest = false } = {}) {
  root = resolve(root);
  outDir = resolve(outDir);
  const manifest = await readGeneratedManifest(root);
  if (ifMissing && updateManifest) throw new Error("--if-missing and --update-manifest cannot be combined");
  if (ifMissing && await assetsPresent(outDir, manifest)) return manifest;
  const staging = await mkdtemp(join(tmpdir(), "sunvox-generated-"));
  try {
    // Instruments precede music; music reads dependencies only from staging.
    const groups = new Map();
    const ordered = [...manifest.assets].sort((a, b) => Number(a.path.endsWith(".sunvox")) - Number(b.path.endsWith(".sunvox")));
    for (const asset of ordered) {
      if (!groups.has(asset.recipe)) groups.set(asset.recipe, []);
      groups.get(asset.recipe).push(asset);
    }
    for (const [recipe, assets] of groups) await buildRecipeGroup(root, staging, recipe, assets);
    for (const asset of manifest.assets) {
      const bytes = await readFile(resolve(staging, asset.path));
      if (updateManifest) Object.assign(asset, assetDigest(bytes));
      else assertDigest(asset, bytes);
    }
    // Publish only after every build and hash check passes. Remove stale distributed outputs.
    for (const directory of ["generated/instruments", "generated/music"]) {
      await mkdir(resolve(outDir, directory), { recursive: true });
      for (const file of await readdir(resolve(outDir, directory))) {
        if (/\.(sunvox|sunsynth)$/u.test(file) && !manifest.assets.some((asset) => asset.path === `${directory}/${file}`)) {
          await rm(resolve(outDir, directory, file));
        }
      }
    }
    for (const asset of manifest.assets) await copyFile(resolve(staging, asset.path), resolve(outDir, asset.path));
    if (updateManifest) await writeFile(resolve(root, "generated/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
    return manifest;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  const flags = process.argv.slice(2);
  if (flags.some((flag) => !["--if-missing", "--update-manifest"].includes(flag))) {
    console.error("Usage: node tools/build-generated-assets.mjs [--if-missing | --update-manifest]");
    process.exitCode = 1;
  } else {
    try {
      const manifest = await buildGeneratedAssets({ ifMissing: flags.includes("--if-missing"), updateManifest: flags.includes("--update-manifest") });
      console.log(`Verified ${manifest.assets.length} generated assets against generated/manifest.json`);
    } catch (error) {
      console.error(error.message);
      process.exitCode = 1;
    }
  }
}

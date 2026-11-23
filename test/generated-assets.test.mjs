import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";

const execFileAsync = promisify(execFile);
import { cp, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import test from "node:test";
import { assetDigest, buildGeneratedAssets, readGeneratedManifest, validateManifest } from "../tools/build-generated-assets.mjs";

async function fixture(t, outputIds = ["scratchAnalog"]) {
  const root = await mkdtemp(join(tmpdir(), "sunvox-manifest-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = await readGeneratedManifest();
  const assets = source.assets.filter((asset) => outputIds.includes(asset.outputId));
  assert.equal(assets.length, outputIds.length);
  const directory = resolve(root, "generated/manifests/instruments");
  await mkdir(directory, { recursive: true });
  const entries = [];
  for (const asset of assets) {
    await mkdir(dirname(resolve(root, asset.recipe)), { recursive: true });
    await cp(resolve(asset.recipe), resolve(root, asset.recipe));
    const entry = resolve(directory, `${basename(asset.path, ".sunsynth")}.json`);
    await writeFile(entry, `${JSON.stringify(asset)}\n`);
    entries.push(entry);
  }
  return { root, asset: assets[0], manifest: { schemaVersion: 1, assets }, entries };
}

test("distributed music and instruments rebuild from recipes to manifest hashes in an empty directory", async (t) => {
  const outDir = await mkdtemp(join(tmpdir(), "sunvox-generated-test-"));
  t.after(() => rm(outDir, { recursive: true, force: true }));
  const manifest = await readGeneratedManifest();
  const script = `const { buildGeneratedAssets } = await import(${JSON.stringify(pathToFileURL(resolve("tools/build-generated-assets.mjs")).href)}); await buildGeneratedAssets({root: ${JSON.stringify(resolve("."))}, outDir: process.cwd()});`;
  // No generated inputs or human instruments exist in the process's cwd.
  await execFileAsync(process.execPath, ["--input-type=module", "-e", script], { cwd: outDir });
  for (const asset of manifest.assets) assert.deepEqual(assetDigest(await readFile(resolve(outDir, asset.path))), { sha256: asset.sha256, bytes: asset.bytes }, asset.path);
  for (const directory of ["generated/instruments", "generated/music"]) {
    assert.deepEqual((await readdir(resolve(outDir, directory))).sort(), manifest.assets.filter((asset) => asset.path.startsWith(`${directory}/`)).map((asset) => basename(asset.path)).sort());
  }
});

test("if-missing restores outputs, verifies existing bytes and rejects corruption", async (t) => {
  const { root, asset } = await fixture(t);
  await buildGeneratedAssets({ root, ifMissing: true });
  await buildGeneratedAssets({ root, ifMissing: true });
  await rm(resolve(root, asset.recipe)); // Existing valid files do not need recipes executed.
  await buildGeneratedAssets({ root, ifMissing: true });
  await writeFile(resolve(root, asset.path), "corrupt");
  await assert.rejects(buildGeneratedAssets({ root, ifMissing: true }), /hash\/size mismatch/u);
});

test("mismatched regeneration leaves existing outputs and manifest entries untouched", async (t) => {
  const { root, asset, manifest, entries: [entry] } = await fixture(t);
  await mkdir(dirname(resolve(root, asset.path)), { recursive: true });
  await writeFile(resolve(root, asset.path), "previous output");
  manifest.assets[0].sha256 = "0".repeat(64);
  await writeFile(entry, JSON.stringify(asset));
  await assert.rejects(buildGeneratedAssets({ root }), /hash\/size mismatch/u);
  assert.equal(await readFile(resolve(root, asset.path), "utf8"), "previous output");
  assert.deepEqual(await readGeneratedManifest(root), manifest);
});

test("explicit update rewrites only changed entries and removes stale outputs", async (t) => {
  const { root, asset, entries: [changed, unchanged] } = await fixture(t, ["scratchAnalog", "scratchFMXTines"]);
  const unchangedText = await readFile(unchanged, "utf8");
  await writeFile(changed, JSON.stringify({ ...asset, sha256: "0".repeat(64) }));
  await mkdir(resolve(root, "generated/music"), { recursive: true });
  await writeFile(resolve(root, "generated/music/stale.sunvox"), "stale");
  await buildGeneratedAssets({ root, updateManifest: true });
  const updated = await readGeneratedManifest(root);
  assert.deepEqual(updated.assets[0], asset);
  assert.deepEqual(assetDigest(await readFile(resolve(root, asset.path))), { sha256: asset.sha256, bytes: asset.bytes });
  assert.equal(await readFile(unchanged, "utf8"), unchangedText);
  assert.deepEqual(await readdir(resolve(root, "generated/music")), []);
  await assert.rejects(buildGeneratedAssets({ root, updateManifest: true, ifMissing: true }), /cannot be combined/u);
});

test("independent entries must match their output paths and cannot select the same recipe output", async (t) => {
  const { root, asset, entries: [entry] } = await fixture(t);
  const secondEntry = resolve(dirname(entry), "Second.json");
  await writeFile(secondEntry, JSON.stringify(asset));
  await assert.rejects(readGeneratedManifest(root), /Second\.json does not match its output path/u);
  await writeFile(secondEntry, JSON.stringify({ ...asset, path: "generated/instruments/Second.sunsynth" }));
  await assert.rejects(readGeneratedManifest(root), /Duplicate generated asset/u);
});

test("manifest rejects duplicate paths, invalid hashes and non-distribution paths", async () => {
  const manifest = await readGeneratedManifest();
  const asset = manifest.assets[0];
  assert.throws(() => validateManifest({ schemaVersion: 1, assets: [asset, asset] }), /Duplicate/u);
  for (const patch of [{ path: "../escape.sunvox" }, { path: "var/test.sunvox" }, { sha256: "invalid" }, { recipe: "../recipe.mjs" }, { bytes: -1 }]) {
    assert.throws(() => validateManifest({ schemaVersion: 1, assets: [{ ...asset, ...patch }] }), /Invalid/u);
  }
});

test("optional music creation dates must be valid calendar dates", async () => {
  const manifest = await readGeneratedManifest();
  const asset = manifest.assets.find(({ path }) => path.endsWith("/wa-bgm-sketch.sunvox"));
  assert.ok(asset);
  assert.equal(asset.createdOn, "2026-06-10");
  const withDate = (createdOn) => ({ schemaVersion: 1, assets: [{ ...asset, createdOn }] });
  assert.doesNotThrow(() => validateManifest(withDate(undefined)));
  assert.doesNotThrow(() => validateManifest(withDate("2024-02-29")));
  for (const date of [null, "2026-6-10", "2025-02-29", "2026-02-30"]) {
    assert.throws(() => validateManifest(withDate(date)), /Invalid createdOn .*YYYY-MM-DD/u);
  }
});

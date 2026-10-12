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

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), "sunvox-manifest-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = await readGeneratedManifest();
  const asset = structuredClone(source.assets.find((item) => item.outputId === "scratchAnalog"));
  assert.ok(asset);
  await mkdir(dirname(resolve(root, asset.recipe)), { recursive: true });
  await cp(resolve(asset.recipe), resolve(root, asset.recipe));
  const manifest = { schemaVersion: 1, assets: [asset] };
  await writeFile(resolve(root, "generated/manifest.json"), `${JSON.stringify(manifest)}\n`);
  return { root, asset, manifest };
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

test("mismatched regeneration leaves existing outputs and manifest untouched", async (t) => {
  const { root, asset, manifest } = await fixture(t);
  await mkdir(dirname(resolve(root, asset.path)), { recursive: true });
  await writeFile(resolve(root, asset.path), "previous output");
  manifest.assets[0].sha256 = "0".repeat(64);
  await writeFile(resolve(root, "generated/manifest.json"), JSON.stringify(manifest));
  await assert.rejects(buildGeneratedAssets({ root }), /hash\/size mismatch/u);
  assert.equal(await readFile(resolve(root, asset.path), "utf8"), "previous output");
  assert.deepEqual(await readGeneratedManifest(root), manifest);
});

test("explicit update records the rebuilt digest and removes stale outputs", async (t) => {
  const { root, asset, manifest } = await fixture(t);
  manifest.assets[0].sha256 = "0".repeat(64);
  await writeFile(resolve(root, "generated/manifest.json"), JSON.stringify(manifest));
  await mkdir(resolve(root, "generated/music"), { recursive: true });
  await writeFile(resolve(root, "generated/music/stale.sunvox"), "stale");
  await buildGeneratedAssets({ root, updateManifest: true });
  const updated = await readGeneratedManifest(root);
  assert.deepEqual(assetDigest(await readFile(resolve(root, asset.path))), { sha256: updated.assets[0].sha256, bytes: updated.assets[0].bytes });
  assert.deepEqual(await readdir(resolve(root, "generated/music")), []);
  await assert.rejects(buildGeneratedAssets({ root, updateManifest: true, ifMissing: true }), /cannot be combined/u);
});

test("manifest rejects duplicate paths, invalid hashes and non-distribution paths", async () => {
  const manifest = await readGeneratedManifest();
  const asset = manifest.assets[0];
  assert.throws(() => validateManifest({ schemaVersion: 1, assets: [asset, asset] }), /Duplicate/u);
  for (const patch of [{ path: "../escape.sunvox" }, { path: "var/test.sunvox" }, { sha256: "invalid" }, { recipe: "../recipe.mjs" }, { bytes: -1 }]) {
    assert.throws(() => validateManifest({ schemaVersion: 1, assets: [{ ...asset, ...patch }] }), /Invalid/u);
  }
});

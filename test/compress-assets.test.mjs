import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gunzipSync } from "node:zlib";
import test from "node:test";
import { compressSunVoxAssets } from "../tools/compress-assets.mjs";

test("compression recursively creates smaller siblings and removes unhelpful stale gzip files", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "sunvox-compress-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "nested"));
  const path = join(root, "nested", "synth.sunsynth");
  const raw = Buffer.from("SSYN".repeat(100));
  await writeFile(path, raw);
  await writeFile(join(root, "tiny.sunvox"), "SVOX");
  await writeFile(join(root, "tiny.sunvox.gz"), "stale");
  await writeFile(join(root, "ignore.txt"), raw);
  const results = await compressSunVoxAssets(root);
  assert.equal(results.length, 1);
  assert.ok(results[0].gzipBytes < results[0].bytes);
  const gzip = await readFile(`${path}.gz`);
  assert.deepEqual(gunzipSync(gzip), raw);
  await assert.rejects(readFile(join(root, "tiny.sunvox.gz")), { code: "ENOENT" });
  await assert.rejects(readFile(join(root, "ignore.txt.gz")), { code: "ENOENT" });
  await compressSunVoxAssets(root);
  assert.deepEqual(await readFile(`${path}.gz`), gzip);
});

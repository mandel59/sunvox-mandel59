import assert from "node:assert/strict";
import test from "node:test";

import { createAsyncRootsCache } from "../tools/async-roots-cache.mjs";

test("repeated roots reuse one generated result", async () => {
  let calls = 0;
  const cache = createAsyncRootsCache(async (roots) => ({ calls: ++calls, roots }));

  const first = await cache.get(["music", "generated/music"]);
  const second = await cache.get(["music", "generated/music"]);

  assert.equal(calls, 1);
  assert.strictEqual(second, first);
});

test("concurrent requests for the same roots share one generation", async () => {
  let calls = 0;
  let release;
  const blocked = new Promise((resolve) => {
    release = resolve;
  });
  const cache = createAsyncRootsCache(async () => {
    calls += 1;
    await blocked;
    return { calls };
  });

  const first = cache.get(["music"]);
  const second = cache.get(["music"]);
  assert.equal(calls, 0);
  release();

  assert.strictEqual(await second, await first);
  assert.equal(calls, 1);
});

test("watched changes invalidate only affected root entries", async () => {
  let calls = 0;
  const cache = createAsyncRootsCache(async (roots) => ({ calls: ++calls, roots }), {
    pathAffectsRoots: (filePath, roots) => roots.some((root) => filePath.startsWith(`${root}/`)),
  });
  const music = await cache.get(["music"]);
  const instruments = await cache.get(["instruments"]);

  cache.invalidatePath("music/changed.sunvox");

  const regeneratedMusic = await cache.get(["music"]);
  const cachedInstruments = await cache.get(["instruments"]);
  assert.notStrictEqual(regeneratedMusic, music);
  assert.strictEqual(cachedInstruments, instruments);
  assert.equal(calls, 3);
});

test("failed generations are not cached", async () => {
  let calls = 0;
  const cache = createAsyncRootsCache(async () => {
    calls += 1;
    if (calls === 1) {
      throw new Error("generation failed");
    }
    return { calls };
  });

  await assert.rejects(cache.get(["music"]), /generation failed/u);
  assert.deepEqual(await cache.get(["music"]), { calls: 2 });
});

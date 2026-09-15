import test from "node:test";
import assert from "node:assert/strict";
import { createSunVoxPlayer } from "../src/index.js";

function browser(t, { addModule = async () => {}, failWorker = false } = {}) {
  const workers = [], contexts = [];
  class Context {
    state = "running"; sampleRate = 44100; destination = {};
    audioWorklet = { addModule };
    constructor() { contexts.push(this); }
    async close() { this.closed = true; }
    async resume() {}
  }
  class Worker {
    constructor(url, options) { Object.assign(this, { url, options, messages: [] }); workers.push(this); }
    postMessage(message) {
      this.messages.push(message.payload);
      queueMicrotask(() => {
        if (failWorker) this.onerror?.({ message: "runtime unavailable" });
        else this.onmessage?.({ data: { type: "command-result", id: message.id, ok: true, payload: {} } });
      });
    }
    terminate() { this.terminated = true; }
  }
  class Worklet {
    port = { postMessage() {} };
    connect() {}
    disconnect() {}
  }
  for (const [key, value] of Object.entries({ AudioContext: Context, Worker, AudioWorkletNode: Worklet })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  return { workers, contexts };
}
const options = { runtimeBaseUrl: "https://example.test/runtime", resourceBaseUrl: "https://example.test/app/" };

test("requires runtime and keeps instances isolated without browser globals", async () => {
  assert.throws(() => createSunVoxPlayer(), /runtimeBaseUrl/);
  const first = createSunVoxPlayer(options), second = createSunVoxPlayer(options);
  assert.equal(await first.setMasterVolume(12), 12);
  assert.equal(second.getMasterVolume(), 256);
  const snapshot = first.getPlayerState(); snapshot.ready = true;
  assert.equal(first.getPlayerState().ready, false);
  first.dispose(); second.dispose();
});

test("initializes once, resolves URLs, and releases resources", async (t) => {
  const modules = [];
  const { workers, contexts } = browser(t, { addModule: async (url) => modules.push(url) });
  const player = createSunVoxPlayer({ ...options, workerUrl: "./worker.js", workletUrl: "./worklet.js" });
  await Promise.all([player.initialize(), player.initialize()]);
  assert.equal(workers.length, 1);
  assert.equal(workers[0].url, "https://example.test/app/worker.js");
  assert.equal(workers[0].options.type, "classic");
  assert.deepEqual(modules, ["https://example.test/app/worklet.js"]);
  const init = workers[0].messages.find((m) => m.type === "initialize");
  assert.equal(init.sunvoxJsUrl, "https://example.test/runtime/sunvox.js");
  assert.equal(init.sunvoxLoaderJsUrl, "https://example.test/runtime/sunvox_lib_loader.js");
  await player.loadAndPlay("music/song.sunvox");
  assert.equal(workers[0].messages.find((m) => m.type === "loadAndPlay").resourceUrl, "https://example.test/app/music/song.sunvox");
  assert.equal(player.getPlayerState().ready, true);
  player.dispose();
  assert.equal(workers[0].terminated, true);
  assert.equal(contexts[0].closed, true);
  assert.equal(player.getPlayerState().ready, false);
  await assert.rejects(player.initialize(), /disposed/);
});

test("worker failure rejects initialization and closes resources", async (t) => {
  const { contexts, workers } = browser(t, { failWorker: true });
  const player = createSunVoxPlayer(options);
  await assert.rejects(player.initialize(), /runtime unavailable/);
  assert.equal(contexts[0].closed, true);
  assert.equal(workers[0].terminated, true);
  player.dispose();
});

test("dispose during worklet loading cannot resurrect the player", async (t) => {
  let finish;
  const { workers, contexts } = browser(t, { addModule: () => new Promise((resolve) => { finish = resolve; }) });
  const player = createSunVoxPlayer(options);
  const initializing = player.initialize();
  player.dispose(); finish();
  await assert.rejects(initializing, /disposed/);
  assert.equal(workers.length, 0);
  assert.equal(contexts[0].closed, true);
});

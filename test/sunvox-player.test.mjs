import test from "node:test";
import assert from "node:assert/strict";
import { createSunVoxPlayer } from "../js/sunvox-player.js";

function browser(t, { addModule = async () => {}, failWorker = false, suspended = false } = {}) {
  const workers = [], contexts = [], requests = [];
  class Context {
    state = suspended ? "suspended" : "running"; sampleRate = 44100; destination = {};
    audioWorklet = { addModule };
    constructor() { contexts.push(this); }
    async close() { this.closed = true; }
    async resume() {
      if (suspended && !this.allowed) return new Promise(() => {});
      this.state = "running";
    }
  }
  class Worker {
    constructor(url, options) { Object.assign(this, { url, options, messages: [] }); workers.push(this); }
    postMessage(message) {
      this.messages.push(message.payload);
      queueMicrotask(() => {
        if (failWorker) this.onerror?.({ message: "runtime unavailable" });
        else this.onmessage?.({ data: { type: "command-result", id: message.id, ok: true, payload: message.payload.type === "initialize" ? { version: 1, sampleRate: 44100, channels: 2 } : message.payload.type === "batch" ? message.payload.commands.map(() => 0) : message.payload.command?.method === "sv_load_module_from_memory" ? 3 : 0 } });
      });
    }
    terminate() { this.terminated = true; }
  }
  class Worklet {
    port = { postMessage() {} };
    connect() {}
    disconnect() {}
  }
  for (const [key, value] of Object.entries({ AudioContext: Context, Worker, AudioWorkletNode: Worklet, fetch: async (url) => { requests.push(String(url)); return { ok: true, arrayBuffer: async () => new TextEncoder().encode(String(url).endsWith("sunsynth") ? "SSYN" : "SVOX").buffer }; } })) {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, key);
    Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
    t.after(() => descriptor ? Object.defineProperty(globalThis, key, descriptor) : delete globalThis[key]);
  }
  return { workers, contexts, requests };
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
  const { workers, contexts, requests } = browser(t, { addModule: async (url) => modules.push(url) });
  const player = createSunVoxPlayer({ ...options, workerUrl: "./worker.js", workletUrl: "./worklet.js" });
  await Promise.all([player.initialize(), player.initialize()]);
  assert.equal(workers.length, 1);
  assert.equal(String(workers[0].url), "https://example.test/app/worker.js");
  assert.equal(workers[0].options.type, "classic");
  assert.deepEqual(modules, ["https://example.test/app/worklet.js"]);
  const init = workers[0].messages.find((m) => m.type === "initialize");
  assert.equal(init.runtimeBaseUrl, "https://example.test/runtime/");
  await player.loadAndPlay("music/song.sunvox");
  assert.equal(requests[0], "https://example.test/app/music/song.sunvox");
  assert.ok(workers[0].messages.every((m) => !["loadAndPlay", "attachPlayer"].includes(m.type)));
  assert.equal(player.getPlayerState().ready, true);
  player.dispose();
  assert.equal(workers[0].terminated, true);
  assert.equal(contexts[0].closed, true);
  assert.equal(player.getPlayerState().ready, false);
  assert.throws(() => player.initialize(), /disposed/);
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
  while (!finish) await Promise.resolve();
  player.dispose(); finish();
  await assert.rejects(initializing, /disposed/);
  assert.equal(workers.length, 1);
  assert.equal(workers[0].terminated, true);
  assert.equal(contexts[0].closed, true);
});


test("automatic preload prepares a suspended context and retries resume on later calls", async (t) => {
  const { contexts } = browser(t, { suspended: true });
  const player = createSunVoxPlayer(options);
  await player.initialize();
  assert.equal(player.getPlayerState().ready, true);
  assert.equal(contexts[0].state, "suspended");
  contexts[0].allowed = true; // Browser grants the later user gesture.
  await player.loadAndPlay("music/song.sunvox");
  assert.equal(contexts[0].state, "running");
  await player.dispose();
});

test("Player owns its Engine, preserves project volume and sends only generic commands", async (t) => {
  const { workers } = browser(t);
  const player = createSunVoxPlayer(options);
  t.after(() => player.dispose());
  assert.equal(player.engine, undefined);
  assert.throws(() => createSunVoxPlayer({ ...options, engine: {} }), /owns its Engine/);
  await player.loadAndPlay("song.sunvox");
  await player.setMasterVolume(64);
  assert.ok(!workers[0].messages.some((m) => m.command?.method === "sv_volume"));
  assert.ok(workers[0].messages.some((m) => m.type === "setOutputGain" && m.gain === 0.25));
  await player.preloadSynth("voice.sunsynth");
  assert.ok(workers[0].messages.some((m) => m.command?.method === "sv_volume" && m.command.args[0] === 2));
});

test("note release during instrument fetch cancels the pending note-on", async (t) => {
  const { workers } = browser(t);
  const player = createSunVoxPlayer(options);
  t.after(() => player.dispose());
  let finish, started;
  const fetching = new Promise((resolve) => { started = resolve; });
  globalThis.fetch = () => new Promise((resolve) => { finish = () => resolve({ ok: true, arrayBuffer: async () => new TextEncoder().encode("SSYN").buffer }); started(); });
  const note = player.playSynthNote("voice.sunsynth", 60, 128, 3);
  await fetching;
  await player.stopSynthNote(60, 3);
  finish(); await note;
  assert.ok(!workers[0].messages.some((m) => m.type === "batch" && m.commands.some((c) => c.method === "sv_send_event" && c.args[2] === 61)));
});

test("disposal aborts app fetch and terminates the private Worker", async (t) => {
  const { workers } = browser(t);
  const player = createSunVoxPlayer(options);
  let started;
  const fetching = new Promise((resolve) => { started = resolve; });
  globalThis.fetch = (_url, { signal }) => new Promise((_resolve, reject) => { signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); started(); });
  const loading = player.preloadProject("pending.sunvox");
  await fetching;
  player.dispose();
  assert.equal(await loading, false);
  assert.equal(workers[0].terminated, true);
  assert.equal(player.getPlayerState().ready, false);
});

test("cached notes and controller presets use native values and Worker batches", async (t) => {
  const { workers } = browser(t);
  const player = createSunVoxPlayer(options);
  t.after(() => player.dispose());
  await player.preloadSynth("voice.sunsynth");
  await player.configureSynthControllers("voice.sunsynth", [{ controllerIndex: 2, value: 100 }, { controllerIndex: 4, value: 200 }]);
  await player.playSynthNote("voice.sunsynth", 60, 100, 35);
  await player.stopSynthNote(60, 35);
  await player.playSynthNote("voice.sunsynth", 62, 90, 4);
  await player.stopInstrumentNotes();
  const batches = workers[0].messages.filter((m) => m.type === "batch");
  const preset = batches.find((b) => b.commands[0].method === "sv_set_module_ctl_value");
  assert.deepEqual(preset.commands.map((c) => c.args), [[2, 3, 2, 100, 0], [2, 3, 4, 200, 0]]);
  const events = batches.filter((b) => b.commands[0].method === "sv_send_event");
  assert.ok(events.every((b) => b.eventTime === "render"));
  assert.deepEqual(events.flatMap((b) => b.commands.map((c) => c.args)), [
    [2, 3, 61, 100, 4, 0, 0], [2, 3, 128, 0, 4, 0, 0],
    [2, 4, 63, 90, 4, 0, 0], [2, 0, 129, 0, 4, 0, 0],
  ]);
});

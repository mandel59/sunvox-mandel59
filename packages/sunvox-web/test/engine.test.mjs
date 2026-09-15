import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import vm from "node:vm";
import { ENGINE_API } from "../src/engine-api.js";
import { createSunVoxEngine } from "../src/index.js";
import { loadSunVoxLib } from "../../../tools/sunvox-node.mjs";

const root = new URL("../../../", import.meta.url);
const loader = await readFile(new URL("sunvox_lib/sunvox_lib/js/lib/sunvox_lib_loader.js", root), "utf8");
const workerCode = await readFile(new URL("../src/engine-worker.js", import.meta.url), "utf8");

async function workerHarness(t, config = "") {
  const runtime = await loadSunVoxLib();
  let receivedConfig = null;
  const nativeInit = runtime._sv_init;
  runtime._sv_init = (pointer, ...args) => {
    receivedConfig = pointer ? runtime.UTF8ToString(pointer) : null;
    return nativeInit(pointer, ...args);
  };
  const pending = new Map(); let id = 0;
  const scope = {
    URL, Uint8Array, Uint32Array, Int16Array, Float32Array, Int32Array, ArrayBuffer, TextEncoder,
    console, setInterval, clearInterval,
    SunVoxLib: () => Promise.resolve(runtime),
    postMessage(message) {
      const command = pending.get(message.id);
      if (!command) return;
      pending.delete(message.id);
      message.ok ? command.resolve(structuredClone(message.value)) : command.reject(new Error(message.error));
    },
    importScripts(url) {
      if (url.endsWith("sunvox_lib_loader.js")) vm.runInContext(loader, context);
    },
  };
  scope.self = scope;
  const context = vm.createContext(scope);
  vm.runInContext(workerCode, context);
  const send = (message) => new Promise((resolve, reject) => {
    const next = ++id; pending.set(next, { resolve, reject }); scope.onmessage({ data: { ...message, id: next } });
  });
  const info = await send({ type: "initialize", runtimeBaseUrl: "https://example.test/", sampleRate: 44100, config, methods: ENGINE_API });
  t.after(async () => { await send({ type: "stopAudio" }); runtime._sv_deinit(); });
  return { info, receivedConfig, send, scope, runtime, call: (method, ...args) => send({ type: "call", command: { method, args } }) };
}

test("API covers every upstream JS operation except managed lifecycle/audio/locks", () => {
  const managed = new Set(["sv_init", "sv_deinit", "sv_lock_slot", "sv_unlock_slot", "sv_audio_callback", "sv_audio_callback2", "sv_update_input"]);
  const names = [...loader.matchAll(/^function (sv_\w+)\(/gm)].map((m) => m[1]);
  assert.deepEqual(names.filter((n) => !managed.has(n)).sort(), Object.keys(ENGINE_API).sort());
  const engine = createSunVoxEngine({ runtimeBaseUrl: "https://example.test/" });
  for (const name of Object.keys(ENGINE_API)) assert.equal(typeof engine[name], "function", name);
  engine.dispose();
});

test("real engine supports modules, patterns, buffers, save/reload, transport and rendering", async (t) => {
  const { call, send, info } = await workerHarness(t);
  assert.equal(info.sampleRate, 44100);
  assert.ok(info.version > 0);
  assert.equal(await call("sv_open_slot", 0), 0);
  const mod = await call("sv_new_module", 0, "Generator", "Lead", 100, 100, 0);
  assert.ok(mod > 0);
  assert.equal(await call("sv_connect_module", 0, mod, 0), 0);
  assert.equal(await call("sv_find_module", 0, "Lead"), mod);
  assert.equal(await call("sv_set_song_name", 0, "Low-level test"), 0);
  assert.equal(await call("sv_get_song_name", 0), "Low-level test");
  const outputs = await call("sv_get_module_outputs", 0, mod);
  assert.ok(outputs instanceof Int32Array);
  assert.ok(outputs.includes(0));
  const pattern = await call("sv_new_pattern", 0, -1, 0, 0, 1, 16, 0, "Notes");
  assert.ok(pattern >= 0);
  const batch = await send({ type: "batch", commands: [
    { method: "sv_set_pattern_event", args: [0, pattern, 0, 0, 61, 128, mod + 1, 0, 0] },
    { method: "sv_set_pattern_name", args: [0, pattern, "Sequence"] },
    { method: "sv_get_pattern_event", args: [0, pattern, 0, 0, 0] },
  ] });
  assert.equal(batch[2], 61);
  const data = await call("sv_get_pattern_data", 0, pattern);
  assert.ok(data instanceof Uint8Array);
  assert.equal(data[0], 61);
  await call("sv_set_pattern_event", 0, pattern, 0, 0, 62, 128, mod + 1, 0, 0);
  assert.equal(data[0], 61, "returned buffers are snapshots");
  const curve = new Float32Array(32).fill(0.25);
  const written = await call("sv_module_curve", 0, mod, 0, curve, curve.length, 1);
  assert.equal(written.result, 32);
  const read = await call("sv_module_curve", 0, mod, 0, new Float32Array(32), 32, 0);
  assert.ok(Math.abs(read.data[0] - 31 / 127) < 0.000001); // Generator stores an int8 waveform.
  assert.ok(await call("sv_get_number_of_module_ctls", 0, mod) > 0);
  const map = await call("sv_get_time_map", 0, 0, 16, 0);
  assert.equal(map.result, 0); assert.equal(map.data.length, 16);
  const saved = await call("sv_save_to_memory", 0);
  assert.ok(saved instanceof Uint8Array);
  await call("sv_open_slot", 1);
  assert.equal(await call("sv_load_from_memory", 1, saved), 0);
  assert.equal(await call("sv_get_song_name", 1), "Low-level test");
  await call("sv_play_from_beginning", 0);
  const audio = await send({ type: "render", frames: 4096 });
  assert.equal(audio.data.length, 8192);
  assert.ok(audio.data.some((v) => Math.abs(v) > 0.00001), "engine generates audible signal");
  await call("sv_pause", 0); await call("sv_resume", 0); await call("sv_rewind", 0, 0);
  const scope = await call("sv_get_module_scope2", 0, mod, 0, 128);
  assert.ok(scope.data instanceof Int16Array);
  await call("sv_stop", 0);
  await call("sv_close_slot", 1); await call("sv_close_slot", 0);
});

test("batch validation is upfront, negative lookup codes survive, locks release on exceptions", async (t) => {
  const { call, send, scope, runtime } = await workerHarness(t);
  await call("sv_open_slot", 0);
  assert.equal(await call("sv_find_module", 0, "missing"), -1);
  const before = await call("sv_get_song_name", 0);
  await assert.rejects(send({ type: "batch", commands: [
    { method: "sv_set_song_name", args: [0, "must not apply"] },
    { method: "sv_get_pattern_event", args: [0, 0, 0, 0] },
  ] }), /Invalid arguments/);
  assert.equal(await call("sv_get_song_name", 0), before);
  await assert.rejects(send({ type: "batch", commands: [{ method: "sv_open_slot", args: [1] }] }), /outside batch/);
  await assert.rejects(call("sv_get_time_map", 0, 0, -1, 0), /len/);
  await assert.rejects(call("sv_get_ticks", 42), /arguments/);
  await assert.rejects(call("sv_deinit"), /Unsupported/);
  let unlocks = 0;
  const unlock = scope.sv_unlock_slot;
  scope.sv_unlock_slot = (slot) => { unlocks++; return unlock(slot); };
  scope.sv_new_module = () => { throw new Error("injected failure"); };
  await assert.rejects(call("sv_new_module", 0, "Generator", "fail", 0, 0, 0), /injected failure/);
  assert.equal(unlocks, 1);
  assert.equal(runtime._sv_lock_slot(0), 0); runtime._sv_unlock_slot(0);
});

test("float input reaches the Input module without integer conversion", async (t) => {
  const { call, send } = await workerHarness(t);
  await call("sv_open_slot", 0);
  const inputModule = await call("sv_new_module", 0, "Input", "Input", 0, 0, 0);
  await call("sv_connect_module", 0, inputModule, 0);
  const input = new Float32Array(512).fill(0.25);
  await call("sv_volume", 0, 256);
  await call("sv_play", 0);
  const output = await send({ type: "render", frames: 256, input });
  assert.ok(output.data.some((v) => Math.abs(v - 0.25) < 0.0001));
  await assert.rejects(send({ type: "render", frames: 256, input: new Float32Array(2) }), /frames \* 2/);
});


test("failed worker startup and disposal are terminal", async () => {
  const engine = createSunVoxEngine({ runtimeBaseUrl: "https://example.test/" });
  await assert.rejects(engine.initialize(), /Worker/);
  await assert.rejects(engine.initialize(), /disposed/);
  const pendingEngine = createSunVoxEngine({ runtimeBaseUrl: "https://example.test/" });
  const pending = pendingEngine.sv_get_ticks();
  pendingEngine.dispose();
  await assert.rejects(pending, /disposed/);
});


test("config strings and corrected sampler entry point reach native exports", async (t) => {
  const { call, receivedConfig } = await workerHarness(t, "buffer=512");
  assert.equal(receivedConfig, "buffer=512");
  await call("sv_open_slot", 0);
  const sampler = await call("sv_new_module", 0, "Sampler", "Sampler", 0, 0, 0);
  assert.ok(sampler > 0);
  assert.equal(typeof await call("sv_sampler_par", 0, sampler, 0, 0, 0, 0), "number");
  const synth = new Uint8Array(await readFile(new URL("instruments/mandel59 shepard.sunsynth", root)));
  assert.ok(await call("sv_load_module_from_memory", 0, synth, 0, 0, 0) > 0);
});

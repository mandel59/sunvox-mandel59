// Classic worker: upstream SunVox scripts use importScripts and global bindings.
let engineReady = false;
let engineMethods = null;
let engineQueue = Promise.resolve();
let outputPort = null;
let outputTimer = null;
let pendingOutputFrames = 0;
let sampleRate = 44100;
let outputFrame = 0;
let outputBaseTicks = 0;
const ENGINE_FLAGS = 1 | 2 | 8 | 16;
const MAX_BUFFER_ITEMS = 1048576;
const BLOCK_FRAMES = 128;
const MAX_QUEUED_FRAMES = 4096;
const EXCLUDED = new Set(["sv_init", "sv_deinit", "sv_lock_slot", "sv_unlock_slot", "sv_audio_callback", "sv_audio_callback2", "sv_update_input"]);

function bufferLength(value, name) {
  if (!Number.isInteger(value) || value < 0 || value > MAX_BUFFER_ITEMS) {
    throw new RangeError(`${name} must be an integer from 0 to ${MAX_BUFFER_ITEMS}`);
  }
  return value;
}

function withMemory(bytes, fn) {
  const pointer = svlib._malloc(Math.max(1, bytes));
  if (!pointer) throw new Error("SunVox allocation failed");
  try { return fn(pointer); } finally { svlib._free(pointer); }
}

function nativeString(value, fn) {
  const bytes = new TextEncoder().encode(value + "\0");
  return withMemory(bytes.length, (pointer) => {
    svlib.HEAPU8.set(bytes, pointer);
    return fn(pointer);
  });
}

async function initializeEngine(message) {
  if (engineReady) throw new Error("Engine already initialized");
  const base = message.runtimeBaseUrl;
  importScripts(new URL("sunvox.js", base).href);
  const factory = self.SunVoxLib;
  self.SunVoxLib = (options = {}) => factory({
    ...options,
    locateFile: (name) => new URL(name, base).href,
    print: (text) => self.postMessage({ type: "log", level: "log", message: String(text) }),
    printErr: (text) => self.postMessage({ type: "log", level: "warn", message: String(text) }),
  });
  importScripts(new URL("sunvox_lib_loader.js", base).href);
  svlib = await svlib;
  // The upstream sv_init wrapper drops the allocated config pointer.
  sv_flags = ENGINE_FLAGS;
  sv_channels = 2;
  sampleRate = message.sampleRate;
  const init = (pointer) => svlib._sv_init(pointer, sampleRate, 2, ENGINE_FLAGS);
  const version = message.config ? nativeString(message.config, init) : init(0);
  if (version < 0) throw new Error(`sv_init failed: ${version}`);
  sampleRate = sv_get_sample_rate();
  engineMethods = message.methods;
  engineReady = true;
  return { version, sampleRate, channels: 2 };
}

function validateCall(command) {
  const { method, args } = command ?? {};
  if (typeof method !== "string" || !/^sv_[a-z0-9_]+$/.test(method) || EXCLUDED.has(method) ||
      !Object.hasOwn(engineMethods, method) || !Object.hasOwn(self, method) || typeof self[method] !== "function") {
    throw new TypeError(`Unsupported SunVox method: ${method}`);
  }
  const spec = engineMethods[method];
  if (!Array.isArray(args) || args.length !== spec.args.length) throw new TypeError(`Invalid arguments for ${method}`);
  spec.args.forEach(([name, type], index) => {
    const value = args[index];
    const valid = type === "number" ? Number.isFinite(value) && Number.isInteger(value)
      : type === "string" ? typeof value === "string"
      : type === "Uint8Array" ? value instanceof Uint8Array : value instanceof Float32Array;
    if (!valid) throw new TypeError(`${method}: invalid ${name} (${type})`);
  });
  if (spec.args[0]?.[0] === "slot" && (args[0] < 0 || args[0] > 15)) throw new RangeError("slot must be 0..15");
  if (method === "sv_get_time_map") bufferLength(args[2], "len");
  if (method === "sv_get_module_scope2") bufferLength(args[3], "samples_to_read");
  if (method === "sv_module_curve") {
    bufferLength(args[4], "len");
    bufferLength(args[4] || args[3].length, "curve length");
    if (args[4] > args[3].length || ![0, 1].includes(args[5])) throw new RangeError("Invalid curve buffer length or direction");
  }
  return spec;
}

function readBuffer(Type, length, fn, input) {
  return withMemory(length * Type.BYTES_PER_ELEMENT, (pointer) => {
    if (input) svlib.HEAPU8.set(new Uint8Array(input.buffer, input.byteOffset, length * Type.BYTES_PER_ELEMENT), pointer);
    else svlib.HEAPU8.fill(0, pointer, pointer + length * Type.BYTES_PER_ELEMENT);
    const result = fn(pointer);
    // Snapshot before any subsequent call can change/grow the WASM heap.
    const data = new Type(svlib.HEAPU8.buffer, pointer, length).slice();
    return { result, data };
  });
}

function invokeCall({ method, args }) {
  let value;
  switch (method) {
    case "sv_get_pattern_event":
      // Upstream JS omits the line argument from its declaration.
      value = svlib._sv_get_pattern_event(args[0], args[1], args[2], args[3], args[4]); break;
    case "sv_sampler_par":
      // Upstream JS references the nonexistent _sv_sampler_set export.
      value = svlib._sv_sampler_par(args[0], args[1], args[2], args[3], args[4], args[5]); break;
    case "sv_set_song_name":
      value = nativeString(args[1], (pointer) => svlib._sv_set_song_name(args[0], pointer)); break;
    case "sv_get_time_map":
      value = readBuffer(Uint32Array, args[2], (pointer) => svlib._sv_get_time_map(args[0], args[1], args[2], pointer, args[3])); break;
    case "sv_get_module_scope2":
      value = readBuffer(Int16Array, args[3], (pointer) => svlib._sv_get_module_scope2(args[0], args[1], args[2], pointer, args[3]));
      value.data = value.data.slice(0, Math.max(0, Math.min(args[3], value.result))); break;
    case "sv_module_curve":
      {
        const length = args[4] || args[3].length;
        bufferLength(length, "curve length");
        value = length === 0 ? { result: 0, data: new Float32Array() }
          : readBuffer(Float32Array, length, (pointer) => svlib._sv_module_curve(args[0], args[1], args[2], pointer, length, args[5]), args[5] === 1 ? args[3] : null);
        break;
      }
    default: value = self[method](...args);
  }
  return ArrayBuffer.isView(value) ? value.slice() : value;
}

function executeCalls(commands, batch) {
  if (!Array.isArray(commands)) throw new TypeError("commands must be an array");
  const specs = commands.map(validateCall);
  if (batch && commands.some(({ method }) => /^(sv_open_slot|sv_close_slot|sv_save_to_memory)$/.test(method) || method.includes("load_from_memory") || method === "sv_load_module_from_memory")) {
    throw new Error("Slot lifecycle and memory loading/saving must be called outside batch");
  }
  const slots = [...new Set(commands.filter((_, i) => specs[i].lock).map((c) => c.args[0]))].sort((a, b) => a - b);
  const acquired = [];
  try {
    for (const slot of slots) {
      const result = sv_lock_slot(slot);
      if (result < 0) throw new Error(`sv_lock_slot failed: ${result}`);
      acquired.push(slot);
    }
    return commands.map(invokeCall);
  } finally {
    for (const slot of acquired.reverse()) sv_unlock_slot(slot);
  }
}

function renderFrames(message) {
  const frames = bufferLength(message.frames, "frames");
  const input = message.input;
  if (input != null && (!(input instanceof Float32Array) || input.length !== frames * 2)) throw new TypeError("input must contain frames * 2 Float32 samples");
  const latency = message.latency ?? 0;
  const time = message.time ?? sv_get_ticks();
  if (!Number.isInteger(latency) || latency < 0 || !Number.isInteger(time) || time < 0) throw new RangeError("Invalid audio latency/time");
  if (frames === 0) return { result: 0, data: new Float32Array() };
  if (input) sv_update_input();
  const data = new Float32Array(frames * 2);
  const result = sv_audio_callback2(data, frames, latency, time, input ? 1 : 0, input ? 2 : 0, input ?? null);
  return { result, data };
}

function stopOutput() {
  if (outputTimer !== null) clearInterval(outputTimer);
  outputTimer = null;
  pendingOutputFrames = 0;
  if (outputPort) { outputPort.postMessage({ type: "sunvox-clear" }); outputPort.close(); }
  outputPort = null;
}

function pumpOutput() {
  while (outputPort && pendingOutputFrames + BLOCK_FRAMES <= MAX_QUEUED_FRAMES) {
    const { result, data } = renderFrames({ frames: BLOCK_FRAMES, time: outputBaseTicks + Math.floor(outputFrame * sv_get_ticks_per_second() / sampleRate) });
    if (result < 0) { stopOutput(); throw new Error(`Audio render failed: ${result}`); }
    outputFrame += BLOCK_FRAMES;
    pendingOutputFrames += BLOCK_FRAMES;
    outputPort.postMessage({ type: "sunvox-audio", audioData: data }, [data.buffer]);
  }
}

function startOutput(port) {
  stopOutput();
  outputPort = port;
  outputFrame = 0;
  outputBaseTicks = sv_get_ticks();
  outputPort.onmessage = ({ data }) => {
    if (data?.type === "sunvox-consumed") pendingOutputFrames = Math.max(0, pendingOutputFrames - data.consumedFrames);
  };
  outputPort.start();
  pumpOutput();
  outputTimer = setInterval(() => {
    try { pumpOutput(); } catch (error) { self.postMessage({ type: "log", level: "warn", message: error.message }); }
  }, 2);
}

async function dispatch(message) {
  if (message.type === "initialize") return initializeEngine(message);
  if (!engineReady) throw new Error("Engine is not initialized");
  switch (message.type) {
    case "call": return executeCalls([message.command], false)[0];
    case "batch": return executeCalls(message.commands, true);
    case "render":
      if (outputPort) throw new Error("Stop browser audio before explicit rendering");
      return renderFrames(message);
    case "startAudio": startOutput(message.port); return;
    case "stopAudio": stopOutput(); return;
    default: throw new Error(`Unknown engine command: ${message.type}`);
  }
}

self.onmessage = ({ data }) => {
  engineQueue = engineQueue.then(async () => {
    try {
      const value = await dispatch(data);
      self.postMessage({ id: data.id, ok: true, value });
    } catch (error) {
      self.postMessage({ id: data.id, ok: false, error: error.message });
    }
  }).catch((error) => self.postMessage({ type: "log", level: "warn", message: error.message }));
};

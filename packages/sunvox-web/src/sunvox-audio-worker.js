let engineMethods = null;
const MAX_BUFFER_ITEMS = 1048576;
const EXCLUDED = new Set(["sv_init", "sv_deinit", "sv_lock_slot", "sv_unlock_slot", "sv_audio_callback", "sv_audio_callback2", "sv_update_input"]);
const DEFAULT_SAMPLE_RATE = 44100;
const DEFAULT_CHANNELS = 2;
const DEFAULT_RENDER_FRAMES = 128;
const DEFAULT_MAX_BUFFERED_FRAMES = 1024;
const DEFAULT_RENDER_INTERVAL_MS = 2;
const MAX_RENDER_BATCH = 8;

const WORKER_SV_INIT_FLAG_NO_DEBUG_OUTPUT = 1 << 0;
const WORKER_SV_INIT_FLAG_USER_AUDIO_CALLBACK = 1 << 1;
const WORKER_SV_INIT_FLAG_AUDIO_FLOAT32 = 1 << 3;
const WORKER_SV_INIT_FLAG_ONE_THREAD = 1 << 4;
const CONTROL_READ_INDEX = 0;
const CONTROL_WRITE_INDEX = 1;
const CONTROL_CAPACITY_FRAMES = 2;
const CONTROL_STATE = 4;
const CONTROL_GENERATION = 5;
const CONTROL_DROPPED_FRAMES = 8;
const OUTPUT_STOPPED = 0;
const OUTPUT_RUNNING = 1;

let initialized = false;
let ready = false;
let audioContextSampleRate = DEFAULT_SAMPLE_RATE;
let channels = DEFAULT_CHANNELS;
let renderFrames = DEFAULT_RENDER_FRAMES;
let maxBufferedFrames = DEFAULT_MAX_BUFFERED_FRAMES;
let renderIntervalMs = DEFAULT_RENDER_INTERVAL_MS;
let ticksPerSecond = 0;

let audioPort = null;
let sharedControl = null;
let sharedAudio = null;
let sharedCapacityFrames = 0;
let renderTimer = null;
let renderScheduled = false;
let rendering = false;
let renderBaseTicks = 0;
let frameCursor = 0;
let pendingFrames = 0;
let idleStop = null;
let idleFrames = 0;
let commandQueue = Promise.resolve();
function isSunvoxInitialized() {
  return typeof sv_init === "function" && typeof sv_load_from_memory === "function";
}

function isSunvoxRuntimeLoaded() {
  return typeof SunVoxLib === "function";
}

function configureSunVoxLibLoader(sunvoxJsUrl) {
  if (typeof SunVoxLib !== "function") {
    return;
  }
  if (SunVoxLib.__sunvoxWorkerPatched) {
    return;
  }
  const originalFactory = SunVoxLib;
  const baseUrl = new URL(".", new URL(sunvoxJsUrl, self.location.href).href).href;
  const patched = (moduleArg = {}) =>
    originalFactory({
      ...moduleArg,
      locateFile: moduleArg.locateFile || ((fileName) => new URL(fileName, baseUrl).href),
      print: moduleArg.print || ((text) => postLog("log", String(text))),
      printErr: moduleArg.printErr || ((text) => postLog("warn", String(text))),
    });
  patched.__sunvoxWorkerPatched = true;
  self.SunVoxLib = patched;
}

async function ensureSunVoxRuntimeReady() {
  if (typeof svlib === "undefined") {
    return;
  }
  if (typeof svlib.then !== "function") {
    return;
  }
  const module = await svlib;
  if (!module || typeof module._sv_init !== "function") {
    throw new Error("SunVox runtime failed to initialize");
  }
  svlib = module;
}

function safeImportScripts(url) {
  try {
    importScripts(url);
    return;
  } catch (error) {
    const message = error?.message ?? "";
    const redeclared = typeof message === "string" && message.includes("already been declared");
    postLog("warn", `importScripts failed: ${url} message=${message}`);
    if (!redeclared) {
      throw error;
    }
    if (!isSunvoxInitialized()) {
      throw error;
    }
  }
}

function ensureSunvoxLibraries(sunvoxJsUrl, sunvoxLoaderJsUrl) {
  if (!isSunvoxRuntimeLoaded()) {
    safeImportScripts(sunvoxJsUrl);
  }
  if (!isSunvoxInitialized()) {
    configureSunVoxLibLoader(sunvoxJsUrl);
    safeImportScripts(sunvoxLoaderJsUrl);
    if (!isSunvoxInitialized()) {
      throw new Error("SunVox loader initialization failed");
    }
  }
}

function postToMain(message) {
  self.postMessage(message);
}

function postCommandResult(id, payload, error) {
  if (!id) {
    return;
  }
  postToMain({
    type: "command-result",
    id,
    ok: error == null,
    payload,
    error: error ? error.message ?? String(error) : null,
  });
}

function postLog(level, message) {
  postToMain({ type: "log", level, message });
}

function ensureReadyState() {
  if (!initialized || !ready) {
    throw new Error("SunVox engine is not initialized");
  }
}

function setSharedAudio(sharedAudioMessage) {
  if (!sharedAudioMessage?.controlBuffer || !sharedAudioMessage?.audioBuffer) {
    sharedControl = null;
    sharedAudio = null;
    sharedCapacityFrames = 0;
    return;
  }
  sharedControl = new Int32Array(sharedAudioMessage.controlBuffer);
  sharedAudio = new Float32Array(sharedAudioMessage.audioBuffer);
  sharedCapacityFrames = Atomics.load(sharedControl, CONTROL_CAPACITY_FRAMES);
}

function sharedAvailableFrames(readIndex, writeIndex) {
  if (!sharedCapacityFrames) {
    return 0;
  }
  if (writeIndex >= readIndex) {
    return writeIndex - readIndex;
  }
  return sharedCapacityFrames - readIndex + writeIndex;
}

function sharedBufferedFrames() {
  if (!sharedControl || !sharedCapacityFrames) {
    return 0;
  }
  const readIndex = Atomics.load(sharedControl, CONTROL_READ_INDEX);
  const writeIndex = Atomics.load(sharedControl, CONTROL_WRITE_INDEX);
  return sharedAvailableFrames(readIndex, writeIndex);
}

function sharedFreeFrames() {
  if (!sharedControl || !sharedCapacityFrames) {
    return 0;
  }
  return sharedCapacityFrames - sharedBufferedFrames() - 1;
}

function writeSharedAudio(floatData) {
  if (!sharedControl || !sharedAudio || !sharedCapacityFrames) {
    return false;
  }
  const frames = floatData.length / channels;
  if (sharedFreeFrames() < frames) {
    Atomics.add(sharedControl, CONTROL_DROPPED_FRAMES, frames);
    return false;
  }

  let writeIndex = Atomics.load(sharedControl, CONTROL_WRITE_INDEX);
  let source = 0;
  let remainingFrames = frames;
  while (remainingFrames > 0) {
    const writableFrames = Math.min(remainingFrames, sharedCapacityFrames - writeIndex);
    let target = writeIndex * channels;
    const sampleCount = writableFrames * channels;
    for (let index = 0; index < sampleCount; index += 1) {
      sharedAudio[target + index] = floatData[source + index];
    }
    source += sampleCount;
    remainingFrames -= writableFrames;
    writeIndex = (writeIndex + writableFrames) % sharedCapacityFrames;
  }
  Atomics.store(sharedControl, CONTROL_WRITE_INDEX, writeIndex);
  return true;
}

function setOutputRunning(nextRunning) {
  if (sharedControl) {
    Atomics.store(sharedControl, CONTROL_STATE, nextRunning ? OUTPUT_RUNNING : OUTPUT_STOPPED);
  }
}

function flushAudioOutput() {
  pendingFrames = 0;
  if (sharedControl) {
    Atomics.store(sharedControl, CONTROL_READ_INDEX, 0);
    Atomics.store(sharedControl, CONTROL_WRITE_INDEX, 0);
    Atomics.add(sharedControl, CONTROL_GENERATION, 1);
  }
  if (audioPort) {
    audioPort.postMessage({ type: "sunvox-clear" });
  }
}

function postAudioChunk(floatData) {
  if (!(floatData instanceof Float32Array) || floatData.length === 0) {
    return false;
  }
  const frames = floatData.length / channels;
  if (sharedControl) {
    return writeSharedAudio(floatData);
  }
  if (!audioPort) {
    return false;
  }
  pendingFrames += frames;
  if (pendingFrames > maxBufferedFrames) {
    pendingFrames -= frames;
    return false;
  }
  audioPort.postMessage({ type: "sunvox-audio", audioData: floatData }, [floatData.buffer]);
  return true;
}

function framesToTicks(frameCount) {
  if (!ticksPerSecond || !audioContextSampleRate) {
    return renderBaseTicks;
  }
  return (renderBaseTicks + Math.floor((frameCount * ticksPerSecond) / audioContextSampleRate)) >>> 0;
}

function outputBufferedFrames() {
  if (sharedControl) {
    return sharedBufferedFrames();
  }
  return pendingFrames;
}

function outputFreeFrames() { return Math.max(0, maxBufferedFrames - outputBufferedFrames()); }
function renderOneChunk() {
  if (outputFreeFrames() < renderFrames) {
    return true;
  }
  const outBuffer = new Float32Array(renderFrames * channels);
  const result = sv_audio_callback(outBuffer, renderFrames, 0, framesToTicks(frameCursor));
  frameCursor += renderFrames;
  if (result < 0) {
    return false;
  }
  if (idleStop) {
    const silent = outBuffer.every((sample) => Math.abs(sample) <= idleStop.threshold);
    idleFrames = silent ? idleFrames + renderFrames : 0;
    if (idleFrames >= idleStop.seconds * audioContextSampleRate) {
      stopAudioOutput();
      return true;
    }
  }
  postAudioChunk(outBuffer);
  return true;
}

function renderAudioStep() {
  if (!ready || !rendering) {
    return;
  }
  if (outputFreeFrames() < renderFrames) {
    return;
  }
  let chunkCount = 0;
  while (rendering && outputFreeFrames() >= renderFrames && chunkCount < MAX_RENDER_BATCH) {
    chunkCount += 1;
    const keepRendering = renderOneChunk();
    if (!keepRendering) {
      stopAudioOutput();
      break;
    }
  }
}

function startRenderLoop() {
  if (renderScheduled) {
    return;
  }
  renderScheduled = true;
  renderTimer = setInterval(() => {
    if (!renderScheduled) {
      return;
    }
    renderAudioStep();
  }, renderIntervalMs);
}

function stopRenderLoop() {
  if (!renderScheduled) {
    return;
  }
  renderScheduled = false;
  clearInterval(renderTimer);
  renderTimer = null;
}

function startAudioOutput({ resetQueue = false, resetClock = false } = {}) {
  if (resetClock) {
    frameCursor = 0;
    renderBaseTicks = sv_get_ticks();
  }
  if (resetQueue) {
    flushAudioOutput();
  }
  rendering = true;
  renderAudioStep();
  setOutputRunning(true);
  startRenderLoop();
}

function stopAudioOutput({ flush = true } = {}) {
  rendering = false;
  setOutputRunning(false);
  if (flush) {
    flushAudioOutput();
  }
  stopRenderLoop();
}

function setAudioPort(port) {
  if (audioPort) {
    audioPort.onmessage = null;
    audioPort.close();
  }
  audioPort = port || null;
  if (!audioPort) {
    return;
  }
  audioPort.onmessage = (event) => {
    const message = event.data || {};
    if (message.type !== "sunvox-consumed") {
      return;
    }
    const consumedFrames = Number(message.consumedFrames);
    if (Number.isFinite(consumedFrames) && consumedFrames > 0) {
      pendingFrames = Math.max(0, pendingFrames - consumedFrames);
    }
  };
}

async function initialize(message) {
  if (initialized) throw new Error("Engine already initialized");
  audioContextSampleRate = message.sampleRate;
  const sunvoxJsUrl = new URL("sunvox.js", message.runtimeBaseUrl).href;
  const sunvoxLoaderJsUrl = new URL("sunvox_lib_loader.js", message.runtimeBaseUrl).href;
  ensureSunvoxLibraries(sunvoxJsUrl, sunvoxLoaderJsUrl);
  await ensureSunVoxRuntimeReady();
  const flags = WORKER_SV_INIT_FLAG_NO_DEBUG_OUTPUT | WORKER_SV_INIT_FLAG_USER_AUDIO_CALLBACK |
    WORKER_SV_INIT_FLAG_AUDIO_FLOAT32 | WORKER_SV_INIT_FLAG_ONE_THREAD;
  sv_flags = flags;
  sv_channels = 2;
  const init = (pointer) => svlib._sv_init(pointer, audioContextSampleRate, 2, flags);
  const version = message.config ? nativeString(message.config, init) : init(0);
  if (version < 0) throw new Error(`sv_init failed: ${version}`);
  audioContextSampleRate = sv_get_sample_rate();
  ticksPerSecond = sv_get_ticks_per_second();
  engineMethods = message.methods;
  initialized = true;
  ready = true;
  return { version, sampleRate: audioContextSampleRate, channels: 2 };
}

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

function executeCalls(commands, batch, eventTime) {
  if (!Array.isArray(commands)) throw new TypeError("commands must be an array");
  const specs = commands.map(validateCall);
  if (batch && commands.some(({ method }) => /^(sv_open_slot|sv_close_slot|sv_save_to_memory)$/.test(method) || method.includes("load_from_memory") || method === "sv_load_module_from_memory")) {
    throw new Error("Slot lifecycle and memory loading/saving must be called outside batch");
  }
  const slots = [...new Set(commands.filter((_, i) => specs[i].lock).map((c) => c.args[0]))].sort((a, b) => a - b);
  if (eventTime !== undefined && eventTime !== "render") throw new TypeError('eventTime must be "render"');
  if (eventTime && commands.some(({ method }) => method === "sv_set_event_t")) throw new Error("Scheduled batches cannot contain sv_set_event_t");
  const eventSlots = eventTime ? [...new Set(commands.filter((c) => c.method === "sv_send_event").map((c) => c.args[0]))] : [];
  const timed = [];
  const acquired = [];
  try {
    for (const slot of slots) {
      const result = sv_lock_slot(slot);
      if (result < 0) throw new Error(`sv_lock_slot failed: ${result}`);
      acquired.push(slot);
    }
    const eventTicks = eventTime ? (rendering ? framesToTicks(frameCursor) : sv_get_ticks() >>> 0) : 0;
    for (const slot of eventSlots) {
      const result = sv_set_event_t(slot, 1, eventTicks);
      if (result < 0) throw new Error('sv_set_event_t failed: ' + result);
      timed.push(slot);
    }
    return commands.map(invokeCall);
  } finally {
    for (const slot of timed) sv_set_event_t(slot, 0, 0);
    for (const slot of acquired.reverse()) sv_unlock_slot(slot);
  }
}

function renderEngineFrames(message) {
  const frames = bufferLength(message.frames, "frames");
  const input = message.input;
  if (input != null && (!(input instanceof Float32Array) || input.length !== frames * 2)) throw new TypeError("input must contain frames * 2 Float32 samples");
  const latency = message.latency ?? 0;
  const time = message.time ?? (sv_get_ticks() >>> 0);
  if (!Number.isInteger(latency) || latency < 0 || !Number.isInteger(time) || time < 0) throw new RangeError("Invalid audio latency/time");
  if (frames === 0) return { result: 0, data: new Float32Array() };
  if (input) sv_update_input();
  const data = new Float32Array(frames * 2);
  const result = sv_audio_callback2(data, frames, latency, time, input ? 1 : 0, input ? 2 : 0, input ?? null);
  return { result, data };
}


function runCommand({ payload }) {
  if (payload?.type !== "initialize") ensureReadyState();
  switch (payload?.type) {
    case "initialize": return initialize(payload);
    case "configureAudio":
      setSharedAudio(payload.sharedAudio);
      maxBufferedFrames = sharedControl ? 512 : 2048;
      setAudioPort(payload.port);
      return;
    case "engineStartAudio":
      idleStop = null; idleFrames = 0;
      startAudioOutput({ resetClock: !rendering });
      return;
    case "enginePauseAudio": return stopAudioOutput({ flush: true });
    case "engineStopAudio":
      stopAudioOutput({ flush: true });
      setAudioPort(null);
      setSharedAudio(null);
      return;
    case "setOutputGain":
      audioPort?.postMessage({ type: "sunvox-master-volume", gain: payload.gain });
      return;
    case "pauseAudioWhenSilent":
      if (!Number.isFinite(payload.seconds) || payload.seconds <= 0 || !Number.isFinite(payload.threshold) || payload.threshold < 0) throw new RangeError("Invalid silence duration or threshold");
      idleStop = { seconds: payload.seconds, threshold: payload.threshold };
      idleFrames = 0;
      return;
    case "call": return executeCalls([payload.command], false)[0];
    case "batch": return executeCalls(payload.commands, true, payload.eventTime);
    case "render":
      if (audioPort) throw new Error("Stop browser audio before explicit rendering");
      return renderEngineFrames(payload);
    default: throw new Error('Unknown command: ' + payload?.type);
  }
}

function runCommandSafe(message) {
  try {
    const result = runCommand(message);
    if (result && typeof result.then === "function") {
      return result
        .then((payload) => ({ payload }))
        .catch((error) => ({ error }));
    }
    return Promise.resolve({ payload: result });
  } catch (error) {
    return Promise.resolve({ error });
  }
}

function finishCommand(message, outcome) {
  if (outcome.error) {
    postCommandResult(message.id, null, outcome.error);
    return;
  }
  postCommandResult(message.id, outcome.payload);
}

function queueCommand(message) {
  const runNext = () => runCommandSafe(message).then((outcome) => finishCommand(message, outcome));
  commandQueue = commandQueue.then(runNext).catch(() => {});
  return commandQueue;
}

onmessage = ({ data }) => {
  if (data?.type === "command") queueCommand(data);
};

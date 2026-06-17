const DEFAULT_SAMPLE_RATE = 44100;
const DEFAULT_CHANNELS = 2;
const DEFAULT_RENDER_FRAMES = 256;
const DEFAULT_MAX_BUFFERED_FRAMES = 65536;
const DEFAULT_RENDER_INTERVAL_MS = 5;
const MAX_RENDER_BATCH = 16;

const WORKER_SV_INIT_FLAG_NO_DEBUG_OUTPUT = 1 << 0;
const WORKER_SV_INIT_FLAG_USER_AUDIO_CALLBACK = 1 << 1;
const WORKER_SV_INIT_FLAG_AUDIO_FLOAT32 = 1 << 3;
const WORKER_SV_INIT_FLAG_ONE_THREAD = 1 << 4;
const NOTE_OFF = 128;
const ALL_NOTES_OFF = 129;
const NOTE_TRACK_COUNT = 32;
const INSTRUMENT_OUTPUT_MODULE = 0;
const DEFAULT_SYNTH_X = 256;
const DEFAULT_SYNTH_Y = 256;
const DEFAULT_SYNTH_Z = 0;

let initialized = false;
let ready = false;
let audioContextSampleRate = DEFAULT_SAMPLE_RATE;
let channels = DEFAULT_CHANNELS;
let renderFrames = DEFAULT_RENDER_FRAMES;
let maxBufferedFrames = DEFAULT_MAX_BUFFERED_FRAMES;
let renderIntervalMs = DEFAULT_RENDER_INTERVAL_MS;
let ticksPerSecond = 0;

let audioPort = null;
let renderTimer = null;
let renderScheduled = false;
let playing = false;
let frameCursor = 0;
let pendingFrames = 0;
let isLoading = false;

let loadedResourceUrl = "";
let loadedSynthModule = -1;
let loadedBytes = 0;
let latestLoadRequestSerial = 0;
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

const synthControllerPresets = new Map();
let commandQueue = Promise.resolve();

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

function postStatus(text) {
  postToMain({ type: "status", text });
}

function postPlayerState() {
  postToMain({
    type: "player-state",
    payload: {
      ready,
      isPlaying: playing,
      isLoading,
      loadedPath: loadedResourceUrl,
      loadingPath: "",
    },
  });
}

function postLog(level, message) {
  postToMain({ type: "log", level, message });
}

function withSlotLock(fn) {
  const lockResult = sv_lock_slot(0);
  if (lockResult < 0) {
    throw new Error(`sv_lock_slot failed: ${lockResult}`);
  }
  try {
    return fn();
  } finally {
    sv_unlock_slot(0);
  }
}

function postAudioChunk(floatData) {
  if (!audioPort || !(floatData instanceof Float32Array) || floatData.length === 0) {
    return;
  }
  const frames = floatData.length / channels;
  pendingFrames += frames;
  if (pendingFrames > maxBufferedFrames) {
    pendingFrames -= frames;
    return;
  }
  audioPort.postMessage({ type: "sunvox-audio", audioData: floatData }, [floatData.buffer]);
}

function framesToTicks(frameCount) {
  if (!ticksPerSecond || !audioContextSampleRate) {
    return 0;
  }
  return Math.floor((frameCount * ticksPerSecond) / audioContextSampleRate);
}

function renderOneChunk() {
  const outBuffer = new Float32Array(renderFrames * channels);
  const result = sv_audio_callback(outBuffer, renderFrames, 0, framesToTicks(frameCursor));
  frameCursor += renderFrames;
  if (result < 0) {
    return false;
  }
  postAudioChunk(outBuffer);
  return true;
}

function renderAudioStep() {
  if (!ready || !playing) {
    return;
  }
  if (pendingFrames >= maxBufferedFrames) {
    return;
  }
  let chunkCount = 0;
  while (playing && pendingFrames < maxBufferedFrames && chunkCount < MAX_RENDER_BATCH) {
    chunkCount += 1;
    const keepPlaying = renderOneChunk();
    if (!keepPlaying) {
      stopInternal();
      break;
    }
  }
}

function ensureReadyState() {
  if (!initialized || !ready) {
    throw new Error("SunVox engine is not initialized");
  }
}

function clearRenderState() {
  frameCursor = 0;
  pendingFrames = 0;
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

function stopInternal(updateState = true) {
  if (!ready) {
    return;
  }
  if (!playing) {
    return;
  }
  playing = false;
  try {
    sv_stop(0);
  } finally {
    clearAudioQueue();
    stopRenderLoop();
    if (updateState) {
      postPlayerState();
    }
  }
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

function clearAudioQueue() {
  if (!audioPort) {
    return;
  }
  audioPort.postMessage({ type: "sunvox-clear" });
}

function reopenSlot() {
  const closeResult = sv_close_slot(0);
  if (closeResult < 0) {
    throw new Error(`sv_close_slot failed: ${closeResult}`);
  }
  const openResult = sv_open_slot(0);
  if (openResult < 0) {
    throw new Error(`sv_open_slot failed: ${openResult}`);
  }
  loadedSynthModule = -1;
}

function normalizedControllerIndex(controllerIndex) {
  return Math.max(0, Math.min(126, Math.round(controllerIndex)));
}

function normalizedControllerValue(value) {
  return Math.max(0, Math.min(32768, Math.round(value)));
}

function setLoadedSynthController(moduleIndex, controllerIndex, value) {
  const scaledValue = normalizedControllerValue(value);
  const index = normalizedControllerIndex(controllerIndex);
  const result = sv_set_module_ctl_value(0, moduleIndex, index, scaledValue, 0);
  if (result < 0) {
    throw new Error(`sv_set_module_ctl_value failed: ${result}`);
  }
  return true;
}

function applySynthPreset(url, moduleIndex) {
  const preset = synthControllerPresets.get(url);
  if (!preset) {
    return true;
  }
  let applied = true;
  for (const [controllerIndex, value] of preset) {
    try {
      applied = setLoadedSynthController(moduleIndex, controllerIndex, value) && applied;
    } catch (error) {
      applied = false;
      postLog("warn", `Failed controller set ${controllerIndex}=${value} for ${url}: ${error.message}`);
    }
  }
  return applied;
}

function noteTrack(note) {
  const normalized = Math.round(note);
  if (!Number.isFinite(normalized)) {
    return 0;
  }
  const wrapped = normalized % NOTE_TRACK_COUNT;
  return wrapped < 0 ? wrapped + NOTE_TRACK_COUNT : wrapped;
}

function normalizedNote(note) {
  return Math.max(1, Math.min(127, Math.round(note) + 1));
}

function normalizedVelocity(velocity) {
  return Math.max(1, Math.min(129, Math.round(velocity)));
}

function isCurrentLoadRequest(requestSerial) {
  if (!Number.isFinite(requestSerial)) {
    return true;
  }
  return requestSerial === latestLoadRequestSerial;
}

async function fetchBytes(url) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${url}`);
  }
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (!bytes.length) {
    throw new Error(`Empty file: ${url}`);
  }
  return bytes;
}

async function loadSongFromUrl(url, requestSerial) {
  ensureReadyState();
  if (!isCurrentLoadRequest(requestSerial)) {
    return { cancelled: true };
  }
  isLoading = true;
  loadedResourceUrl = "";
  loadedSynthModule = -1;
  clearAudioQueue();
  stopInternal(false);
  clearRenderState();
  postStatus("Loading the file...");
  postPlayerState();

  try {
    const bytes = await fetchBytes(url);
    if (!isCurrentLoadRequest(requestSerial)) {
      return { cancelled: true };
    }
    withSlotLock(() => {
      const loadResult = sv_load_from_memory(0, bytes);
      if (loadResult < 0) {
        throw new Error(`sv_load_from_memory failed: ${loadResult}`);
      }
    });

    loadedResourceUrl = url;
    loadedBytes = bytes.byteLength;
    return { path: loadedResourceUrl, byteLength: loadedBytes };
  } finally {
    isLoading = false;
    clearRenderState();
    postPlayerState();
  }
}

async function playProject(url, requestSerial) {
  const loaded = await loadSongFromUrl(url, requestSerial);
  if (loaded.cancelled || !isCurrentLoadRequest(requestSerial)) {
    return { cancelled: true };
  }
  startPlayback();
  return { loadedPath: url };
}

async function loadSynthFromUrl(url, reuseExisting = true) {
  ensureReadyState();
  if (reuseExisting && loadedResourceUrl === url && loadedSynthModule >= 0) {
    return loadedSynthModule;
  }

  isLoading = true;
  loadedResourceUrl = "";
  loadedSynthModule = -1;
  stopInternal(false);
  clearRenderState();
  postStatus("Loading the instrument...");
  postPlayerState();

  try {
    const bytes = await fetchBytes(url);
    reopenSlot();
    const moduleIndex = sv_load_module_from_memory(0, bytes, DEFAULT_SYNTH_X, DEFAULT_SYNTH_Y, DEFAULT_SYNTH_Z);
    if (moduleIndex < 0) {
      throw new Error(`sv_load_module_from_memory failed: ${moduleIndex}`);
    }

    const connectResult = withSlotLock(() => sv_connect_module(0, moduleIndex, INSTRUMENT_OUTPUT_MODULE));
    if (connectResult < 0) {
      throw new Error(`sv_connect_module failed: ${connectResult}`);
    }

    const playResult = sv_play(0);
    if (playResult < 0) {
      throw new Error(`sv_play failed: ${playResult}`);
    }

    loadedResourceUrl = url;
    loadedSynthModule = moduleIndex;
    loadedBytes = bytes.byteLength;
    applySynthPreset(url, moduleIndex);
    return moduleIndex;
  } finally {
    isLoading = false;
    clearRenderState();
    postPlayerState();
  }
}

function startPlayback() {
  ensureReadyState();
  if (!loadedResourceUrl) {
    throw new Error("No project loaded");
  }
  clearRenderState();
  clearAudioQueue();

  const playResult = sv_play_from_beginning(0);
  if (playResult < 0) {
    throw new Error(`sv_play_from_beginning failed: ${playResult}`);
  }

  playing = true;
  startRenderLoop();
  postPlayerState();
}

function configureSynthControllers(url, controllers) {
  ensureReadyState();
  const preset = new Map();
  for (const controller of controllers) {
    if (!Number.isFinite(controller?.controllerIndex) || !Number.isFinite(controller?.value)) {
      continue;
    }
    preset.set(normalizedControllerIndex(controller.controllerIndex), normalizedControllerValue(controller.value));
  }
  synthControllerPresets.set(url, preset);
  if (loadedResourceUrl === url && loadedSynthModule >= 0) {
    return applySynthPreset(url, loadedSynthModule);
  }
  return true;
}

function stopPlayback() {
  stopInternal();
  postStatus("Stopped");
  return { stopped: true };
}

function applyVolume(volume) {
  ensureReadyState();
  const normalized = Math.max(0, Math.min(256, Math.round(volume)));
  sv_volume(0, normalized);
}

async function noteOn(payload) {
  ensureReadyState();
  const url = payload.url;
  const note = Number(payload.note);
  if (!url || !Number.isFinite(note)) {
    throw new Error("Missing note data");
  }
  const moduleIndex = await loadSynthFromUrl(url, true);
  const result = sv_send_event(
    0,
    noteTrack(payload.track ?? note),
    normalizedNote(note),
    normalizedVelocity(payload.velocity),
    moduleIndex + 1,
    0,
    0,
  );
  if (result < 0) {
    throw new Error(`sv_send_event (note on) failed: ${result}`);
  }
  return true;
}

function noteOff(payload) {
  ensureReadyState();
  if (payload?.note === ALL_NOTES_OFF) {
    const stopAllResult = sv_send_event(0, 0, ALL_NOTES_OFF, 0, 0, 0, 0);
    if (stopAllResult < 0) {
      throw new Error(`sv_send_event (all notes off) failed: ${stopAllResult}`);
    }
    return true;
  }

  if (loadedSynthModule < 0) {
    return false;
  }
  const note = Number(payload.note);
  const track = noteTrack(payload.track ?? 0);
  const noteValue = note === ALL_NOTES_OFF ? ALL_NOTES_OFF : NOTE_OFF;
  const result = sv_send_event(
    0,
    track,
    noteValue,
    0,
    loadedSynthModule + 1,
    0,
    0,
  );
  if (result < 0) {
    throw new Error(`sv_send_event (note off) failed: ${result}`);
  }
  return true;
}

function stopAllSynthNotes() {
  ensureReadyState();
  return noteOff({ track: 0, note: ALL_NOTES_OFF });
}

function setController(payload) {
  ensureReadyState();
  const moduleIndex = loadedResourceUrl === payload.url ? loadedSynthModule : -1;
  if (moduleIndex < 0) {
    return false;
  }
  return setLoadedSynthController(moduleIndex, payload.controllerIndex, payload.value);
}

async function initialize(message) {
  if (initialized) {
    return { ready };
  }
  audioContextSampleRate = Number(message.sampleRate) || DEFAULT_SAMPLE_RATE;
  channels = Number(message.channels) || DEFAULT_CHANNELS;
  renderFrames = Number(message.renderFrames) || DEFAULT_RENDER_FRAMES;
  maxBufferedFrames = Number(message.maxBufferedFrames) || DEFAULT_MAX_BUFFERED_FRAMES;
  renderIntervalMs = Number(message.renderIntervalMs) || DEFAULT_RENDER_INTERVAL_MS;

  const sunvoxJsUrl = message.sunvoxJsUrl;
  const sunvoxLoaderJsUrl = message.sunvoxLoaderJsUrl;
  if (!sunvoxJsUrl || !sunvoxLoaderJsUrl) {
    throw new Error("Missing SunVox URLs");
  }

  ensureSunvoxLibraries(sunvoxJsUrl, sunvoxLoaderJsUrl);
  await ensureSunVoxRuntimeReady();

  const initFlags = WORKER_SV_INIT_FLAG_NO_DEBUG_OUTPUT |
    WORKER_SV_INIT_FLAG_USER_AUDIO_CALLBACK |
    WORKER_SV_INIT_FLAG_AUDIO_FLOAT32 |
    WORKER_SV_INIT_FLAG_ONE_THREAD;
  // NOTE: USER_AUDIO_CALLBACK keeps SunVox in pull-mode so the worker can call sv_audio_callback().
  // sda_ctx is only used by SunVox internal web-audio callback mode and should remain off in this flow.
  if (typeof sda_ctx === "undefined") {
    self.sda_ctx = null;
  }
  if (typeof sda_node === "undefined") {
    self.sda_node = null;
  }
  const initResult = sv_init(0, audioContextSampleRate, channels, initFlags);
  if (initResult < 0) {
    throw new Error(`sv_init failed: ${initResult}`);
  }
  const openResult = sv_open_slot(0);
  if (openResult < 0) {
    throw new Error(`sv_open_slot failed: ${openResult}`);
  }

  ticksPerSecond = sv_get_ticks_per_second();
  initialized = true;
  ready = true;
  postStatus("Select a music file");
  postPlayerState();
  return { ready, sampleRate: audioContextSampleRate };
}

function runCommand(message) {
  const { payload } = message;
  if (payload?.type !== "initialize" && payload?.type !== "setAudioPort") {
    ensureReadyState();
  }

  switch (payload?.type) {
    case "initialize":
      return initialize(payload);
    case "setAudioPort":
      setAudioPort(payload.port);
      return { audioPortAttached: !!audioPort };
    case "loadAndPlay":
      return playProject(payload.url, payload.requestSerial);
    case "play":
      return startPlayback();
    case "stop":
      return stopPlayback();
    case "reopenSlot":
      reopenSlot();
      loadedResourceUrl = "";
      loadedSynthModule = -1;
      loadedBytes = 0;
      clearRenderState();
      postPlayerState();
      return { reopened: true };
    case "setMasterVolume":
      applyVolume(payload.volume);
      return { volume: payload.volume };
    case "noteOn":
      return noteOn(payload);
    case "noteOff":
      return noteOff(payload);
    case "stopAllSynthNotes":
      return { stopped: stopAllSynthNotes() };
    case "configureSynthControllers":
      return { configured: configureSynthControllers(payload.url, payload.controllers || []) };
    case "setController":
      return { controllerSet: setController(payload) };
    default:
      throw new Error(`Unknown command: ${payload?.type}`);
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

function queueCommand(message) {
  const runNext = () =>
    runCommandSafe(message).then((outcome) => {
      if (outcome.error) {
        postCommandResult(message.id, null, outcome.error);
        return;
      }
      postCommandResult(message.id, outcome.payload ?? {});
    });

  commandQueue = commandQueue.then(runNext).catch(() => {});
  return commandQueue;
}

onmessage = (event) => {
  const message = event.data || {};
  if (message.type === "status") {
    postPlayerState();
    return;
  }
  if (message.type === "ready-check") {
    postToMain({ type: "ready-state", ready });
    return;
  }
  if (message.type !== "command") {
    return;
  }
  if (!message.payload || !message.payload.type) {
    postCommandResult(message.id, null, new Error("Missing command type"));
    return;
  }

  if (message.payload.type === "loadAndPlay" && Number.isFinite(message.payload.requestSerial)) {
    latestLoadRequestSerial = message.payload.requestSerial;
  }

  queueCommand({
    id: message.id,
    payload: message.payload,
  });
};

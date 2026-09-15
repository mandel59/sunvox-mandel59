let engineMethods = null;
let engineContinuousOutput = false;
const engineOpenSlots = new Set();
let playerOwner = null;
let playerAbort = null;
const MAX_BUFFER_ITEMS = 1048576;
const EXCLUDED = new Set(["sv_init", "sv_deinit", "sv_lock_slot", "sv_unlock_slot", "sv_audio_callback", "sv_audio_callback2", "sv_update_input"]);

function playerSlots() { return [activeProject, stagingProject, ...synthSlots]; }

function assertPlayerSlotAccess(method, args) {
  if (!playerOwner || !playerSlots().some((state) => state.slot === args?.[0])) return;
  const protectedMethods = new Set([
    "sv_open_slot", "sv_close_slot", "sv_load_from_memory", "sv_play", "sv_play_from_beginning",
    "sv_stop", "sv_pause", "sv_resume", "sv_sync_resume", "sv_rewind", "sv_set_autostop",
  ]);
  if (protectedMethods.has(method) || (method === "sv_send_event" && [131, 132].includes(args[2]))) {
    throw new Error(`${method}: slot ${args[0]} is owned by Player; use its lifecycle/transport API`);
  }
  if (method === "sv_remove_module" && synthSlots.some((s) => s.slot === args[0] && s.loaded && s.moduleIndex === args[1])) {
    throw new Error("Cannot remove a cached Player instrument root; use Player to replace the instrument");
  }
}

function attachPlayer(payload) {
  if (playerOwner) throw new Error("Engine already has a Player");
  const base = payload.slotBase;
  if (!Number.isInteger(base) || base < 0 || base > 10) throw new RangeError("slotBase must be 0..10");
  const slots = Array.from({ length: 6 }, (_, i) => base + i);
  if (slots.some((slot) => engineOpenSlots.has(slot))) throw new Error("Player slots overlap existing Engine slots");
  const opened = [];
  try {
    for (const slot of slots) {
      const result = sv_open_slot(slot);
      if (result < 0) throw new Error(`sv_open_slot(${slot}) failed: ${result}`);
      opened.push(slot);
    }
  } catch (error) {
    for (const slot of opened) sv_close_slot(slot);
    throw error;
  }
  playerSlots().forEach((state, i) => { resetSlotState(state); state.slot = slots[i]; });
  for (const slot of slots) engineOpenSlots.add(slot);
  playerOwner = payload.owner;
  playerAbort = new AbortController();
  return { project: base, staging: base + 1, synths: slots.slice(2) };
}

function detachPlayer(owner) {
  if (playerOwner !== owner) return;
  playerAbort?.abort();
  for (const state of playerSlots()) {
    sv_close_slot(state.slot);
    engineOpenSlots.delete(state.slot);
    resetSlotState(state);
  }
  playerOwner = null;
  playerAbort = null;
  projectPlaying = false;
  projectTailDraining = false;
  isLoading = false;
  loadingPath = "";
  lastTouchedSynthSlot = null;
  synthControllerPresets.clear();
  latestLoadRequestSerial = 0;
  stopAudioOutput({ flush: true });
}

const DEFAULT_SAMPLE_RATE = 44100;
const DEFAULT_CHANNELS = 2;
const DEFAULT_RENDER_FRAMES = 128;
const DEFAULT_MAX_BUFFERED_FRAMES = 1024;
const SHARED_INTERACTIVE_MAX_BUFFERED_FRAMES = 512;
const FALLBACK_INTERACTIVE_MAX_BUFFERED_FRAMES = 2048;
const DEFAULT_RENDER_INTERVAL_MS = 2;
const MAX_RENDER_BATCH = 8;

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
const DEFAULT_SLOT_VOLUME = 256;
const PROJECT_SLOT = 0;
const STAGING_PROJECT_SLOT = 1;
const SYNTH_SLOT_START = 2;
const SYNTH_SLOT_COUNT = 4;
const IDLE_OUTPUT_PEAK_THRESHOLD = 0.00003;
const IDLE_OUTPUT_SETTLE_SECONDS = 0.75;
const SUNVOX_PROJECT_MAGIC = "SVOX";
const SUNSYNTH_MODULE_MAGIC = "SSYN";

const CONTROL_READ_INDEX = 0;
const CONTROL_WRITE_INDEX = 1;
const CONTROL_CAPACITY_FRAMES = 2;
const CONTROL_CHANNELS = 3;
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
let idleOutputFrames = 0;
let renderScheduled = false;
let rendering = false;
let projectPlaying = false;
let projectTailDraining = false;
let renderBaseTicks = 0;
let frameCursor = 0;
let pendingFrames = 0;
let isLoading = false;
let loadingPath = "";
let latestLoadRequestSerial = 0;
let lastTouchedSynthSlot = null;

function createSlotState(slot, kind) {
  return {
    slot,
    kind,
    url: "",
    resourceUrl: "",
    loaded: false,
    bytes: 0,
    moduleIndex: -1,
    activeNotes: new Set(),
    lastUsed: 0,
  };
}

const activeProject = createSlotState(PROJECT_SLOT, "project");
const stagingProject = createSlotState(STAGING_PROJECT_SLOT, "project");
const synthSlots = Array.from({ length: SYNTH_SLOT_COUNT }, (_, index) =>
  createSlotState(SYNTH_SLOT_START + index, "synth"),
);
const synthControllerPresets = new Map();
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

function postStatus(text) {
  postToMain({ type: "status", text });
}

function displayedLoadedPath() {
  if (activeProject.loaded || projectPlaying) {
    return activeProject.url;
  }
  if (lastTouchedSynthSlot?.loaded) {
    return lastTouchedSynthSlot.url;
  }
  return "";
}

function postPlayerState() {
  if (!playerOwner) return;
  postToMain({
    type: "player-state",
    payload: {
      ready,
      isPlaying: projectPlaying,
      isLoading,
      loadedPath: displayedLoadedPath(),
      loadingPath,
    },
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

function withSlotLock(slot, fn) {
  const lockResult = sv_lock_slot(slot);
  if (lockResult < 0) {
    throw new Error(`sv_lock_slot(${slot}) failed: ${lockResult}`);
  }
  try {
    return fn();
  } finally {
    sv_unlock_slot(slot);
  }
}

function resetSlotState(state) {
  state.url = "";
  state.resourceUrl = "";
  state.loaded = false;
  state.bytes = 0;
  state.moduleIndex = -1;
  state.activeNotes.clear();
}

function reopenSlot(state) {
  const closeResult = sv_close_slot(state.slot);
  if (closeResult < 0) {
    throw new Error(`sv_close_slot(${state.slot}) failed: ${closeResult}`);
  }
  const openResult = sv_open_slot(state.slot);
  if (openResult < 0) {
    throw new Error(`sv_open_slot(${state.slot}) failed: ${openResult}`);
  }
  resetSlotState(state);
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
  if (engineContinuousOutput) return;
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

function outputPeak(floatData) {
  let peak = 0;
  for (let index = 0; index < floatData.length; index += 1) {
    const sample = Math.abs(floatData[index]);
    if (sample > peak) {
      peak = sample;
    }
  }
  return peak;
}

function updateIdleOutputState(floatData) {
  if (engineContinuousOutput) return true;
  if (projectPlaying || anyActiveSynthNotes()) {
    idleOutputFrames = 0;
    return true;
  }

  if (outputPeak(floatData) > IDLE_OUTPUT_PEAK_THRESHOLD) {
    idleOutputFrames = 0;
    return true;
  }

  idleOutputFrames += floatData.length / channels;
  const settleFrames = Math.round(audioContextSampleRate * IDLE_OUTPUT_SETTLE_SECONDS);
  if (idleOutputFrames < settleFrames) {
    return true;
  }

  projectTailDraining = false;
  stopAudioOutput({ flush: true });
  postPlayerState();
  return false;
}

function framesToTicks(frameCount) {
  if (!ticksPerSecond || !audioContextSampleRate) {
    return renderBaseTicks;
  }
  return renderBaseTicks + Math.floor((frameCount * ticksPerSecond) / audioContextSampleRate);
}

function outputBufferedFrames() {
  if (sharedControl) {
    return sharedBufferedFrames();
  }
  return pendingFrames;
}

function targetBufferedFrames() {
  if (anyActiveSynthNotes()) {
    const interactiveLimit = sharedControl
      ? SHARED_INTERACTIVE_MAX_BUFFERED_FRAMES
      : FALLBACK_INTERACTIVE_MAX_BUFFERED_FRAMES;
    return Math.min(maxBufferedFrames, interactiveLimit);
  }
  return maxBufferedFrames;
}

function outputFreeFrames() {
  return Math.max(0, targetBufferedFrames() - outputBufferedFrames());
}

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
  const keepRendering = updateIdleOutputState(outBuffer);
  if (!keepRendering) {
    return true;
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
      stopAllAudioInternal();
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

function resetIdleOutputState() {
  idleOutputFrames = 0;
}

function anyActiveSynthNotes() {
  return synthSlots.some((slot) => slot.activeNotes.size > 0);
}

function startAudioOutput({ resetQueue = false, resetClock = false } = {}) {
  resetIdleOutputState();
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
  if (engineContinuousOutput) return;
  resetIdleOutputState();
  rendering = false;
  setOutputRunning(false);
  if (flush) {
    flushAudioOutput();
  }
  stopRenderLoop();
}

function scheduleIdleRenderStop() {
  resetIdleOutputState();
}

function stopSlot(slot, { reset = false, alreadyStopped = false } = {}) {
  if (!alreadyStopped) {
    const stopResult = sv_stop(slot);
    if (stopResult < 0) {
      throw new Error(`sv_stop(${slot}) failed: ${stopResult}`);
    }
  }
  if (reset) {
    const resetResult = sv_stop(slot);
    if (resetResult < 0) {
      throw new Error(`sv_stop(${slot}) reset failed: ${resetResult}`);
    }
  }
}

function stopSynthSlots({ reset = false } = {}) {
  let stopped = false;
  for (const slot of synthSlots) {
    if (!slot.loaded) {
      continue;
    }
    stopSlot(slot.slot, { reset });
    slot.activeNotes.clear();
    stopped = true;
  }
  return stopped;
}

function stopAllAudioInternal() {
  const projectAlreadyStopped = projectTailDraining && !projectPlaying;
  if (activeProject.loaded) {
    stopSlot(activeProject.slot, { reset: true, alreadyStopped: projectAlreadyStopped });
  }
  stopSynthSlots({ reset: true });
  projectPlaying = false;
  projectTailDraining = false;
  stopAudioOutput({ flush: true });
  postPlayerState();
}

function stopProjectPlaybackWithTail() {
  if (!activeProject.loaded && !projectPlaying) {
    stopAllAudioInternal();
    return { stopped: true, forced: true, tailDraining: false };
  }

  if (projectPlaying) {
    stopSlot(activeProject.slot);
  }
  projectPlaying = false;
  projectTailDraining = activeProject.loaded;
  stopSynthSlots({ reset: true });
  flushAudioOutput();

  if (projectTailDraining) {
    startAudioOutput({ resetQueue: false, resetClock: false });
  } else {
    stopAudioOutput({ flush: true });
  }

  postPlayerState();
  return { stopped: true, forced: false, tailDraining: projectTailDraining };
}

function clearProjectTailForInteractiveStart() {
  if (!projectTailDraining || projectPlaying) {
    return false;
  }
  if (activeProject.loaded) {
    stopSlot(activeProject.slot, { reset: true, alreadyStopped: true });
  }
  projectTailDraining = false;
  stopAudioOutput({ flush: true });
  postPlayerState();
  return true;
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

function normalizedControllerIndex(controllerIndex) {
  return Math.max(0, Math.min(126, Math.round(controllerIndex)));
}

function normalizedControllerValue(value) {
  return Math.max(0, Math.min(32768, Math.round(value)));
}

function setLoadedSynthController(slotState, controllerIndex, value) {
  const scaledValue = normalizedControllerValue(value);
  const index = normalizedControllerIndex(controllerIndex);
  const result = sv_set_module_ctl_value(slotState.slot, slotState.moduleIndex, index, scaledValue, 0);
  if (result < 0) {
    throw new Error(`sv_set_module_ctl_value failed: ${result}`);
  }
  return true;
}

function applySynthPreset(url, slotState) {
  const preset = synthControllerPresets.get(url);
  if (!preset) {
    return true;
  }
  let applied = true;
  for (const [controllerIndex, value] of preset) {
    try {
      applied = setLoadedSynthController(slotState, controllerIndex, value) && applied;
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

function noteKey(track, note) {
  return `${noteTrack(track)}:${normalizedNote(note)}`;
}

function isCurrentLoadRequest(requestSerial) {
  if (!Number.isFinite(requestSerial)) {
    return true;
  }
  return requestSerial === latestLoadRequestSerial;
}

function resourceUrlFor(url) {
  return new URL(url, `${self.location.origin}/`).href;
}

function fileMagic(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 4) {
    return "";
  }
  return String.fromCharCode(bytes[0], bytes[1], bytes[2], bytes[3]);
}

function assertFileMagic(bytes, expectedMagic, label) {
  if (!expectedMagic) {
    return;
  }
  const magic = fileMagic(bytes);
  if (magic !== expectedMagic) {
    throw new Error(`Unexpected file content for ${label}: expected ${expectedMagic}, got ${JSON.stringify(magic)}`);
  }
}

async function fetchBytes(url, expectedMagic, label = url) {
  const resourceUrl = resourceUrlFor(url);
  const response = await fetch(resourceUrl, { signal: playerAbort?.signal });
  if (!response.ok) {
    throw new Error(`Failed to fetch ${resourceUrl}`);
  }
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  if (!bytes.length) {
    throw new Error(`Empty file: ${resourceUrl}`);
  }
  assertFileMagic(bytes, expectedMagic, label);
  return bytes;
}

async function loadProjectIntoSlot(slotState, url, resourceUrl, requestSerial) {
  ensureReadyState();
  if (!isCurrentLoadRequest(requestSerial)) {
    return { cancelled: true };
  }
  isLoading = true;
  loadingPath = url;
  postStatus(slotState === stagingProject ? "Preloading the file..." : "Loading the file...");
  postPlayerState();

  try {
    const bytes = await fetchBytes(resourceUrl || url, SUNVOX_PROJECT_MAGIC, url);
    if (!isCurrentLoadRequest(requestSerial)) {
      return { cancelled: true };
    }
    if (slotState === activeProject && (projectPlaying || projectTailDraining)) {
      const projectAlreadyStopped = projectTailDraining && !projectPlaying;
      stopSlot(activeProject.slot, {
        reset: projectAlreadyStopped,
        alreadyStopped: projectAlreadyStopped,
      });
      projectPlaying = false;
      projectTailDraining = false;
      flushAudioOutput();
    }
    reopenSlot(slotState);
    withSlotLock(slotState.slot, () => {
      const loadResult = sv_load_from_memory(slotState.slot, bytes);
      if (loadResult < 0) {
        throw new Error(`sv_load_from_memory failed: ${loadResult}`);
      }
    });
    slotState.url = url;
    slotState.resourceUrl = resourceUrl || url;
    slotState.loaded = true;
    slotState.bytes = bytes.byteLength;
    slotState.lastUsed = Date.now();
    return { path: slotState.url, byteLength: slotState.bytes, slot: slotState.slot };
  } finally {
    isLoading = false;
    loadingPath = "";
    postPlayerState();
  }
}

async function preloadProject(url, resourceUrl) {
  const loaded = await loadProjectIntoSlot(stagingProject, url, resourceUrl);
  if (loaded.cancelled) {
    return { cancelled: true };
  }
  return { preloadedPath: url, slot: stagingProject.slot };
}

async function playProject(url, resourceUrl, requestSerial) {
  const loaded = await loadProjectIntoSlot(activeProject, url, resourceUrl, requestSerial);
  if (loaded.cancelled || !isCurrentLoadRequest(requestSerial)) {
    return { cancelled: true };
  }
  startProjectPlayback({ fromBeginning: true });
  return { loadedPath: url, slot: activeProject.slot };
}

function startProjectPlayback({ fromBeginning = false } = {}) {
  ensureReadyState();
  if (!activeProject.loaded) {
    throw new Error("No project loaded");
  }
  projectTailDraining = false;
  flushAudioOutput();
  const playResult = fromBeginning ? sv_play_from_beginning(activeProject.slot) : sv_play(activeProject.slot);
  if (playResult < 0) {
    throw new Error(`${fromBeginning ? "sv_play_from_beginning" : "sv_play"} failed: ${playResult}`);
  }
  projectPlaying = true;
  startAudioOutput({ resetQueue: true, resetClock: fromBeginning });
  postPlayerState();
  return { playing: true, loadedPath: activeProject.url, slot: activeProject.slot };
}

function findLoadedSynthSlot(url) {
  return synthSlots.find((slot) => slot.loaded && slot.url === url);
}

function chooseSynthSlot(url) {
  const loaded = findLoadedSynthSlot(url);
  if (loaded) {
    return loaded;
  }
  const empty = synthSlots.find((slot) => !slot.loaded);
  if (empty) {
    return empty;
  }
  return [...synthSlots].sort((left, right) => left.lastUsed - right.lastUsed)[0];
}

async function loadSynthFromUrl(url, resourceUrl, reuseExisting = true) {
  ensureReadyState();
  if (reuseExisting) {
    const loaded = findLoadedSynthSlot(url);
    if (loaded) {
      loaded.lastUsed = Date.now();
      lastTouchedSynthSlot = loaded;
      return loaded;
    }
  }

  isLoading = true;
  loadingPath = url;
  postStatus("Loading the instrument...");
  postPlayerState();

  try {
    const bytes = await fetchBytes(resourceUrl || url, SUNSYNTH_MODULE_MAGIC, url);
    const slotState = chooseSynthSlot(url);
    if (slotState.loaded) {
      stopSlot(slotState.slot, { reset: true });
    }
    reopenSlot(slotState);
    const moduleIndex = withSlotLock(slotState.slot, () => {
      const loadedModule = sv_load_module_from_memory(slotState.slot, bytes, DEFAULT_SYNTH_X, DEFAULT_SYNTH_Y, DEFAULT_SYNTH_Z);
      if (loadedModule < 0) {
        throw new Error(`sv_load_module_from_memory failed: ${loadedModule}`);
      }
      const connectResult = sv_connect_module(slotState.slot, loadedModule, INSTRUMENT_OUTPUT_MODULE);
      if (connectResult < 0) {
        throw new Error(`sv_connect_module failed: ${connectResult}`);
      }
      return loadedModule;
    });
    sv_volume(slotState.slot, DEFAULT_SLOT_VOLUME);
    const playResult = sv_play(slotState.slot);
    if (playResult < 0) {
      throw new Error(`sv_play failed: ${playResult}`);
    }

    slotState.url = url;
    slotState.resourceUrl = resourceUrl || url;
    slotState.loaded = true;
    slotState.moduleIndex = moduleIndex;
    slotState.bytes = bytes.byteLength;
    slotState.lastUsed = Date.now();
    lastTouchedSynthSlot = slotState;
    applySynthPreset(url, slotState);
    return slotState;
  } finally {
    isLoading = false;
    loadingPath = "";
    postPlayerState();
  }
}

async function preloadSynth(url, resourceUrl) {
  const slotState = await loadSynthFromUrl(url, resourceUrl, true);
  return { preloadedPath: url, slot: slotState.slot, moduleIndex: slotState.moduleIndex };
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
  const slotState = findLoadedSynthSlot(url);
  if (slotState) {
    return applySynthPreset(url, slotState);
  }
  return true;
}

function stopPlayback() {
  if (projectTailDraining && !projectPlaying) {
    stopAllAudioInternal();
    postStatus("Stopped");
    return { stopped: true, forced: true, tailDraining: false };
  }
  if (projectPlaying) {
    const result = stopProjectPlaybackWithTail();
    postStatus(result.tailDraining ? "Stopping..." : "Stopped");
    return result;
  }
  stopAllAudioInternal();
  postStatus("Stopped");
  return { stopped: true, forced: true, tailDraining: false };
}

function applyVolume(volume) {
  const normalized = Math.max(0, Math.min(256, Math.round(Number(volume))));
  if (audioPort) {
    audioPort.postMessage({
      type: "sunvox-master-volume",
      volume: normalized,
      gain: normalized / DEFAULT_SLOT_VOLUME,
    });
  }
  return { volume: normalized };
}

async function noteOn(payload) {
  ensureReadyState();
  const url = payload.url;
  const note = Number(payload.note);
  if (!url || !Number.isFinite(note)) {
    throw new Error("Missing note data");
  }
  clearProjectTailForInteractiveStart();
  const slotState = await loadSynthFromUrl(url, payload.resourceUrl || url, true);
  const track = noteTrack(payload.track ?? note);
  const noteValue = normalizedNote(note);
  const resetSynthClock = !projectPlaying && !rendering;
  if (resetSynthClock) {
    frameCursor = 0;
    renderBaseTicks = sv_get_ticks();
  }
  const eventTicks = framesToTicks(frameCursor);
  const setEventTimeResult = sv_set_event_t(slotState.slot, 1, eventTicks);
  if (setEventTimeResult < 0) {
    throw new Error(`sv_set_event_t (note on) failed: ${setEventTimeResult}`);
  }
  const result = sv_send_event(
    slotState.slot,
    track,
    noteValue,
    normalizedVelocity(payload.velocity),
    slotState.moduleIndex + 1,
    0,
    0,
  );
  sv_set_event_t(slotState.slot, 0, 0);
  if (result < 0) {
    throw new Error(`sv_send_event (note on) failed: ${result}`);
  }
  slotState.activeNotes.add(noteKey(track, note));
  slotState.lastUsed = Date.now();
  lastTouchedSynthSlot = slotState;
  startAudioOutput({ resetQueue: resetSynthClock, resetClock: false });
  postPlayerState();
  return true;
}

function noteOff(payload) {
  ensureReadyState();
  if (payload?.note === ALL_NOTES_OFF) {
    let stopped = false;
    for (const slotState of synthSlots) {
      if (!slotState.loaded) {
        continue;
      }
      const stopAllResult = sv_send_event(slotState.slot, 0, ALL_NOTES_OFF, 0, 0, 0, 0);
      if (stopAllResult < 0) {
        throw new Error(`sv_send_event (all notes off) failed: ${stopAllResult}`);
      }
      slotState.activeNotes.clear();
      stopped = true;
    }
    if (!projectPlaying) {
      stopAudioOutput({ flush: true });
    }
    postPlayerState();
    return stopped;
  }

  const note = Number(payload.note);
  const track = noteTrack(payload.track ?? note);
  const noteValue = note === ALL_NOTES_OFF ? ALL_NOTES_OFF : NOTE_OFF;
  const targets = lastTouchedSynthSlot ? [lastTouchedSynthSlot] : synthSlots;
  const eventTicks = framesToTicks(frameCursor);
  let sent = false;
  for (const slotState of targets) {
    if (!slotState.loaded || slotState.moduleIndex < 0) {
      continue;
    }
    const setEventTimeResult = sv_set_event_t(slotState.slot, 1, eventTicks);
    if (setEventTimeResult < 0) {
      throw new Error(`sv_set_event_t (note off) failed: ${setEventTimeResult}`);
    }
    const result = sv_send_event(
      slotState.slot,
      track,
      noteValue,
      0,
      slotState.moduleIndex + 1,
      0,
      0,
    );
    sv_set_event_t(slotState.slot, 0, 0);
    if (result < 0) {
      throw new Error(`sv_send_event (note off) failed: ${result}`);
    }
    slotState.activeNotes.delete(noteKey(track, note));
    sent = true;
  }
  scheduleIdleRenderStop();
  postPlayerState();
  return sent;
}

function stopAllSynthNotes() {
  ensureReadyState();
  return noteOff({ track: 0, note: ALL_NOTES_OFF });
}

async function setController(payload) {
  ensureReadyState();
  const slotState = await loadSynthFromUrl(payload.url, payload.resourceUrl || payload.url, true);
  return setLoadedSynthController(slotState, payload.controllerIndex, payload.value);
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
  assertPlayerSlotAccess(method, args);
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
  if (method === "sv_open_slot" && value >= 0) engineOpenSlots.add(args[0]);
  if (method === "sv_close_slot" && value >= 0) engineOpenSlots.delete(args[0]);
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

function renderEngineFrames(message) {
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


function runCommand(message) {
  const { payload } = message;
  if (payload?.type !== "initialize" && payload?.type !== "setAudioPort") {
    ensureReadyState();
  }

  const coreCommands = new Set(["initialize", "configureAudio", "engineStartAudio", "engineStopAudio", "call", "batch", "render", "attachPlayer", "detachPlayer"]);
  if (!coreCommands.has(payload?.type) && (!playerOwner || payload.owner !== playerOwner)) {
    throw new Error("Player is not attached to this Engine");
  }

  switch (payload?.type) {
    case "initialize":
      return initialize(payload);
    case "configureAudio":
      setSharedAudio(payload.sharedAudio);
      maxBufferedFrames = sharedControl ? DEFAULT_MAX_BUFFERED_FRAMES : 4096;
      setAudioPort(payload.port);
      return;
    case "engineStartAudio":
      engineContinuousOutput = true;
      startAudioOutput({ resetClock: !rendering });
      return;
    case "engineStopAudio":
      engineContinuousOutput = false;
      stopAudioOutput({ flush: true });
      setAudioPort(null);
      setSharedAudio(null);
      return;
    case "attachPlayer": return attachPlayer(payload);
    case "detachPlayer": return detachPlayer(payload.owner);
    case "getSynthSlot": {
      const state = findLoadedSynthSlot(payload.url);
      return state ? { slot: state.slot, moduleIndex: state.moduleIndex } : null;
    }
    case "call": return executeCalls([payload.command], false)[0];
    case "batch": return executeCalls(payload.commands, true);
    case "render":
      if (audioPort) throw new Error("Stop browser audio before explicit rendering");
      return renderEngineFrames(payload);
    case "loadAndPlay":
      return playProject(payload.url, payload.resourceUrl || payload.url, payload.requestSerial);
    case "preloadProject":
      return preloadProject(payload.url, payload.resourceUrl || payload.url);
    case "play":
      return startProjectPlayback({ fromBeginning: false });
    case "stop":
      return stopPlayback();
    case "reopenSlot":
      stopAllAudioInternal();
      for (const slotState of [activeProject, stagingProject, ...synthSlots]) {
        reopenSlot(slotState);
      }
      postPlayerState();
      return { reopened: true };
    case "setMasterVolume":
      return applyVolume(payload.volume);
    case "preloadSynth":
      return preloadSynth(payload.url, payload.resourceUrl || payload.url);
    case "noteOn":
      return noteOn(payload);
    case "noteOff":
      return noteOff(payload);
    case "stopAllSynthNotes":
      return { stopped: stopAllSynthNotes() };
    case "configureSynthControllers":
      return { configured: configureSynthControllers(payload.url, payload.controllers || []) };
    case "setController":
      return setController(payload).then((controllerSet) => ({ controllerSet }));
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

function canRunImmediately(payload) {
  if (!payload?.type) {
    return false;
  }
  if (["stop", "noteOff", "stopAllSynthNotes", "setMasterVolume"].includes(payload.type)) {
    return true;
  }
  return payload.type === "noteOn" && Boolean(findLoadedSynthSlot(payload.url));
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

  if (message.payload.type === "detachPlayer" && message.payload.owner === playerOwner) playerAbort?.abort();

  if (message.payload.type === "loadAndPlay" && Number.isFinite(message.payload.requestSerial)) {
    latestLoadRequestSerial = message.payload.requestSerial;
  }

  if (canRunImmediately(message.payload)) {
    runCommandSafe(message).then((outcome) => finishCommand(message, outcome));
    return;
  }

  queueCommand({
    id: message.id,
    payload: message.payload,
  });
};

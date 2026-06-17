const DEFAULT_MASTER_VOLUME = 256;
const DEFAULT_SAMPLE_RATE = 44100;
const DEFAULT_CHANNELS = 2;
const DEFAULT_RENDER_FRAMES = 128;
const DEFAULT_MAX_BUFFERED_FRAMES = 1024;
const DEFAULT_RENDER_INTERVAL_MS = 2;
const SHARED_BUFFER_FRAMES = 16384;
const SHARED_CONTROL_INTS = 16;
const NOTE_TRACK_MASK = 31;

const CONTROL_CAPACITY_FRAMES = 2;
const CONTROL_CHANNELS = 3;

const playerState = {
  ready: false,
  isPlaying: false,
  isLoading: false,
  loadedPath: "",
  loadingPath: "",
};

let worker = null;
let audioContext = null;
let workletNode = null;
let initializePromise = null;
let sharedAudioState = null;
let commandId = 0;
let loadCommandSerial = 0;
let connected = false;
let masterVolume = DEFAULT_MASTER_VOLUME;
let transportMode = "message-port";

const pendingCommands = new Map();

function rejectPendingCommands(reason) {
  for (const command of pendingCommands.values()) {
    command.reject(reason);
  }
  pendingCommands.clear();
}

function emitPlayerState() {
  window.dispatchEvent(new CustomEvent("sunvox-player-state", { detail: { ...playerState } }));
}

function setPlayerState(nextState) {
  Object.assign(playerState, nextState);
  emitPlayerState();
}

function updateStatus(message) {
  const statusElement = document.getElementById("status");
  if (statusElement) {
    statusElement.innerHTML = message;
  }
  if (message) {
    console.log(message);
  }
}

function resolveResourceUrl(path) {
  return new URL(path, window.location.href).href;
}

function clampMasterVolume(volume) {
  if (!Number.isFinite(volume)) {
    return DEFAULT_MASTER_VOLUME;
  }
  return Math.max(0, Math.min(DEFAULT_MASTER_VOLUME, Math.round(volume)));
}

function masterGain(volume = masterVolume) {
  return clampMasterVolume(volume) / DEFAULT_MASTER_VOLUME;
}

function clampTrack(value) {
  const track = Math.round(value);
  if (!Number.isFinite(track)) {
    return 0;
  }
  return track & NOTE_TRACK_MASK;
}

function clampNote(note) {
  const normalized = Math.round(note);
  return Number.isFinite(normalized) ? normalized : 0;
}

function clampVelocity(velocity) {
  const normalized = Math.round(velocity);
  return Number.isFinite(normalized) ? Math.max(1, Math.min(129, normalized)) : 128;
}

function nextCommandId() {
  return ++commandId;
}

function sendCommand(payload, transferables = []) {
  const id = nextCommandId();
  return new Promise((resolve, reject) => {
    if (!worker) {
      reject(new Error("SunVox worker is not initialized"));
      return;
    }
    pendingCommands.set(id, { resolve, reject });
    try {
      worker.postMessage({ type: "command", id, payload }, transferables);
    } catch (error) {
      pendingCommands.delete(id);
      reject(error);
    }
  });
}

function handleWorkerMessage(event) {
  const message = event.data || {};
  if (message.type === "command-result") {
    const command = pendingCommands.get(message.id);
    if (!command) {
      return;
    }
    pendingCommands.delete(message.id);
    if (message.ok) {
      command.resolve(message.payload);
      return;
    }
    command.reject(new Error(message.error ?? "Command failed"));
    return;
  }

  if (message.type === "player-state") {
    setPlayerState(message.payload || {});
    return;
  }

  if (message.type === "status") {
    updateStatus(message.text);
    return;
  }

  if (message.type === "log") {
    const level = message.level === "warn" ? "warn" : "log";
    console[level](`[SunVox worker] ${message.message}`);
    return;
  }

  if (message.type === "ready-state") {
    const ready = Boolean(message.ready);
    if (ready !== playerState.ready) {
      setPlayerState({ ready });
    }
    return;
  }
}

function canUseSharedAudio() {
  return typeof SharedArrayBuffer === "function" && window.crossOriginIsolated === true;
}

function createSharedAudioState() {
  if (!canUseSharedAudio()) {
    return null;
  }
  const controlBuffer = new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT * SHARED_CONTROL_INTS);
  const audioBuffer = new SharedArrayBuffer(
    Float32Array.BYTES_PER_ELEMENT * SHARED_BUFFER_FRAMES * DEFAULT_CHANNELS,
  );
  const control = new Int32Array(controlBuffer);
  control[CONTROL_CAPACITY_FRAMES] = SHARED_BUFFER_FRAMES;
  control[CONTROL_CHANNELS] = DEFAULT_CHANNELS;
  return {
    controlBuffer,
    audioBuffer,
    capacityFrames: SHARED_BUFFER_FRAMES,
    channels: DEFAULT_CHANNELS,
  };
}

function postOutputVolumeDirect() {
  if (!workletNode) {
    return;
  }
  workletNode.port.postMessage({
    type: "sunvox-master-volume",
    volume: masterVolume,
    gain: masterGain(),
  });
}

function terminateEngine() {
  if (worker) {
    worker.onmessage = null;
    worker.terminate();
    worker = null;
  }
  if (workletNode) {
    try {
      workletNode.disconnect();
    } catch {
      // no-op
    }
    workletNode = null;
  }
  if (audioContext) {
    try {
      audioContext.close();
    } catch {
      // no-op
    }
    audioContext = null;
  }
  connected = false;
  initializePromise = null;
  sharedAudioState = null;
  transportMode = "message-port";
  rejectPendingCommands(new Error("SunVox engine terminated"));
}

async function initializeEngine() {
  if (initializePromise) {
    return initializePromise;
  }

  initializePromise = (async () => {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) {
      throw new Error("AudioContext not supported");
    }
    if (!window.Worker) {
      throw new Error("Web Worker not supported");
    }

    audioContext = new AudioContextCtor({ sampleRate: DEFAULT_SAMPLE_RATE, latencyHint: "interactive" });
    if (!audioContext?.audioWorklet) {
      audioContext.close();
      audioContext = null;
      throw new Error("AudioWorklet not supported");
    }
    const moduleUrl = new URL("js/sunvox-worklet-processor.js", window.location.href).href;
    await audioContext.audioWorklet.addModule(moduleUrl);
    workletNode = new AudioWorkletNode(audioContext, "sunvox-worklet-processor", {
      outputChannelCount: [2],
    });

    sharedAudioState = createSharedAudioState();
    if (sharedAudioState) {
      transportMode = "shared-array-buffer";
      workletNode.port.postMessage({
        type: "sunvox-shared-buffer",
        controlBuffer: sharedAudioState.controlBuffer,
        audioBuffer: sharedAudioState.audioBuffer,
      });
    } else {
      transportMode = "message-port";
    }
    postOutputVolumeDirect();
    workletNode.connect(audioContext.destination);

    worker = new Worker(new URL("js/sunvox-audio-worker.js", window.location.href).href, {
      type: "classic",
    });
    worker.onmessage = handleWorkerMessage;

    await sendCommand(
      {
        type: "setAudioPort",
        port: workletNode.port,
      },
      [workletNode.port],
    );
    const sunvoxJsUrl = new URL("sunvox_lib/sunvox_lib/js/lib/sunvox.js", window.location.href).href;
    const sunvoxLoaderJsUrl = new URL("sunvox_lib/sunvox_lib/js/lib/sunvox_lib_loader.js", window.location.href).href;
    await sendCommand({
      type: "initialize",
      sampleRate: audioContext.sampleRate,
      channels: DEFAULT_CHANNELS,
      renderFrames: DEFAULT_RENDER_FRAMES,
      maxBufferedFrames: DEFAULT_MAX_BUFFERED_FRAMES,
      renderIntervalMs: DEFAULT_RENDER_INTERVAL_MS,
      sharedAudio: sharedAudioState
        ? {
            controlBuffer: sharedAudioState.controlBuffer,
            audioBuffer: sharedAudioState.audioBuffer,
          }
        : null,
      sunvoxJsUrl,
      sunvoxLoaderJsUrl,
    });

    await sendCommand({ type: "setMasterVolume", volume: masterVolume });

    connected = true;
    setPlayerState({
      ready: true,
    });
    window.dispatchEvent(new Event("sunvox-player-api-ready"));
  })().catch((error) => {
    terminateEngine();
    setPlayerState({ ready: false });
    throw error;
  });
  return initializePromise;
}

async function ensureAudioContext() {
  if (!connected || !playerState.ready) {
    await initializeEngine();
  }
  if (!audioContext) {
    return;
  }
  if (audioContext.state !== "running") {
    try {
      await audioContext.resume();
    } catch {
      // some environments block resume until user action; we still continue
    }
  }
}

function getPlayerState() {
  return { ...playerState };
}

function getMasterVolume() {
  return masterVolume;
}

function getAudioTransportState() {
  return {
    mode: transportMode,
    shared: transportMode === "shared-array-buffer",
    crossOriginIsolated: window.crossOriginIsolated === true,
  };
}

async function reapplyPublicMasterVolume(volume) {
  const publicSetter = window.setMasterVolume;
  if (typeof publicSetter === "function" && publicSetter !== setMasterVolume) {
    await publicSetter(volume);
    return;
  }
  await setMasterVolume(volume);
}

async function setMasterVolume(volume) {
  masterVolume = clampMasterVolume(volume);
  if (connected && playerState.ready) {
    await sendCommand({ type: "setMasterVolume", volume: masterVolume });
  } else {
    postOutputVolumeDirect();
  }
  return masterVolume;
}

async function loadAndPlay(url) {
  await ensureAudioContext();
  const requestSerial = ++loadCommandSerial;
  const loaded = await sendCommand({ type: "loadAndPlay", url, resourceUrl: resolveResourceUrl(url), requestSerial });
  try {
    await reapplyPublicMasterVolume(masterVolume);
  } catch {
    // non-fatal; keep playback result even if volume re-application fails
  }
  return loaded;
}

async function preloadProject(url) {
  await ensureAudioContext();
  return sendCommand({ type: "preloadProject", url, resourceUrl: resolveResourceUrl(url) })
    .then(() => true)
    .catch(() => false);
}

async function playLoadedProject() {
  await ensureAudioContext();
  return sendCommand({ type: "play" });
}

async function stopPlayback() {
  if (!connected) {
    return false;
  }
  try {
    await sendCommand({ type: "stop" });
    return true;
  } catch (error) {
    updateStatus(`stop failed: ${error.message}`);
    return false;
  }
}

async function configureSynthControllers(url, controllers) {
  if (!connected || !playerState.ready) {
    return false;
  }
  const sanitized = (controllers ?? [])
    .filter((controller) => Number.isFinite(controller?.controllerIndex) && Number.isFinite(controller?.value))
    .map((controller) => ({
      controllerIndex: controller.controllerIndex,
      value: controller.value,
    }));
  try {
    await sendCommand({ type: "configureSynthControllers", url, controllers: sanitized });
    return true;
  } catch {
    return false;
  }
}

async function preloadSynth(url) {
  await ensureAudioContext();
  return sendCommand({ type: "preloadSynth", url, resourceUrl: resolveResourceUrl(url) })
    .then(() => true)
    .catch(() => false);
}

async function playSynthNote(url, note, velocity = 128, track) {
  await ensureAudioContext();
  const resolvedTrack = Number.isFinite(track) ? track : note;
  return sendCommand({
    type: "noteOn",
    url,
    resourceUrl: resolveResourceUrl(url),
    track: clampTrack(resolvedTrack),
    note: clampNote(note),
    velocity: clampVelocity(velocity),
  })
    .then(() => true)
    .catch(() => false);
}

async function stopSynthNote(note, track) {
  if (!connected) {
    return false;
  }
  const resolvedTrack = Number.isFinite(track) ? track : note;
  return sendCommand({
    type: "noteOff",
    track: clampTrack(resolvedTrack),
    note: clampNote(note),
  })
    .then(() => true)
    .catch(() => false);
}

async function stopInstrumentNotes() {
  if (!connected) {
    return false;
  }
  return sendCommand({ type: "stopAllSynthNotes" })
    .then(() => true)
    .catch(() => false);
}

async function setSynthController(url, controllerIndex, value) {
  await ensureAudioContext();
  return sendCommand({
    type: "setController",
    url,
    resourceUrl: resolveResourceUrl(url),
    controllerIndex: Math.round(controllerIndex),
    value: Math.round(value),
  })
    .then(() => true)
    .catch(() => false);
}

window.playLoadedProject = playLoadedProject;
window.stopPlayback = stopPlayback;
window.setMasterVolume = setMasterVolume;
window.getMasterVolume = getMasterVolume;
window.getAudioTransportState = getAudioTransportState;
window.preloadProject = preloadProject;
window.preloadSynth = preloadSynth;
window.playSynthNote = playSynthNote;
window.stopSynthNote = stopSynthNote;
window.stopInstrumentNotes = stopInstrumentNotes;
window.setSynthController = setSynthController;
window.configureSynthControllers = configureSynthControllers;
window.loadAndPlay = loadAndPlay;
window.getPlayerState = getPlayerState;

window.addEventListener("beforeunload", terminateEngine);

setPlayerState({
  isPlaying: false,
  isLoading: false,
  loadingPath: "",
  loadedPath: "",
});
updateStatus("Ready");

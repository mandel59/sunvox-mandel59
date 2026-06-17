const DEFAULT_MASTER_VOLUME = 256;
const DEFAULT_SAMPLE_RATE = 44100;
const DEFAULT_CHANNELS = 2;
const DEFAULT_RENDER_FRAMES = 256;
const DEFAULT_MAX_BUFFERED_FRAMES = 65536;
const DEFAULT_RENDER_INTERVAL_MS = 5;
const NOTE_TRACK_MASK = 31;

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
let commandId = 0;
let loadCommandSerial = 0;
let connected = false;
let masterVolume = DEFAULT_MASTER_VOLUME;

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

function clampMasterVolume(volume) {
  if (!Number.isFinite(volume)) {
    return DEFAULT_MASTER_VOLUME;
  }
  return Math.max(0, Math.min(DEFAULT_MASTER_VOLUME, Math.round(volume)));
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
      sunvoxJsUrl,
      sunvoxLoaderJsUrl,
    });

    connected = true;
    setPlayerState({
      ready: true,
    });
    window.dispatchEvent(new Event("sunvox-player-api-ready"));
    sendCommand({ type: "setMasterVolume", volume: masterVolume }).catch(() => {
      // best effort only
    });
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
  }
  return masterVolume;
}

async function loadAndPlay(url) {
  await ensureAudioContext();
  const requestSerial = ++loadCommandSerial;
  const loaded = await sendCommand({ type: "loadAndPlay", url, requestSerial });
  try {
    await reapplyPublicMasterVolume(masterVolume);
  } catch {
    // non-fatal; keep playback result even if volume re-application fails
  }
  return loaded;
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

async function playSynthNote(url, note, velocity = 128, track) {
  await ensureAudioContext();
  const resolvedTrack = Number.isFinite(track) ? track : note;
  return sendCommand({
    type: "noteOn",
    url,
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

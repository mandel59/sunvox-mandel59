export * from "./constants.js";
export { createSunVoxEngine } from "./engine.js";
import { createSunVoxEngine } from "./engine.js";
import { engineInternals } from "./engine-internals.js";

/** High-level playback facade over an injected or privately owned Engine. */
export function createSunVoxPlayer(options = {}) {
  const ownsEngine = !options.engine;
  const engine = options.engine ?? createSunVoxEngine({ ...options, onLog: undefined });
  const internals = engineInternals.get(engine);
  if (!internals) throw new TypeError("engine must be created by createSunVoxEngine");
  const slotBase = options.slotBase ?? 0;
  if (!Number.isInteger(slotBase) || slotBase < 0 || slotBase > 10) throw new RangeError("slotBase must be 0..10");
  const resourceBaseUrl = new URL(options.resourceBaseUrl ?? internals.resourceBaseUrl);
  const DEFAULT_MASTER_VOLUME = 256;
  const NOTE_TRACK_MASK = 31;
  const playerState = {
    ready: false,
    isPlaying: false,
    isLoading: false,
    loadedPath: "",
    loadingPath: "",
  };

  let disposed = false;
  let initializePromise = null;
  let disposalPromise = null;
  let loadCommandSerial = 0;
  let connected = false;
  let masterVolume = DEFAULT_MASTER_VOLUME;
  const bridge = internals.claimPlayer(slotBase, (data) => handleWorkerMessage({ data }));

  function emitPlayerState() {
    options.onStateChange?.({ ...playerState });
  }

  function setPlayerState(nextState) {
    Object.assign(playerState, nextState);
    emitPlayerState();
  }

  function updateStatus(message) {
    options.onStatus?.(message);
  }

  function resolveResourceUrl(path) {
    return new URL(path, resourceBaseUrl).href;
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

  function sendCommand(payload) {
    if (disposed) return Promise.reject(new Error("SunVox player is disposed"));
    return bridge.command(payload);
  }

  function handleWorkerMessage(event) {
    const message = event.data || {};
    if (message.type === "engine-disposed") {
      disposed = true;
      connected = false;
      setPlayerState({ ready: false, isPlaying: false, isLoading: false, loadedPath: "", loadingPath: "" });
      return;
    }
    if (disposed) return;

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
      options.onLog?.(level, message.message);
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

  async function initializeEngine() {
    if (disposed) throw new Error("SunVox player is disposed");
    if (!initializePromise) {
      // Start AudioContext while still in the caller's user gesture.
      const audio = bridge.ensureAudio();
      initializePromise = Promise.all([bridge.attach(), audio]).then(async () => {
        if (disposed) throw new Error("SunVox player is disposed");
        connected = true;
        bridge.setVolume(masterVolume);
        await sendCommand({ type: "setMasterVolume", volume: masterVolume });
        setPlayerState({ ready: true });
        options.onReady?.();
      }).catch((error) => {
        initializePromise = null;
        connected = false;
        setPlayerState({ ready: false });
        throw error;
      });
    }
    return initializePromise;
  }

  async function ensureAudioContext() {
    if (!connected) await initializeEngine();
    else await bridge.ensureAudio();
  }

  function getPlayerState() {
    return { ...playerState };
  }

  function getMasterVolume() {
    return masterVolume;
  }

  function getAudioTransportState() { return engine.getAudioTransportState(); }

  async function setMasterVolume(volume) {
    if (disposed) throw new Error("SunVox player is disposed");
    masterVolume = clampMasterVolume(volume);
    bridge.setVolume(masterVolume);
    if (connected && playerState.ready) {
      await sendCommand({ type: "setMasterVolume", volume: masterVolume });
    } else {
      bridge.setVolume(masterVolume);
    }
    return masterVolume;
  }

  async function loadAndPlay(url) {
    await ensureAudioContext();
    const requestSerial = ++loadCommandSerial;
    const loaded = await sendCommand({ type: "loadAndPlay", url, resourceUrl: resolveResourceUrl(url), requestSerial });
    try {
      await setMasterVolume(masterVolume);
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


  function dispose() {
    if (disposalPromise) return disposalPromise;
    disposed = true;
    connected = false;
    if (ownsEngine) engine.dispose();
    disposalPromise = bridge.release();
    setPlayerState({ ready: false, isPlaying: false, isLoading: false, loadedPath: "", loadingPath: "" });
    return disposalPromise;
  }

  async function getSynthSlot(url) {
    if (disposed) throw new Error("SunVox player is disposed");
    await bridge.attach();
    return sendCommand({ type: "getSynthSlot", url });
  }

  return {
    engine,
    getProjectSlot: () => slotBase,
    getSlotLayout: () => ({ project: slotBase, staging: slotBase + 1, synths: [2, 3, 4, 5].map((offset) => slotBase + offset) }),
    getSynthSlot,
    initialize: ensureAudioContext,
    dispose,
    playLoadedProject,
    stopPlayback,
    setMasterVolume,
    getMasterVolume,
    getAudioTransportState,
    preloadProject,
    preloadSynth,
    playSynthNote,
    stopSynthNote,
    stopInstrumentNotes,
    setSynthController,
    configureSynthControllers,
    loadAndPlay,
    getPlayerState
  };
}

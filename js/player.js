const DEFAULT_MASTER_VOLUME = 256;
const DEFAULT_NOTE_VELOCITY = 128;
const INSTRUMENT_OUTPUT_MODULE = 0;
const NOTE_OFF = 128;
const ALL_NOTES_OFF = 129;

const playerState = {
  ready: false,
  isPlaying: false,
  isLoading: false,
  loadedPath: "",
  loadingPath: "",
};

let masterVolume = DEFAULT_MASTER_VOLUME;
let loadedResourceUrl = "";
let loadedSynthModule = -1;
let fileSize = 0;
const synthControllerPresets = new Map();

let playbackSerial = 0;
let playbackAbortController = null;
let playbackQueue = Promise.resolve();

svlib.then(async function (Module) {
  // SunVox Library was successfully loaded.
  // Here we can perform some initialization:
  svlib = Module;
  if (sv_init(0, 44100, 2, 0) < 0) {
    updateStatus("sv_init error");
    return;
  }
  if (sv_open_slot(0) < 0) {
    updateStatus("sv_open_slot error");
    return;
  }
  playerState.ready = true;
  applyMasterVolume();
  emitPlayerState();
  updateStatus("Select a music file");
  window.dispatchEvent(new Event("sunvox-player-api-ready"));
});

function emitPlayerState() {
  window.dispatchEvent(
    new CustomEvent("sunvox-player-state", {
      detail: { ...playerState },
    }),
  );
}

function setPlayerState(nextState) {
  Object.assign(playerState, nextState);
  emitPlayerState();
}

function updateStatus(s) {
  const statusElement = document.getElementById("status");
  if (statusElement) {
    statusElement.innerHTML = s;
  }
  console.log(s);
}

function isCommandUsable(signal) {
  return playerState.ready && !signal?.aborted;
}

function nextPlaybackSerial() {
  return ++playbackSerial;
}

function queuePlaybackCommand(label, command) {
  const serial = nextPlaybackSerial();
  const abortController = new AbortController();
  playbackAbortController?.abort();
  playbackAbortController = abortController;

  const scheduled = playbackQueue.then(() =>
    runPlaybackCommand(label, serial, abortController, command).catch((error) => {
      if (error?.name === "AbortError") {
        return false;
      }
      console.error(`[SunVox] ${label} command failed`, error);
      return false;
    }),
  );
  playbackQueue = scheduled.catch(() => {});
  return scheduled;
}

async function runPlaybackCommand(label, serial, abortController, command) {
  if (!isCommandUsable(abortController.signal) || serial !== playbackSerial) {
    return false;
  }
  try {
    const result = await command(abortController.signal);
    if (!isCommandUsable(abortController.signal) || serial !== playbackSerial) {
      return false;
    }
    return result;
  } catch (error) {
    if (error?.name === "AbortError") {
      return false;
    }
    updateStatus(`${label} failed: ${error?.message ?? String(error)}`);
    return false;
  } finally {
    if (playbackAbortController === abortController && serial === playbackSerial) {
      playbackAbortController = null;
    }
  }
}

function markLoading(url) {
  setPlayerState({
    isLoading: true,
    loadingPath: url,
    isPlaying: false,
  });
}

function markLoaded(url, byteLength) {
  loadedResourceUrl = url;
  loadedSynthModule = -1;
  fileSize = byteLength;
  setPlayerState({
    loadedPath: url,
    loadingPath: "",
    isLoading: false,
  });
}

function markPlaybackStarted() {
  setPlayerState({
    loadedPath: loadedResourceUrl,
    isPlaying: true,
    isLoading: false,
    loadingPath: "",
  });
}

function markPlaybackStopped() {
  setPlayerState({
    isPlaying: false,
    isLoading: false,
    loadingPath: "",
  });
}

function resumeAudioContext() {
  if (typeof sda_ctx !== "undefined" && sda_ctx && sda_ctx.state === "suspended") {
    sda_ctx.resume();
  }
}

function applyMasterVolume() {
  if (!playerState.ready) {
    return;
  }
  sv_volume(0, masterVolume);
}

function setMasterVolume(volume) {
  const nextVolume = Number.isFinite(volume) ? volume : DEFAULT_MASTER_VOLUME;
  masterVolume = Math.max(0, Math.min(DEFAULT_MASTER_VOLUME, Math.round(nextVolume)));
  applyMasterVolume();
  return masterVolume;
}

function getMasterVolume() {
  return masterVolume;
}

function getPlayerState() {
  return { ...playerState };
}

async function load(url, signal) {
  if (!isCommandUsable(signal)) {
    return false;
  }

  updateStatus("Loading the file...");
  sv_stop(0);
  setPlayerState({ isPlaying: false });
  markLoading(url);

  const response = await fetch(url, { signal });
  if (!response.ok) {
    setPlayerState({ isLoading: false, loadingPath: "" });
    updateStatus(`Music file ${url} not found`);
    return false;
  }
  if (!isCommandUsable(signal)) {
    return false;
  }

  const arrayBuffer = await response.arrayBuffer();
  if (!isCommandUsable(signal)) {
    return false;
  }
  const byteArray = new Uint8Array(arrayBuffer);
  if (!isCommandUsable(signal)) {
    return false;
  }
  if (sv_load_from_memory(0, byteArray) < 0) {
    setPlayerState({ isLoading: false, loadingPath: "" });
    updateStatus(`Failed to load the music file ${url}`);
    return false;
  }
  if (!isCommandUsable(signal)) {
    return false;
  }

  applyMasterVolume();
  markLoaded(url, byteArray.byteLength);
  updateStatus(`${url}`);
  return true;
}

function playLoadedProject() {
  resumeAudioContext();
  sv_play_from_beginning(0);
  applyMasterVolume();
  markPlaybackStarted();
}

function stopPlayback() {
  playbackSerial += 1;
  playbackAbortController?.abort();
  playbackAbortController = null;
  if (!playerState.ready) {
    return false;
  }
  sv_stop(0);
  markPlaybackStopped();
  return true;
}

function reopenSlot() {
  if (!playerState.ready) {
    return false;
  }
  sv_stop(0);
  sv_close_slot(0);
  if (sv_open_slot(0) < 0) {
    playerState.ready = false;
    loadedResourceUrl = "";
    loadedSynthModule = -1;
    markPlaybackStopped();
    updateStatus("sv_open_slot error");
    return false;
  }
  loadedResourceUrl = "";
  loadedSynthModule = -1;
  applyMasterVolume();
  return true;
}

function connectSynthModule(moduleIndex) {
  sv_lock_slot(0);
  try {
    return sv_connect_module(0, moduleIndex, INSTRUMENT_OUTPUT_MODULE);
  } finally {
    sv_unlock_slot(0);
  }
}

function normalizedControllerIndex(controllerIndex) {
  return Math.max(0, Math.min(126, Math.round(controllerIndex)));
}

function normalizedControllerValue(value) {
  return Math.max(0, Math.min(32768, Math.round(value)));
}

function setLoadedSynthController(moduleIndex, controllerIndex, value) {
  const controllerNumber = normalizedControllerIndex(controllerIndex);
  const controllerValue = normalizedControllerValue(value);
  if (typeof sv_set_module_ctl_value === "function") {
    return sv_set_module_ctl_value(0, moduleIndex, controllerNumber, controllerValue, 0) >= 0;
  }
  sv_send_event(0, 0, 0, 0, moduleIndex + 1, (controllerNumber + 1) << 8, controllerValue);
  return true;
}

function applySynthControllerPreset(url, moduleIndex) {
  const preset = synthControllerPresets.get(url);
  if (!preset) {
    return true;
  }
  let applied = true;
  for (const [controllerIndex, value] of preset) {
    applied = setLoadedSynthController(moduleIndex, controllerIndex, value) && applied;
  }
  return applied;
}

function configureSynthControllers(url, controllers) {
  const preset = new Map();
  for (const controller of controllers) {
    if (!Number.isFinite(controller?.controllerIndex) || !Number.isFinite(controller?.value)) {
      continue;
    }
    preset.set(normalizedControllerIndex(controller.controllerIndex), normalizedControllerValue(controller.value));
  }
  synthControllerPresets.set(url, preset);
  if (loadedResourceUrl === url && loadedSynthModule >= 0) {
    return applySynthControllerPreset(url, loadedSynthModule);
  }
  return true;
}

async function loadSynthForKeyboard(url) {
  if (loadedResourceUrl === url && loadedSynthModule >= 0) {
    applySynthControllerPreset(url, loadedSynthModule);
    return loadedSynthModule;
  }
  updateStatus("Loading the instrument...");
  const req = await fetch(url);
  if (!req.ok) {
    updateStatus(`Instrument file ${url} not found`);
    return -1;
  }
  const arrayBuffer = await req.arrayBuffer();
  const byteArray = new Uint8Array(arrayBuffer);
  if (!reopenSlot()) {
    return -1;
  }
  const moduleIndex = sv_load_module_from_memory(0, byteArray, 256, 256, 0);
  if (moduleIndex < 0) {
    updateStatus(`Failed to load the instrument ${url}`);
    return -1;
  }
  connectSynthModule(moduleIndex);
  sv_play(0);
  applyMasterVolume();
  loadedResourceUrl = url;
  loadedSynthModule = moduleIndex;
  applySynthControllerPreset(url, moduleIndex);
  updateStatus(`${url}`);
  return moduleIndex;
}

function noteTrack(note) {
  return Math.max(0, Math.min(31, note % 32));
}

function normalizedNoteVelocity(velocity) {
  return Math.max(1, Math.min(129, Math.round(velocity)));
}

async function playSynthNote(url, note, velocity = DEFAULT_NOTE_VELOCITY) {
  resumeAudioContext();
  const moduleIndex = await loadSynthForKeyboard(url);
  if (moduleIndex < 0) {
    return false;
  }
  const noteValue = Math.max(1, Math.min(127, Math.round(note) + 1));
  const noteVelocity = normalizedNoteVelocity(velocity);
  sv_send_event(0, noteTrack(note), noteValue, noteVelocity, moduleIndex + 1, 0, 0);
  return true;
}

function stopSynthNote(note) {
  if (!playerState.ready || loadedSynthModule < 0) {
    return false;
  }
  sv_send_event(0, noteTrack(note), NOTE_OFF, 0, loadedSynthModule + 1, 0, 0);
  return true;
}

function stopInstrumentNotes() {
  if (!playerState.ready || loadedSynthModule < 0) {
    return false;
  }
  sv_send_event(0, 0, ALL_NOTES_OFF, 0, 0, 0, 0);
  return true;
}

async function setSynthController(url, controllerIndex, value) {
  resumeAudioContext();
  const moduleIndex = await loadSynthForKeyboard(url);
  if (moduleIndex < 0) {
    return false;
  }
  const controllerNumber = normalizedControllerIndex(controllerIndex);
  const controllerValue = normalizedControllerValue(value);
  const preset = synthControllerPresets.get(url) ?? new Map();
  preset.set(controllerNumber, controllerValue);
  synthControllerPresets.set(url, preset);
  return setLoadedSynthController(moduleIndex, controllerNumber, controllerValue);
}

async function loadAndPlay(url) {
  const execute = async (signal) => {
    if (!isCommandUsable(signal) || !playerState.ready) {
      return false;
    }
    const loaded = await load(url, signal);
    if (!loaded) {
      return false;
    }
    if (!isCommandUsable(signal) || !playerState.ready) {
      return false;
    }
    playLoadedProject();
    return true;
  };
  return queuePlaybackCommand(`loadAndPlay(${url})`, execute);
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

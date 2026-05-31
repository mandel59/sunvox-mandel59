const DEFAULT_MASTER_VOLUME = 256;
const DEFAULT_NOTE_VELOCITY = 128;
const INSTRUMENT_OUTPUT_MODULE = 0;
const NOTE_OFF = 128;
const ALL_NOTES_OFF = 129;
let masterVolume = DEFAULT_MASTER_VOLUME;
let playerReady = false;
let loadedResourceUrl = "";
let loadedSynthModule = -1;
const synthControllerPresets = new Map();

svlib.then(async function (Module) {
    //
    // SunVox Library was successfully loaded.
    // Here we can perform some initialization:
    //
    svlib = Module;
    if (sv_init(0, 44100, 2, 0) < 0) {
        updateStatus("sv_init error");
        return;
    }
    if (sv_open_slot(0) < 0) {
        updateStatus("sv_open_slot error");
        return;
    }
    playerReady = true;
    applyMasterVolume();
    updateStatus("Select a music file");
});

function updateStatus(/** @type {string} */ s) {
    document.getElementById("status").innerHTML = s;
    console.log(s);
}

async function load(/** @type {string} */ url) {
    updateStatus("Loading the file...");
    const req = await fetch(url);
    if (!req.ok) {
        updateStatus(`Music file ${url} not found`);
        return false;
    }
    const arrayBuffer = await req.arrayBuffer();
    const byteArray = new Uint8Array(arrayBuffer);
    if (sv_load_from_memory(0, byteArray) < 0) {
        updateStatus(`Failed to load the music file ${url}`);
        return false;
    }
    applyMasterVolume();
    fileSize = byteArray.byteLength;
    loadedResourceUrl = url;
    loadedSynthModule = -1;
    updateStatus(`${url}`);
    return true;
}

function playLoadedProject() {
    resumeAudioContext();
    sv_play_from_beginning(0);
    applyMasterVolume();
}

function stopPlayback() {
    sv_stop(0);
}

function resumeAudioContext() {
    if (typeof sda_ctx !== "undefined" && sda_ctx && sda_ctx.state === "suspended") {
        sda_ctx.resume();
    }
}

function applyMasterVolume() {
    if (!playerReady) {
        return;
    }
    sv_volume(0, masterVolume);
}

function setMasterVolume(/** @type {number} */ volume) {
    const nextVolume = Number.isFinite(volume) ? volume : DEFAULT_MASTER_VOLUME;
    masterVolume = Math.max(0, Math.min(DEFAULT_MASTER_VOLUME, Math.round(nextVolume)));
    applyMasterVolume();
    return masterVolume;
}

function getMasterVolume() {
    return masterVolume;
}

function reopenSlot() {
    if (!playerReady) {
        return false;
    }
    sv_stop(0);
    sv_close_slot(0);
    if (sv_open_slot(0) < 0) {
        playerReady = false;
        loadedResourceUrl = "";
        loadedSynthModule = -1;
        updateStatus("sv_open_slot error");
        return false;
    }
    loadedResourceUrl = "";
    loadedSynthModule = -1;
    applyMasterVolume();
    return true;
}

function connectSynthModule(/** @type {number} */ moduleIndex) {
    sv_lock_slot(0);
    try {
        return sv_connect_module(0, moduleIndex, INSTRUMENT_OUTPUT_MODULE);
    } finally {
        sv_unlock_slot(0);
    }
}

function normalizedControllerIndex(/** @type {number} */ controllerIndex) {
    return Math.max(0, Math.min(126, Math.round(controllerIndex)));
}

function normalizedControllerValue(/** @type {number} */ value) {
    return Math.max(0, Math.min(32768, Math.round(value)));
}

function setLoadedSynthController(
    /** @type {number} */ moduleIndex,
    /** @type {number} */ controllerIndex,
    /** @type {number} */ value,
) {
    const controllerNumber = normalizedControllerIndex(controllerIndex);
    const controllerValue = normalizedControllerValue(value);
    if (typeof sv_set_module_ctl_value === "function") {
        return sv_set_module_ctl_value(0, moduleIndex, controllerNumber, controllerValue, 0) >= 0;
    }
    sv_send_event(0, 0, 0, 0, moduleIndex + 1, (controllerNumber + 1) << 8, controllerValue);
    return true;
}

function applySynthControllerPreset(/** @type {string} */ url, /** @type {number} */ moduleIndex) {
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

function configureSynthControllers(/** @type {string} */ url, /** @type {Array<{ controllerIndex: number, value: number }>} */ controllers) {
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

async function loadSynthForKeyboard(/** @type {string} */ url) {
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

function noteTrack(/** @type {number} */ note) {
    return Math.max(0, Math.min(31, note % 32));
}

async function playSynthNote(/** @type {string} */ url, /** @type {number} */ note, /** @type {number} */ velocity = DEFAULT_NOTE_VELOCITY) {
    resumeAudioContext();
    const moduleIndex = await loadSynthForKeyboard(url);
    if (moduleIndex < 0) {
        return false;
    }
    const noteValue = Math.max(1, Math.min(127, Math.round(note) + 1));
    const noteVelocity = Math.max(1, Math.min(129, Math.round(velocity)));
    sv_send_event(0, noteTrack(note), noteValue, noteVelocity, moduleIndex + 1, 0, 0);
    return true;
}

function stopSynthNote(/** @type {number} */ note) {
    if (!playerReady || loadedSynthModule < 0) {
        return false;
    }
    sv_send_event(0, noteTrack(note), NOTE_OFF, 0, loadedSynthModule + 1, 0, 0);
    return true;
}

function stopInstrumentNotes() {
    if (!playerReady || loadedSynthModule < 0) {
        return false;
    }
    sv_send_event(0, 0, ALL_NOTES_OFF, 0, 0, 0, 0);
    return true;
}

async function setSynthController(
    /** @type {string} */ url,
    /** @type {number} */ controllerIndex,
    /** @type {number} */ value,
) {
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

async function loadAndPlay(/** @type {string} */ url) {
    resumeAudioContext();
    if (!await load(url)) {
        return false;
    }
    playLoadedProject();
    return true;
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
window.dispatchEvent(new Event("sunvox-player-api-ready"));

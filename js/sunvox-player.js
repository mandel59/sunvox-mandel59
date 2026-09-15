import { createSunVoxEngine } from "@mandel59/sunvox-web";

/** Site playback policy. The Engine and all six slots belong exclusively to this instance. */
export function createSunVoxPlayer(options = {}) {
  if (options.engine) throw new TypeError("The site Player owns its Engine");
  const engine = createSunVoxEngine(options);
  const resourceBase = new URL(options.resourceBaseUrl ?? globalThis.location?.href ?? import.meta.url);
  const abort = new AbortController();
  const state = { ready: false, isPlaying: false, isLoading: false, loadedPath: "", loadingPath: "" };
  const slots = Array.from({ length: 6 }, (_, slot) => ({ slot, url: "", loaded: false, moduleIndex: -1, notes: new Map(), lastUsed: 0 }));
  const [project, staging, ...synths] = slots;
  const presets = new Map();
  const noteRequests = new Map();
  let disposed = false, initialization, queue = Promise.resolve();
  let masterVolume = 256, loadSerial = 0, tailDraining = false;

  function assertAlive() { if (disposed) throw new Error("SunVox player is disposed"); }
  function emit(patch = {}) {
    if (disposed) return;
    Object.assign(state, patch);
    options.onStateChange?.({ ...state });
  }
  function status(text) { options.onStatus?.(text); }
  function checked(result, method) {
    if (result < 0) throw new Error(`${method} failed: ${result}`);
    return result;
  }
  function enqueue(task) {
    const result = queue.then(() => { assertAlive(); return task(); });
    queue = result.catch(() => {});
    return result;
  }
  function armIdleStop() {
    if (!state.isPlaying && !synths.some((s) => s.notes.size)) return engine.pauseAudioWhenSilent();
  }
  async function sendEvents(events) {
    if (!events.length) return;
    const results = await engine.batch(events.map((args) => ({ method: "sv_send_event", args })), { eventTime: "render" });
    for (const result of results) checked(result, "sv_send_event");
  }
  async function applyPreset(slot, preset) {
    if (!preset?.size) return;
    const commands = [...preset].map(([index, value]) => ({
      method: "sv_set_module_ctl_value", args: [slot.slot, slot.moduleIndex, index, value, 0],
    }));
    for (const result of await engine.batch(commands)) checked(result, "sv_set_module_ctl_value");
  }
  function initialize() {
    assertAlive();
    // Retry resume synchronously in each caller's gesture, even after automatic preload.
    const audio = engine.startAudio();
    if (!initialization) {
      initialization = (async () => {
        await audio;
        for (const slot of slots) checked(await engine.sv_open_slot(slot.slot), "sv_open_slot");
        assertAlive();
        await engine.setOutputGain(masterVolume / 256);
        await armIdleStop();
        emit({ ready: true });
        options.onReady?.();
      })().catch((error) => { engine.dispose(); throw error; });
    }
    return Promise.all([initialization, audio]).then(async () => { assertAlive(); await armIdleStop(); });
  }
  async function fetchBytes(url, magic) {
    const response = await fetch(new URL(url, resourceBase), { signal: abort.signal });
    if (!response.ok) throw new Error(`Failed to fetch ${url}`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    assertAlive();
    if (String.fromCharCode(...bytes.subarray(0, 4)) !== magic) throw new Error(`Unexpected file content for ${url}: expected ${magic}`);
    return bytes;
  }
  async function reopen(slot) {
    checked(await engine.sv_close_slot(slot.slot), "sv_close_slot");
    checked(await engine.sv_open_slot(slot.slot), "sv_open_slot");
    Object.assign(slot, { url: "", loaded: false, moduleIndex: -1 });
    slot.notes.clear();
  }
  async function stopSlot(slot, reset = false) {
    checked(await engine.sv_stop(slot.slot), "sv_stop");
    if (reset) checked(await engine.sv_stop(slot.slot), "sv_stop");
    slot.notes.clear();
  }
  async function stopSynths() {
    for (const slot of synths) if (slot.loaded) await stopSlot(slot, true);
  }
  async function clearTail() {
    if (!tailDraining) return;
    await stopSlot(project, true);
    tailDraining = false;
    await engine.pauseAudio();
  }
  async function loadProject(slot, url, serial) {
    emit({ isLoading: true, loadingPath: url });
    status(slot === staging ? "Preloading the file..." : "Loading the file...");
    try {
      const bytes = await fetchBytes(url, "SVOX");
      if (serial !== undefined && serial !== loadSerial) return false;
      if (slot === project) {
        if (slot.loaded) await stopSlot(slot, tailDraining);
        tailDraining = false;
        emit({ isPlaying: false });
        await engine.pauseAudio();
      }
      await reopen(slot);
      checked(await engine.sv_load_from_memory(slot.slot, bytes), "sv_load_from_memory");
      Object.assign(slot, { loaded: true, url });
      if (slot === project) emit({ loadedPath: url });
      await armIdleStop();
      return true;
    } finally { emit({ isLoading: false, loadingPath: "" }); }
  }
  async function playProject(fromBeginning) {
    if (!project.loaded) throw new Error("No project loaded");
    tailDraining = false;
    checked(await (fromBeginning ? engine.sv_play_from_beginning(project.slot) : engine.sv_play(project.slot)), "sv_play");
    await engine.startAudio();
    emit({ isPlaying: true, loadedPath: project.url });
    return { playing: true, loadedPath: project.url, slot: project.slot };
  }
  function controllerIndex(value) { return Math.max(0, Math.min(126, Math.round(value))); }
  function controllerValue(value) { return Math.max(0, Math.min(32768, Math.round(value))); }
  async function setController(slot, index, value) {
    checked(await engine.sv_set_module_ctl_value(slot.slot, slot.moduleIndex, controllerIndex(index), controllerValue(value), 0), "sv_set_module_ctl_value");
  }
  async function loadSynth(url) {
    const existing = synths.find((s) => s.loaded && s.url === url);
    if (existing) { existing.lastUsed = performance.now(); return existing; }
    emit({ isLoading: true, loadingPath: url });
    status("Loading the instrument...");
    try {
      const bytes = await fetchBytes(url, "SSYN");
      const slot = synths.find((s) => !s.loaded) ?? [...synths].sort((a, b) => a.lastUsed - b.lastUsed)[0];
      if (slot.loaded) await stopSlot(slot, true);
      await reopen(slot);
      const moduleIndex = checked(await engine.sv_load_module_from_memory(slot.slot, bytes, 256, 256, 0), "sv_load_module_from_memory");
      checked(await engine.sv_connect_module(slot.slot, moduleIndex, 0), "sv_connect_module");
      // A fresh instrument slot has no saved project volume to preserve.
      checked(await engine.sv_volume(slot.slot, 256), "sv_volume");
      checked(await engine.sv_play(slot.slot), "sv_play");
      Object.assign(slot, { loaded: true, url, moduleIndex, lastUsed: performance.now() });
      await applyPreset(slot, presets.get(url));
      if (!project.loaded) emit({ loadedPath: url });
      await armIdleStop();
      return slot;
    } finally { emit({ isLoading: false, loadingPath: "" }); }
  }
  const trackFor = (note, track) => (Number.isFinite(track) ? Math.round(track) : Number.isFinite(note) ? Math.round(note) : 0) & 31;
  function cancelNotes() { for (const track of noteRequests.keys()) noteRequests.set(track, (noteRequests.get(track) ?? 0) + 1); }
  async function releaseNotes(track, note) {
    const events = [];
    for (const slot of synths) {
      if (!slot.loaded || (track !== undefined && slot.notes.get(track) !== note)) continue;
      events.push([slot.slot, track ?? 0, track === undefined ? 129 : 128, 0, slot.moduleIndex + 1, 0, 0]);
      if (track === undefined) slot.notes.clear(); else slot.notes.delete(track);
    }
    await sendEvents(events);
    await armIdleStop();
  }
  async function booleanResult(task) { try { await task(); return true; } catch { return false; } }

  return {
    initialize,
    dispose() {
      if (disposed) return;
      disposed = true;
      abort.abort();
      engine.dispose();
      Object.assign(state, { ready: false, isPlaying: false, isLoading: false, loadedPath: "", loadingPath: "" });
      options.onStateChange?.({ ...state });
    },
    getPlayerState: () => ({ ...state }),
    getMasterVolume: () => masterVolume,
    getAudioTransportState: () => engine.getAudioTransportState(),
    async setMasterVolume(volume) {
      assertAlive();
      masterVolume = Number.isFinite(volume) ? Math.max(0, Math.min(256, Math.round(volume))) : 256;
      await engine.setOutputGain(masterVolume / 256);
      return masterVolume;
    },
    async loadAndPlay(url) {
      const serial = ++loadSerial;
      await initialize();
      return enqueue(async () => {
        if (serial !== loadSerial || !await loadProject(project, url, serial)) return { cancelled: true };
        if (serial !== loadSerial) return { cancelled: true };
        await playProject(true);
        return { loadedPath: url, slot: project.slot };
      });
    },
    async preloadProject(url) {
      await initialize();
      return booleanResult(() => enqueue(() => loadProject(staging, url)));
    },
    async playLoadedProject() { await initialize(); return enqueue(() => playProject(false)); },
    async stopPlayback() {
      if (!state.ready) return false;
      ++loadSerial;
      cancelNotes();
      return booleanResult(async () => {
        await stopSynths();
        if (state.isPlaying) {
          await stopSlot(project);
          tailDraining = true;
          emit({ isPlaying: false });
          await armIdleStop();
          status("Stopping...");
        } else {
          if (project.loaded) await stopSlot(project, true);
          tailDraining = false;
          await engine.pauseAudio();
          status("Stopped");
        }
      });
    },
    async preloadSynth(url) { await initialize(); return booleanResult(() => enqueue(() => loadSynth(url))); },
    async configureSynthControllers(url, controllers) {
      if (!state.ready) return false;
      return booleanResult(() => enqueue(async () => {
        const preset = new Map((controllers ?? []).filter((c) => Number.isFinite(c?.controllerIndex) && Number.isFinite(c?.value)).map((c) => [controllerIndex(c.controllerIndex), controllerValue(c.value)]));
        presets.set(url, preset);
        const slot = synths.find((s) => s.loaded && s.url === url);
        if (slot) await applyPreset(slot, preset);
      }));
    },
    async setSynthController(url, index, value) {
      await initialize();
      return booleanResult(() => enqueue(async () => setController(await loadSynth(url), index, value)));
    },
    async playSynthNote(url, note, velocity = 128, track) {
      note = Number.isFinite(note) ? Math.round(note) : 0;
      const key = trackFor(note, track);
      const request = (noteRequests.get(key) ?? 0) + 1;
      noteRequests.set(key, request);
      await initialize();
      return booleanResult(() => enqueue(async () => {
        const slot = await loadSynth(url);
        if (noteRequests.get(key) !== request) return;
        await clearTail();
        if (noteRequests.get(key) !== request) return;
        // Schedule at the next render position in the Worker, without a clock round trip.
        await engine.startAudio();
        if (noteRequests.get(key) !== request) { await armIdleStop(); return; }
        slot.notes.set(key, note);
        const nativeNote = Math.max(1, Math.min(127, Math.round(note) + 1));
        const nativeVelocity = Number.isFinite(velocity) ? Math.max(1, Math.min(129, Math.round(velocity))) : 128;
        await sendEvents([[slot.slot, key, nativeNote, nativeVelocity, slot.moduleIndex + 1, 0, 0]]);
      }));
    },
    async stopSynthNote(note, track) {
      note = Number.isFinite(note) ? Math.round(note) : 0;
      const key = trackFor(note, track);
      noteRequests.set(key, (noteRequests.get(key) ?? 0) + 1);
      if (!state.ready) return false;
      return booleanResult(() => releaseNotes(key, note));
    },
    async stopInstrumentNotes() {
      cancelNotes();
      if (!state.ready) return false;
      return booleanResult(async () => {
        await releaseNotes();
        if (!state.isPlaying) await engine.pauseAudio();
      });
    },
  };
}

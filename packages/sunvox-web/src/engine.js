import { engineInternals } from "./engine-internals.js";
import { ENGINE_API } from "./engine-api.js";

/** Independent engine with native slot numbering and no player policy. */
export function createSunVoxEngine(options = {}) {
  if (!options.runtimeBaseUrl) throw new TypeError("runtimeBaseUrl is required");
  const base = new URL(options.resourceBaseUrl ?? globalThis.location?.href ?? import.meta.url);
  const runtime = new URL(options.runtimeBaseUrl, base);
  if (!runtime.pathname.endsWith("/")) runtime.pathname += "/";
  const workerUrl = options.workerUrl ? new URL(options.workerUrl, base) : new URL("./sunvox-audio-worker.js", import.meta.url);
  const workletUrl = options.workletUrl ? new URL(options.workletUrl, base) : new URL("./sunvox-worklet-processor.js", import.meta.url);
  const sampleRate = options.sampleRate ?? 44100;
  if (!Number.isInteger(sampleRate) || sampleRate < 44100 || sampleRate > 192000) throw new RangeError("sampleRate must be 44100..192000");
  if (options.config !== undefined && typeof options.config !== "string") throw new TypeError("config must be a string");
  let worker, initialization, context, node, startingAudio;
  let disposed = false;
  let player = null;
  let ownerSerial = 0;
  let transportMode = "message-port";
  let outputVolume = 256;
  let commandId = 0;
  const pending = new Map();

  function dispose() {
    if (disposed) return;
    disposed = true;
    player?.events({ type: "engine-disposed" });
    worker?.terminate();
    worker = null;
    node?.disconnect();
    node = null;
    if (context) void context.close().catch(() => {});
    context = null;
    for (const { reject } of pending.values()) reject(new Error("SunVox engine disposed"));
    pending.clear();
  }

  function send(message, transfer = []) {
    if (disposed || !worker) return Promise.reject(new Error("SunVox engine disposed"));
    const id = ++commandId;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      try { worker.postMessage({ type: "command", id, payload: message }, transfer); }
      catch (error) { pending.delete(id); reject(error); }
    });
  }

  function initialize() {
    if (disposed) return Promise.reject(new Error("SunVox engine disposed"));
    if (initialization) return initialization;
    // Defer startup so synchronous construction errors also dispose cleanly.
    initialization = Promise.resolve().then(() => {
      if (disposed) throw new Error("SunVox engine disposed");
      worker = new Worker(workerUrl, { type: "classic" });
      worker.onmessage = ({ data }) => {
        if (data.type !== "command-result") {
          if (data.type === "log") options.onLog?.(data.level, data.message);
          player?.events(data);
          return;
        }
        const command = pending.get(data.id);
        if (!command) return;
        pending.delete(data.id);
        if (data.ok) command.resolve(data.payload);
        else command.reject(new Error(data.error));
      };
      const fail = (event) => {
        const error = new Error(event.message || "SunVox worker communication failed");
        for (const command of pending.values()) command.reject(error);
        pending.clear();
        dispose();
      };
      worker.onerror = fail;
      worker.onmessageerror = fail;
      return send({ type: "initialize", runtimeBaseUrl: runtime.href, sampleRate, config: options.config, methods: ENGINE_API });
    }).catch((error) => { dispose(); throw error; });
    return initialization;
  }

  async function request(message) {
    // Capture buffers now; callers retain ownership and may reuse them immediately.
    const copy = structuredClone(message);
    await initialize();
    return send(copy);
  }

  function call(method, ...args) {
    if (!Object.hasOwn(ENGINE_API, method)) return Promise.reject(new TypeError(`Unsupported SunVox method: ${method}`));
    return request({ type: "call", command: { method, args } });
  }

  function ensureAudio() {
    if (disposed) return Promise.reject(new Error("SunVox engine disposed"));
    if (startingAudio) {
      // Retry directly in each caller's gesture, including after automatic preload.
      if (context?.state === "suspended") void context.resume().catch(() => {});
      return startingAudio;
    }
    startingAudio = (async () => {
      // Construct/resume before the first await to preserve the user gesture.
      const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextCtor) throw new Error("AudioContext not supported");
      context = new AudioContextCtor({ sampleRate, latencyHint: "interactive" });
      const audio = context;
      // Autoplay suspension must not block preparation or future gesture retries.
      void audio.resume().catch(() => {});
      const info = await initialize();
      if (disposed) throw new Error("SunVox engine disposed");
      if (audio.sampleRate !== info.sampleRate) throw new Error("AudioContext and SunVox sample rates differ");
      await audio.audioWorklet.addModule(workletUrl.href);
      if (disposed) throw new Error("SunVox engine disposed");
      node = new AudioWorkletNode(audio, "sunvox-worklet-processor", { outputChannelCount: [2] });
      node.connect(audio.destination);
      const shared = typeof SharedArrayBuffer === "function" && globalThis.crossOriginIsolated === true;
      const sharedAudio = shared ? {
        controlBuffer: new SharedArrayBuffer(16 * 4),
        audioBuffer: new SharedArrayBuffer(16384 * 2 * 4),
      } : null;
      transportMode = shared ? "shared-array-buffer" : "message-port";
      if (sharedAudio) {
        const control = new Int32Array(sharedAudio.controlBuffer);
        control[2] = 16384; control[3] = 2;
        node.port.postMessage({ type: "sunvox-shared-buffer", ...sharedAudio });
      }
      node.port.postMessage({ type: "sunvox-master-volume", gain: outputVolume / 256 });
      await send({ type: "configureAudio", port: node.port, sharedAudio }, [node.port]);
    })().catch(async (error) => {
      if (!disposed && worker) await send({ type: "engineStopAudio" }).catch(() => {});
      node?.disconnect(); node = null;
      if (context) void context.close().catch(() => {});
      context = null; startingAudio = null;
      throw error;
    });
    return startingAudio;
  }

  async function startAudio() {
    await ensureAudio();
    await send({ type: "engineStartAudio" });
  }

  async function stopAudio() {
    if (startingAudio) await startingAudio.catch(() => {});
    if (!disposed && worker) await send({ type: "engineStopAudio" });
    node?.disconnect(); node = null;
    const audio = context; context = null; startingAudio = null; transportMode = "message-port";
    if (audio) await audio.close();
  }

  function getAudioTransportState() {
    return { mode: transportMode, shared: transportMode === "shared-array-buffer", crossOriginIsolated: globalThis.crossOriginIsolated === true };
  }

  function claimPlayer(slotBase, events) {
    if (disposed) throw new Error("SunVox engine disposed");
    if (player) throw new Error("Engine already has a Player; await its dispose() before attaching another");
    const owner = ++ownerSerial;
    const holder = { owner, events, attachment: null };
    player = holder;
    const attach = () => {
      if (!holder.attachment) holder.attachment = initialize()
        .then(() => send({ type: "attachPlayer", owner, slotBase }))
        .catch((error) => { holder.attachment = null; throw error; });
      return holder.attachment;
    };
    return {
      attach,
      ensureAudio,
      setVolume: (volume) => {
        outputVolume = volume;
        node?.port.postMessage({ type: "sunvox-master-volume", gain: volume / 256 });
      },
      command: (payload) => send({ ...payload, owner }),
      async release() {
        events = () => {};
        holder.events = events;
        try {
          if (holder.attachment) {
            // Queue detach immediately so the worker can abort an in-flight fetch.
            await holder.attachment.catch(() => {});
            if (!disposed && worker) await send({ type: "detachPlayer", owner });
          }
        } finally { if (player === holder) player = null; }
      },
    };
  }

  const api = Object.freeze({
    initialize, dispose, call, startAudio, stopAudio, getAudioTransportState,
    batch: (commands) => request({ type: "batch", commands }),
    render: (frames, renderOptions = {}) => request({ ...renderOptions, type: "render", frames }),
    ...Object.fromEntries(Object.keys(ENGINE_API).map((method) => [method, (...args) => call(method, ...args)])),
  });
  engineInternals.set(api, { claimPlayer, resourceBaseUrl: base.href });
  return api;
}

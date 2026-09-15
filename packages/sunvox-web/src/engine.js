import { ENGINE_API } from "./engine-api.js";

/** Independent engine with native slot numbering and no player policy. */
export function createSunVoxEngine(options = {}) {
  if (!options.runtimeBaseUrl) throw new TypeError("runtimeBaseUrl is required");
  const base = new URL(options.resourceBaseUrl ?? globalThis.location?.href ?? import.meta.url);
  const runtime = new URL(options.runtimeBaseUrl, base);
  if (!runtime.pathname.endsWith("/")) runtime.pathname += "/";
  const workerUrl = options.workerUrl ? new URL(options.workerUrl, base) : new URL("./engine-worker.js", import.meta.url);
  const workletUrl = options.workletUrl ? new URL(options.workletUrl, base) : new URL("./sunvox-worklet-processor.js", import.meta.url);
  const sampleRate = options.sampleRate ?? 44100;
  if (!Number.isInteger(sampleRate) || sampleRate < 44100 || sampleRate > 192000) throw new RangeError("sampleRate must be 44100..192000");
  if (options.config !== undefined && typeof options.config !== "string") throw new TypeError("config must be a string");
  let worker, initialization, context, node, startingAudio;
  let disposed = false;
  let commandId = 0;
  const pending = new Map();

  function dispose() {
    disposed = true;
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
      try { worker.postMessage({ ...message, id }, transfer); }
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
        if (data.type === "log") { options.onLog?.(data.level, data.message); return; }
        const command = pending.get(data.id);
        if (!command) return;
        pending.delete(data.id);
        if (data.ok) command.resolve(data.value);
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

  function startAudio() {
    if (disposed) return Promise.reject(new Error("SunVox engine disposed"));
    if (startingAudio) return startingAudio;
    startingAudio = (async () => {
      // Construct/resume before the first await to preserve the user gesture.
      const AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext;
      if (!AudioContextCtor) throw new Error("AudioContext not supported");
      context = new AudioContextCtor({ sampleRate, latencyHint: "interactive" });
      const audio = context;
      const resumed = audio.resume();
      const [info] = await Promise.all([initialize(), resumed]);
      if (disposed) throw new Error("SunVox engine disposed");
      if (audio.sampleRate !== info.sampleRate) throw new Error("AudioContext and SunVox sample rates differ");
      await audio.audioWorklet.addModule(workletUrl.href);
      if (disposed) throw new Error("SunVox engine disposed");
      node = new AudioWorkletNode(audio, "sunvox-worklet-processor", { outputChannelCount: [2] });
      node.connect(audio.destination);
      await send({ type: "startAudio", port: node.port }, [node.port]);
    })().catch(async (error) => {
      if (!disposed && worker) await send({ type: "stopAudio" }).catch(() => {});
      node?.disconnect(); node = null;
      if (context) void context.close().catch(() => {});
      context = null; startingAudio = null;
      throw error;
    });
    return startingAudio;
  }

  async function stopAudio() {
    if (startingAudio) await startingAudio.catch(() => {});
    if (!disposed && worker) await send({ type: "stopAudio" });
    node?.disconnect(); node = null;
    const audio = context; context = null; startingAudio = null;
    if (audio) await audio.close();
  }

  return Object.freeze({
    initialize, dispose, call, startAudio, stopAudio,
    batch: (commands) => request({ type: "batch", commands }),
    render: (frames, renderOptions = {}) => request({ ...renderOptions, type: "render", frames }),
    ...Object.fromEntries(Object.keys(ENGINE_API).map((method) => [method, (...args) => call(method, ...args)])),
  });
}

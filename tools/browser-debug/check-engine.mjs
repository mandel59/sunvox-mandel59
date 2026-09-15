import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../", import.meta.url));
const fixture = path.join(root, "var/engine-browser-check");
await mkdir(fixture, { recursive: true });
await writeFile(path.join(fixture, "index.html"), `<button id="audio">Start audio</button><script type="module">import { createSunVoxEngine } from "@mandel59/sunvox-web"; globalThis.createSunVoxEngine = createSunVoxEngine;</script>`);
await build({ root: fixture, configFile: false, base: "./", logLevel: "warn" });
const mime = { ".html": "text/html", ".js": "text/javascript", ".wasm": "application/wasm" };
const server = http.createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = pathname === "/" ? path.join(fixture, "dist/index.html")
      : pathname.startsWith("/assets/") ? path.join(fixture, "dist", pathname)
      : path.resolve(root, "." + pathname);
    if (path.relative(root, file).startsWith("..")) throw new Error("Invalid path");
    response.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
    response.end(await readFile(file));
  } catch { response.writeHead(404); response.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  try { browser = await chromium.launch(); }
  catch { browser = await chromium.launch({ channel: "msedge" }); }
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => typeof createSunVoxEngine === "function");
  const result = await page.evaluate(async () => {
    const options = { runtimeBaseUrl: "/sunvox_lib/sunvox_lib/js/lib/" };
    const engine = createSunVoxEngine(options);
    const other = createSunVoxEngine(options);
    globalThis.engine = engine;
    globalThis.otherEngine = other;
    const [info] = await Promise.all([engine.initialize(), engine.initialize(), other.initialize()]);
    await Promise.all([engine.sv_open_slot(0), other.sv_open_slot(0)]);
    await engine.sv_set_song_name(0, "Browser engine");
    const otherName = await other.sv_get_song_name(0);
    const mod = await engine.sv_new_module(0, "Generator", "Lead", 0, 0, 0);
    await engine.sv_connect_module(0, mod, 0);
    globalThis.engineModule = mod;
    const source = new Uint8Array(await (await fetch("/music/2022-04-17.sunvox")).arrayBuffer());
    await engine.sv_open_slot(1);
    const loading = engine.sv_load_from_memory(1, source);
    source.fill(0); // Must not change the queued payload or detach the caller's buffer.
    const loadResult = await loading;
    const saved = await engine.sv_save_to_memory(1);
    const name = await engine.sv_get_song_name(1);
    await engine.sv_send_event(0, 0, 61, 128, mod + 1, 0, 0);
    const rendered = await engine.render(4096);
    await engine.sv_send_event(0, 0, 128, 0, 0, 0, 0);
    let unsupportedRejected = false;
    try { await engine.call("sv_deinit"); } catch { unsupportedRejected = true; }
    const originalConnect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
      if (this instanceof AudioWorkletNode) {
        const analyser = this.context.createAnalyser();
        originalConnect.call(this, analyser);
        globalThis.engineAnalyser = analyser;
      }
      return originalConnect.call(this, destination, ...args);
    };
    document.querySelector("#audio").onclick = () => {
      globalThis.audioStarted = engine.startAudio().then(() => engine.sv_send_event(0, 0, 61, 128, mod + 1, 0, 0));
    };
    return { info, otherName, loadResult, saved: saved instanceof Uint8Array && saved.length > 0,
      name, sourceRetained: source.length > 0, peak: rendered.data.reduce((v, x) => Math.max(v, Math.abs(x)), 0), unsupportedRejected };
  });
  assert.equal(result.loadResult, 0);
  assert.notEqual(result.otherName, "Browser engine");
  assert.ok(result.saved && result.sourceRetained && result.unsupportedRejected);
  assert.ok(result.peak > 0.00001);
  await page.click("#audio");
  await page.evaluate(() => audioStarted);
  await page.waitForFunction(() => {
    const samples = new Float32Array(engineAnalyser.fftSize);
    engineAnalyser.getFloatTimeDomainData(samples);
    return samples.some((sample) => Math.abs(sample) > 0.00001);
  });
  const cleanup = await page.evaluate(async () => {
    let renderRejected = false;
    try { await engine.render(128); } catch { renderRejected = true; }
    await engine.stopAudio();
    const afterStop = await engine.render(128);
    // Restart verifies MessagePort replacement and output lifecycle.
    await engine.startAudio(); await engine.stopAudio();
    const pending = engine.sv_get_song_name(0);
    engine.dispose(); otherEngine.dispose();
    let pendingRejected = false;
    try { await pending; } catch { pendingRejected = true; }
    let disposedRejected = false;
    try { await engine.initialize(); } catch { disposedRejected = true; }
    return { renderRejected, offlineFrames: afterStop.data.length / 2, pendingRejected, disposedRejected };
  });
  assert.deepEqual(cleanup, { renderRejected: true, offlineFrames: 128, pendingRejected: true, disposedRejected: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ result, cleanup, errors }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

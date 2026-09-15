import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { FMX_TINES } from "../../packages/sunvox-synth/test/fmx-tines.fixture.js";
import { withSunVoxSlot, loadProjectFromBuffer, loadSynthModuleFromBuffer } from "../sunvox-node.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const dist = path.join(root, "packages/sunvox-synth/dist");
const artifacts = path.join(root, "var/issue-71");
await mkdir(artifacts, { recursive: true });
const isolated = process.argv.includes("--isolation");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".txt": "text/plain" };
const server = http.createServer(async (req, res) => {
  try {
    const pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    // Exercise deployment under a subdirectory.
    if (!pathname.startsWith("/synth/")) throw new Error("Invalid base");
    const file = path.resolve(dist, pathname.slice(7) || "index.html");
    if (path.relative(dist, file).startsWith("..")) throw new Error("Invalid path");
    if (isolated) {
      res.setHeader("Cross-Origin-Opener-Policy", "same-origin");
      res.setHeader("Cross-Origin-Embedder-Policy", "require-corp");
    }
    res.setHeader("Content-Type", mime[path.extname(file)] ?? "application/octet-stream");
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  try { browser = await chromium.launch(); }
  catch { browser = await chromium.launch({ channel: "msedge" }); }
  const page = await browser.newPage({ hasTouch: true, viewport: { width: 1280, height: 1000 } });
  page.setDefaultTimeout(15000); const errors = [];
  page.on("pageerror", (error) => { errors.push(error.message); console.log(error.message); }); page.on("console", msg => console.log("browser:", msg.text()));
  await page.addInitScript(() => {
    window.engineCommands = [];
    const post = Worker.prototype.postMessage;
    Worker.prototype.postMessage = function(message, ...rest) {
      if (message.type === "command") window.engineCommands.push(message.payload);
      return post.call(this, message, ...rest);
    };
    const connect = AudioNode.prototype.connect;
    AudioNode.prototype.connect = function(destination, ...args) {
      if (this instanceof AudioWorkletNode) {
        window.testAnalyser = this.context.createAnalyser();
        connect.call(this, window.testAnalyser);
      }
      return connect.call(this, destination, ...args);
    };
    window.peak = () => {
      const data = new Float32Array(window.testAnalyser.fftSize);
      window.testAnalyser.getFloatTimeDomainData(data);
      return data.reduce((p, value) => Math.max(p, Math.abs(value)), 0);
    };
  });
  console.log("browser launched"); await page.goto("http://127.0.0.1:" + server.address().port + "/synth/");
  assert.equal(await page.locator(".key").count(), 45);
  await page.click("#start"); console.log("starting");
  await page.waitForFunction(() => document.querySelector("#start").textContent === "音声 ON");
  console.log("ready"); assert.equal(await page.evaluate(() => crossOriginIsolated), isolated);
  assert.ok(await page.locator("#controls input").count() > 119);
  assert.ok(await page.evaluate(() => engineCommands.some(c => c.command?.method === "sv_load_module_from_memory")));
  for (const ctl of FMX_TINES.controllers) {
    assert.equal(await page.getByRole("slider", { name: "FMX " + ctl.name, exact: true, includeHidden: true }).inputValue(), String(ctl.value));
  }
  await page.keyboard.down("KeyZ");
  await page.keyboard.down("KeyX");
  await page.waitForFunction(() => peak() > 0.001);
  const events = await page.evaluate(() => engineCommands.filter(c => c.command?.method === "sv_send_event" && c.command.args[2] === 133).map(c => c.command.args));
  assert.equal(events.length, 2);
  assert.notEqual(events[0][1], events[1][1]);
  assert.ok(Math.abs(events[0][6] - events[1][6] - 3072 * 24 / 41) < 1);
  await page.keyboard.up("KeyZ");
  assert.equal(await page.locator(".key.active").count(), 1);
  await page.keyboard.up("KeyX");
  await page.keyboard.down("KeyA");
  await page.keyboard.down("KeyD");
  await page.keyboard.down("KeyG");
  await page.waitForFunction(() => peak() > 0.001);
  assert.equal(await page.locator(".key.active").count(), 3);
  for (const key of ["KeyA", "KeyD", "KeyG"]) await page.keyboard.up(key);
  await page.waitForFunction(() => document.querySelectorAll(".key.active").length === 0);
  await page.keyboard.down("KeyA");
  await page.click("#panic");
  await page.keyboard.up("KeyA");
  await page.waitForFunction(() => peak() < 0.00001);
  assert.equal(await page.locator(".key.active").count(), 0);
  const key = page.locator('.key[data-code="KeyG"]');
  await key.scrollIntoViewIfNeeded(); const box = await key.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height - 20);
  await page.mouse.down();
  await page.waitForFunction(() => peak() > 0.001);
  await page.mouse.move(5, 5);
  await page.mouse.up();
  assert.equal(await page.locator(".key.active").count(), 0);
  await page.keyboard.down("KeyS");
  await page.evaluate(() => window.dispatchEvent(new Event("blur")));
  await page.keyboard.up("KeyS");
  assert.equal(await page.locator(".key.active").count(), 0);
  await page.keyboard.down("KeyQ");
  await page.keyboard.down("KeyW");
  assert.equal(await page.locator(".key.active").count(), 2);
  await page.keyboard.up("KeyQ");
  assert.equal(await page.locator(".key.active").count(), 1);
  await page.selectOption("#octave", "5");
  assert.equal(await page.locator(".key.active").count(), 0);
  await page.keyboard.up("KeyW");
  assert.match(await page.locator('.key[data-code="KeyZ"]').getAttribute("aria-label"), /523\.25 Hz/);
  for (const [code, step] of Object.entries({KeyZ:0, KeyX:24, KeyC:7, KeyV:31, KeyB:14, KeyM:21, Comma:45, Period:28, Slash:52, KeyS:13, KeyE:26, Digit4:39})) {
    assert.equal(await page.locator('.key[data-code="' + code + '"]').getAttribute("data-step"), String(step));
  }
  await page.keyboard.down("Comma");
  const commaEvent = await page.evaluate(() => engineCommands.filter(c => c.command?.method === "sv_send_event" && c.command.args[2] === 133).at(-1).command.args);
  const commaHz = 440 * 2 ** (1 - 9 / 12 + 45 / 41); // C5 root, +45 EDO steps
  assert.equal(commaEvent[6], Math.round(30720 - Math.log2(commaHz / 16.333984375) * 3072));
  await page.keyboard.up("Comma");
  const range = page.locator("#controls input").first();
  await range.fill("16384");
  await range.dispatchEvent("input");
  assert.equal(await range.locator("..").locator("output").textContent(), "16384");
  await range.fill(String(FMX_TINES.controllers[0].value));
  await range.dispatchEvent("input");
  const downloadPromise = page.waitForEvent("download");
  await page.click("#save");
  const download = await downloadPromise;
  const savedPath = path.join(artifacts, isolated ? "patch-isolated.sunvox" : "patch.sunvox");
  await download.saveAs(savedPath);
  const bytes = await readFile(savedPath);
  assert.equal(bytes.subarray(0, 4).toString(), "SVOX");
  assert.ok(bytes.length > 100);
  assert.ok(bytes.includes(Buffer.from("FMX")));
  const reference = await readFile(path.join(root, "generated/instruments/Scratch FMX Tines.sunsynth"));
  await withSunVoxSlot({}, async ({module, slot}) => {
    loadProjectFromBuffer(module, bytes, {slot});
    const referenceModule = loadSynthModuleFromBuffer(module, reference, {slot, connectToOutput:false});
    assert.equal(module._sv_get_number_of_module_ctls(slot, 1), 119);
    for (let i=0; i<119; i++) assert.equal(module._sv_get_module_ctl_value(slot, 1, i, 0), module._sv_get_module_ctl_value(slot, referenceModule, i, 0), "preset controller " + i);
    assert.equal(module._sv_get_module_finetune(slot, 1), module._sv_get_module_finetune(slot, referenceModule));
  });
  for (const file of ["LICENSE.txt", "sundog.txt", "libflac.txt", "tremor.txt"]) {
    const response = await page.request.get("http://127.0.0.1:" + server.address().port + "/synth/sunvox_lib/license/" + file);
    assert.equal(response.status(), 200);
  }
  await page.screenshot({ path: path.join(artifacts, "desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  const touchKey = page.locator('.key[data-code="KeyZ"]');
  await touchKey.scrollIntoViewIfNeeded();
  const touchBox = await touchKey.boundingBox();
  const touchBox2 = await page.locator('.key[data-code="KeyC"]').boundingBox();
  const session = await page.context().newCDPSession(page);
  await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [
    { x: touchBox.x + touchBox.width / 2, y: touchBox.y + touchBox.height - 20, id: 1 },
    { x: touchBox2.x + touchBox2.width / 2, y: touchBox2.y + touchBox2.height - 20, id: 2 },
  ] });
  assert.equal(await page.locator(".key.active").count(), 2);
  await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
  assert.equal(await page.locator(".key.active").count(), 0);
  await page.screenshot({ path: path.join(artifacts, "mobile.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ isolated, audio: "audible", chord: "passed", panic: "silent", releaseOutside: "passed", blur: "passed", controllers: "passed", savedBytes: bytes.length, mobileOverflow: false, multiTouchAndCancel: "passed", errors }, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

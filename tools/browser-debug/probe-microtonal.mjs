import assert from "node:assert/strict";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { chromium } from "playwright";

const root = fileURLToPath(new URL("../../", import.meta.url));
const output = path.join(root, "var/microtonal-probe");
await mkdir(output, { recursive: true });
await writeFile(path.join(output, "index.html"), '<script type="module">import {createSunVoxEngine} from "@mandel59/sunvox-web"; window.createEngine = createSunVoxEngine;</script>');
await build({ root: output, configFile: false, base: "./", logLevel: "warn" });
const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost");
    const file = url.pathname.startsWith("/runtime/")
      ? path.resolve(root, "sunvox_lib/sunvox_lib/js/lib", url.pathname.slice(9))
      : path.resolve(output, "dist", url.pathname === "/" ? "index.html" : url.pathname.slice(1));
    const allowed = [path.join(output, "dist"), path.join(root, "sunvox_lib/sunvox_lib/js/lib")];
    if (!allowed.some((base) => !path.relative(base, file).startsWith(".."))) throw new Error("Invalid path");
    res.setHeader("Content-Type", file.endsWith(".wasm") ? "application/wasm" : file.endsWith(".html") ? "text/html" : "text/javascript");
    res.end(await readFile(file));
  } catch { res.writeHead(404); res.end(); }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
let browser;
try {
  try { browser = await chromium.launch(); }
  catch { browser = await chromium.launch({ channel: "msedge" }); }
  const page = await browser.newPage();
  page.setDefaultTimeout(20000);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("http://127.0.0.1:" + server.address().port);
  await page.waitForFunction(() => typeof createEngine === "function");
  const result = await page.evaluate(async () => {
    const engine = createEngine({ runtimeBaseUrl: "/runtime/" });
    const info = await engine.initialize();
    const check = (value) => { if (typeof value === "number" && value < 0) throw new Error("Native error " + value); return value; };
    const call = async (name, ...args) => check(await engine.call(name, ...args));
    const pitch = (hz) => Math.round(30720 - Math.log2(hz / 16.333984375) * 3072);
    const hzForPitch = (value) => 16.333984375 * 2 ** ((30720 - value) / 3072);
    const frequencies = [440, 440 * 2 ** (1 / 31)];
    const pitches = frequencies.map(pitch);
    const actualTargets = pitches.map(hzForPitch);
    const render = async (frames = 44100) => (await engine.render(frames)).data;
    const settle = () => render(8192);
    const event = (track, note, velocity, module, ctl, value) => call("sv_send_event", 0, track, note, velocity, module, ctl, value);
    const spectrum = (samples, frequencies, channel = 0) => frequencies.map((frequency) => {
      const frames = samples.length / 2;
      let re = 0, im = 0, weights = 0;
      for (let i = 0; i < frames; i++) {
        const w = 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (frames - 1));
        const phase = 2 * Math.PI * frequency * i / info.sampleRate;
        re += samples[i * 2 + channel] * w * Math.cos(phase);
        im -= samples[i * 2 + channel] * w * Math.sin(phase);
        weights += w;
      }
      return 2 * Math.hypot(re, im) / weights;
    });
    const estimate = (samples) => {
      const crossings = [];
      for (let i = 2; i < samples.length; i += 2) {
        if (samples[i - 2] < 0 && samples[i] >= 0) crossings.push(i / 2 - 1 - samples[i - 2] / (samples[i] - samples[i - 2]));
      }
      return crossings.length < 2 ? 0 : info.sampleRate * (crossings.length - 1) / (crossings.at(-1) - crossings[0]);
    };
    await call("sv_open_slot", 0);
    const mod = await call("sv_new_module", 0, "Generator", "Microtonal probe", 0, 0, 0);
    const filter = await call("sv_new_module", 0, "Filter", "Shared filter", 200, 0, 0);
    await call("sv_connect_module", 0, mod, filter);
    await call("sv_connect_module", 0, filter, 0);
    const ctls = {};
    for (let i = 0; i < await call("sv_get_number_of_module_ctls", 0, mod); i++) ctls[await call("sv_get_module_ctl_name", 0, mod, i)] = i;
    const set = (name, value) => call("sv_set_module_ctl_value", 0, mod, ctls[name], value, 0);
    await set("Waveform", 5);
    await set("Attack", 0);
    await set("Release", 0);
    await set("Sustain", 1);
    await set("Polyphony", 8);
    const on = (track, value) => event(track, 133, 70, mod + 1, 0, value);
    const off = (track) => event(track, 128, 0, 0, 0, 0);
    const clean = async () => { await event(0, 130, 0, 0, 0, 0); await settle(); };
    const measurements = {};
    for (const mode of [0, 1]) {
      await clean();
      await set("Mode", mode);
      await on(0, pitches[0]); await on(1, pitches[1]); await settle();
      const chord = spectrum(await render(), actualTargets);
      // A bend on track 0 is relative to its note-on pitch and must leave track 1 unchanged.
      await event(0, 0, 0, 0, 0x05, 128); await settle();
      const bendTargets = [hzForPitch(pitches[0] - 128), actualTargets[1]];
      const bent = spectrum(await render(), bendTargets);
      await off(0); await settle();
      const remaining = spectrum(await render(), bendTargets);
      await off(1); await settle();
      const silent = Math.max(...(await render(4096)).map(Math.abs));
      measurements[mode === 0 ? "stereo" : "mono"] = { chord, bendTargets, bent, remaining, silent };
    }
    await clean(); await set("Mode", 0);
    await on(0, pitches[0]); await on(1, pitches[1]); await settle();
    // Controller 3 (Panning), no module field: local to the current track's voice.
    await event(0, 0, 0, 0, 3 << 8, 0);
    await event(1, 0, 0, 0, 3 << 8, 32768);
    await settle();
    const panned = await render();
    measurements.localPan = { left: spectrum(panned, actualTargets, 0), right: spectrum(panned, actualTargets, 1) };
    await clean(); await set("Polyphony", 1);
    await on(0, pitches[0]); await settle();
    await on(1, pitches[1]); await settle();
    const stolen = spectrum(await render(), actualTargets);
    await off(0); await settle();
    const afterOldOff = spectrum(await render(), actualTargets);
    measurements.polyphonyOne = { stolen, afterOldOff };
    await clean(); await set("Polyphony", 8);
    const precision = [];
    for (let delta = 0; delta < 8; delta++) {
      await clean(); await on(0, pitches[0] + delta); await settle();
      const measured = estimate(await render());
      precision.push({ pitch: pitches[0] + delta, requestedHz: hzForPitch(pitches[0] + delta), measuredHz: measured });
    }
    await clean();
    await on(0, pitches[0]); await on(1, pitches[0]); await settle();
    await off(0); await settle();
    measurements.samePitch = { remainingAmplitude: spectrum(await render(), [actualTargets[0]])[0] };
    await off(1); await settle();
    measurements.samePitch.silent = Math.max(...(await render(4096)).map(Math.abs));
    const modulePrecision = { Generator: precision };
    for (const type of ["Analog generator", "FMX"]) {
      await clean();
      const target = await call("sv_new_module", 0, type, type, 0, 200, 0);
      await call("sv_connect_module", 0, target, 0);
      const params = [];
      for (let i = 0; i < await call("sv_get_number_of_module_ctls", 0, target); i++) {
        params.push({ index: i, name: await call("sv_get_module_ctl_name", 0, target, i), value: await call("sv_get_module_ctl_value", 0, target, i, 0) });
      }
      const setIndex = (i, value) => call("sv_set_module_ctl_value", 0, target, i, value, 0);
      if (type === "Analog generator") {
        for (const [name, value] of [["Waveform", 5], ["Attack", 0], ["Release", 0], ["Sustain", 1], ["Osc2", 1000], ["Filter", 0]]) {
          const param = params.find(p => p.name === name);
          if (!param) throw new Error("Missing controller " + name);
          await setIndex(param.index, value);
        }
      } else {
        // Controllers are grouped by parameter, then operator; only operator 5 is audible.
        for (let op = 0; op < 5; op++) {
          const base = 9 + op;
          await setIndex(base, op === 4 ? 32768 : 0);
          await setIndex(base + 5, 0); // Attack
          await setIndex(base + 15, 32768); // Sustain level
          await setIndex(base + 40, 1); // Sustain
          await setIndex(base + 65, 6); // Sine
          await setIndex(base + 80, 1000); // 1:1 frequency
          await setIndex(base + 85, 8192); // No constant pitch
          await setIndex(base + 90, 0); // No self modulation
          await setIndex(base + 95, 0); // No feedback
        }
      }
      for (const accuracy of (type === "FMX" ? [null] : [0, 1])) {
        if (accuracy !== null) await event(0, 0, 0, target + 1, 0x7200, accuracy);
        const rows = [];
        for (let delta = 0; delta < 8; delta++) {
          await clean();
          await event(0, 133, 70, target + 1, 0, pitches[0] + delta);
          await settle();
          const samples = await render();
          const peak = samples.reduce((p, x) => Math.max(p, Math.abs(x)), 0);
          const measured = estimate(samples);
          rows.push({ pitch: pitches[0] + delta, requestedHz: hzForPitch(pitches[0] + delta), measuredHz: measured, peak });
        }
        modulePrecision[type + (accuracy === null ? "" : " accuracy=" + accuracy)] = rows;
      }
      await clean();
      await call("sv_remove_module", 0, target);
    }
    engine.dispose();
    return { info, graph: "Generator -> Filter -> Output", frequencies, pitches, actualTargets, measurements, precision, modulePrecision };
  });
  await writeFile(path.join(output, "results.json"), JSON.stringify({ ...result, errors }, null, 2) + "\n");
  for (const mode of ["stereo", "mono"]) {
    const data = result.measurements[mode];
    assert.ok(data.chord.every((value) => value > 0.01), mode + ": two independent pitches");
    assert.ok(data.bent.every((value) => value > 0.01), mode + ": per-track bend");
    assert.ok(data.remaining[0] < 0.001 && data.remaining[1] > 0.01, mode + ": independent note-off");
    assert.ok(data.silent < 0.00001);
  }
  const pan = result.measurements.localPan;
  assert.ok(pan.left[0] > 0.01 && pan.left[1] < 0.001);
  assert.ok(pan.right[1] > 0.01 && pan.right[0] < 0.001);
  const stolen = result.measurements.polyphonyOne;
  assert.ok(stolen.stolen[0] < 0.001 && stolen.stolen[1] > 0.01);
  assert.ok(stolen.afterOldOff[1] > 0.01);
  assert.ok(result.measurements.samePitch.remainingAmplitude > 0.01);
  assert.ok(result.measurements.samePitch.silent < 0.00001);
  for (const rows of Object.values(result.modulePrecision)) {
    assert.ok(rows.every(row => row.measuredHz > 430 && row.measuredHz < 450));
    for (let i = 2; i <= 4; i++) assert.ok(Math.abs(rows[i].measuredHz - rows[1].measuredHz) < 0.0001);
    assert.ok(Math.abs(rows[0].measuredHz - rows[1].measuredHz) > 0.1);
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify(result, null, 2));
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}

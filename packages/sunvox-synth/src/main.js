import { createSunVoxEngine, NOTECMD_SET_PITCH, NOTECMD_NOTE_OFF, NOTECMD_CLEAN_SYNTHS } from "@mandel59/sunvox-web";
import "./style.css";
import tinesUrl from "../assets/scratch-fmx-tines.sunsynth?url";
import { PERFORMANCE_PRESETS, DEFAULT_PRESET_ID, createKeyLayout, getPreset, toneForStep, formatStep } from "./tuning.js";

const $ = (selector) => document.querySelector(selector);
let engine, generator, ready = false, meterTimer;
const held = new Map();
let keys = [];
let codeMap = new Map();
let tuning = getPreset(DEFAULT_PRESET_ID);
const check = (value) => {
  if (typeof value === "number" && value < 0) throw new Error("SunVox error: " + value);
  return value;
};
function report(error) { $("#status").textContent = "エラー: " + error.message; }
function run(promise) { promise.catch(report); }

function refreshKeys() {
  for (const { button, entry } of keys) {
    const active = [...held.values()].some((voice) => voice.code === entry.code);
    button.classList.toggle("active", active);
    button.setAttribute("aria-pressed", String(active));
    const { frequency } = toneForStep(entry.step, Number($("#octave").value), tuning);
    const label = entry.label + " · " + formatStep(entry.step) + " 段 · " + frequency.toFixed(2) + " Hz";
    button.setAttribute("aria-label", label);
    button.title = label;
  }
  $("#voices").textContent = held.size + " KEYS HELD";
}
function noteOn(source, entry) {
  if (!ready || held.has(source)) return;
  const occupied = new Set([...held.values()].map((voice) => voice.track));
  const track = Array.from({ length: 32 }, (_, i) => i).find((i) => !occupied.has(i));
  if (track === undefined) return;
  const { pitch, frequency } = toneForStep(entry.step, Number($("#octave").value), tuning);
  held.set(source, { code: entry.code, track });
  $("#status").textContent = entry.label + " · " + formatStep(entry.step) + " / " + tuning.edo + " · " + frequency.toFixed(2) + " Hz";
  refreshKeys();
  // Send immediately so a following note-off cannot overtake this note-on.
  run(engine.sv_send_event(0, track, NOTECMD_SET_PITCH, 100, generator + 1, 0, pitch).then(check));
}
function noteOff(source) {
  const voice = held.get(source);
  if (!voice) return;
  held.delete(source);
  refreshKeys();
  run(engine.sv_send_event(0, voice.track, NOTECMD_NOTE_OFF, 0, 0, 0, 0).then(check));
}
function panic() {
  held.clear();
  refreshKeys();
  if (ready) run(engine.sv_send_event(0, 0, NOTECMD_CLEAN_SYNTHS, 0, 0, 0, 0).then(check));
}

function renderKeyboard() {
  keys = [];
  const keyLayout = createKeyLayout(tuning);
  codeMap = new Map(keyLayout.map(entry => [entry.code, entry]));
  $("#keyboard").replaceChildren();
  $("#keyboard-title").textContent = tuning.label;
  $("#keyboard").setAttribute("aria-label", tuning.label + " 鍵盤");
  $("#layout-description").textContent = tuning.edo + "平均律。右へ " + formatStep(tuning.horizontal) + " 段、右上へ " + formatStep(tuning.diagonal) + " 段。X が基準音です。";
  for (const entry of keyLayout) {
    const { code, label, row, step } = entry;
    let rowElement = document.querySelector('[data-row="' + row + '"]');
    if (!rowElement) {
      rowElement = document.createElement("div");
      rowElement.className = "key-row";
      rowElement.dataset.row = row;
      $("#keyboard").append(rowElement);
    }
    const button = document.createElement("button");
    button.className = "key";
    button.classList.toggle("root", step % tuning.edo === 0);
    button.disabled = !ready;
    button.dataset.code = code;
    button.dataset.step = step;
    const caption = document.createElement("strong");
    caption.textContent = label;
    const degree = document.createElement("span");
    degree.textContent = formatStep(step);
    button.append(caption, degree);
    button.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      button.setPointerCapture(event.pointerId);
      noteOn("pointer-" + event.pointerId, entry);
    });
    for (const type of ["pointerup", "pointercancel", "lostpointercapture"]) {
      button.addEventListener(type, (event) => noteOff("pointer-" + event.pointerId));
    }
    button.addEventListener("keydown", (event) => {
      if (event.code === "Space" || event.code === "Enter") {
        event.preventDefault();
        if (!event.repeat) noteOn("button-" + code, entry);
      }
    });
    button.addEventListener("keyup", (event) => {
      if (event.code === "Space" || event.code === "Enter") noteOff("button-" + code);
    });
    button.addEventListener("blur", () => noteOff("button-" + code));
    keys.push({ button, entry });
    rowElement.append(button);
  }
  refreshKeys();
}
for (const preset of PERFORMANCE_PRESETS) $("#preset").add(new Option(preset.label, preset.id, false, preset.id === DEFAULT_PRESET_ID));
$("#preset").addEventListener("change", (event) => {
  const nextPreset = getPreset(event.currentTarget.value);
  panic();
  tuning = nextPreset;
  renderKeyboard();
  event.currentTarget.blur();
});
renderKeyboard();
window.addEventListener("keydown", (event) => {
  const entry = codeMap.get(event.code);
  if (!entry || event.isComposing || event.ctrlKey || event.metaKey || event.altKey ||
      event.target.matches("input, select, textarea, [contenteditable]")) return;
  event.preventDefault();
  if (!event.repeat) noteOn(event.code, entry);
});
window.addEventListener("keyup", (event) => {
  if (codeMap.has(event.code) && !event.ctrlKey && !event.metaKey && !event.altKey &&
      !event.isComposing && !event.target.matches("input, select, textarea, [contenteditable]")) event.preventDefault();
  noteOff(event.code);
});
window.addEventListener("blur", panic);
document.addEventListener("visibilitychange", () => { if (document.hidden) panic(); });
$("#octave").addEventListener("change", panic);
$("#panic").addEventListener("click", panic);

async function addControllers(module, title) {
  const section = document.createElement("section");
  const heading = document.createElement("h3");
  heading.textContent = title;
  const grid = document.createElement("div");
  grid.className = "control-grid";
  const extra = document.createElement("details");
  const summary = document.createElement("summary");
  summary.textContent = "すべてのパラメーター";
  const extraGrid = document.createElement("div");
  extraGrid.className = "control-grid";
  extra.append(summary, extraGrid);
  section.append(heading, grid, extra);
  const count = await engine.sv_get_number_of_module_ctls(0, module);
  for (let ctl = 0; ctl < count; ctl++) {
    const [name, min, max, value] = await engine.batch([
      { method: "sv_get_module_ctl_name", args: [0, module, ctl] },
      { method: "sv_get_module_ctl_min", args: [0, module, ctl, 0] },
      { method: "sv_get_module_ctl_max", args: [0, module, ctl, 0] },
      { method: "sv_get_module_ctl_value", args: [0, module, ctl, 0] },
    ]);
    const label = document.createElement("label");
    label.className = "control";
    const output = document.createElement("output");
    output.textContent = value;
    const input = document.createElement("input");
    Object.assign(input, { type: "range", min, max, step: 1, value });
    input.setAttribute("aria-label", title + " " + name);
    input.addEventListener("input", () => {
      if (title === "FMX" && ctl === 3) panic();
      output.textContent = input.value;
      run(engine.sv_set_module_ctl_value(0, module, ctl, Number(input.value), 0).then(check));
    });
    label.append(name, output, input);
    const primary = title === "FMX" ? [0, 3, 12, 13, 92, 93].includes(ctl) : ctl < 6;
    (primary ? grid : extraGrid).append(label);
  }
  extra.hidden = count <= 6;
  $("#controls").append(section);
}

const canvas = $("#scope");
const ctx = canvas.getContext("2d");
function draw(samples = []) {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.strokeStyle = "#293841";
  ctx.beginPath();
  ctx.moveTo(0, 90); ctx.lineTo(640, 90); ctx.stroke();
  ctx.strokeStyle = "#b1ed89";
  ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < samples.length; i++) {
    const x = i / Math.max(1, samples.length - 1) * 640;
    const y = 90 - samples[i] / 32768 * 80;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.stroke();
}
draw();
async function meter() {
  if (!ready) return;
  try {
    if (!document.hidden) {
      const { data } = await engine.sv_get_module_scope2(0, 0, 0, 512);
      draw(data);
    }
  } catch (error) { report(error); }
  if (ready) meterTimer = setTimeout(meter, 60);
}

$("#start").addEventListener("click", async () => {
  $("#start").disabled = true;
  $("#status").textContent = "音声エンジンを準備しています…";
  const next = createSunVoxEngine({ runtimeBaseUrl: new URL("./sunvox_lib/", location.href) });
  engine = next;
  try {
    // startAudio runs before the first await to retain the click gesture.
    await next.startAudio();
    check(await next.sv_open_slot(0));
    check(await next.sv_set_song_name(0, "SunVox Synth patch"));
    const response = await fetch(tinesUrl);
    if (!response.ok) throw new Error("初期音色の読み込みに失敗しました");
    const presetBytes = new Uint8Array(await response.arrayBuffer());
    generator = check(await next.sv_load_module_from_memory(0, presetBytes, 200, 200, 0));
    const filter = check(await next.sv_new_module(0, "Filter", "Tone", 400, 200, 0));
    const results = await next.batch([
      { method: "sv_connect_module", args: [0, generator, filter] },
      { method: "sv_connect_module", args: [0, filter, 0] },
      { method: "sv_volume", args: [0, Math.round(Number($("#volume").value) * 256 / 100)] },
    ]);
    results.forEach(check);
    $("#controls").replaceChildren();
    await addControllers(generator, "FMX");
    await addControllers(filter, "FILTER");
    ready = true;
    for (const selector of ["#volume", "#save", "#panic", "#octave", ".key"]) {
      document.querySelectorAll(selector).forEach((element) => { element.disabled = false; });
    }
    $("#start").textContent = "音声 ON";
    $("#status").textContent = "演奏できます · 鍵盤を押して音を鳴らしましょう";
    meter();
  } catch (error) {
    next.dispose();
    $("#controls").replaceChildren();
    $("#start").disabled = false;
    $("#start").textContent = "再試行";
    report(error);
  }
});
$("#volume").addEventListener("input", () => {
  const value = Number($("#volume").value);
  $("#volume-value").textContent = value + "%";
  if (ready) run(engine.sv_volume(0, Math.round(value * 256 / 100)).then(check));
});
$("#save").addEventListener("click", async () => {
  $("#save").disabled = true;
  try {
    const bytes = await engine.sv_save_to_memory(0);
    if (!bytes?.length) throw new Error("音色の保存に失敗しました");
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = "sunvox-synth.sunvox";
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) { report(error); }
  finally { $("#save").disabled = false; }
});
window.addEventListener("pagehide", (event) => {
  panic();
  if (!event.persisted) {
    ready = false;
    clearTimeout(meterTimer);
    engine?.dispose();
  }
});

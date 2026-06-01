import React, { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { createRoot } from "react-dom/client";

import { buildGraphLayout } from "./project-graph.js";
import "./styles.css";

const PROJECT_INDEX_PATH = "site-data/sunvox-projects.json";
const GRAPH_NODE_HALF_WIDTH = 39;
const GRAPH_NODE_HALF_HEIGHT = 21;
const GRAPH_LABEL_INSET = 2;
const TIMELINE_LANE_HEIGHT = 32;
const TIMELINE_PATTERN_HEIGHT = 28;
const TIMELINE_PATTERN_Y_INSET = (TIMELINE_LANE_HEIGHT - TIMELINE_PATTERN_HEIGHT) / 2;
const TIMELINE_ICON_ONLY_LINE_LIMIT = 63;
const TIMELINE_Y_PADDING = 16;
const MASTER_VOLUME_MAX = 256;
const DEFAULT_MASTER_VOLUME = 256;
const SYNTH_KEYBOARD_BASE_START_NOTE = 48;
const SYNTH_KEYBOARD_NOTE_SPAN = 24;
const SYNTH_KEYBOARD_OCTAVE_STEP = 12;
const SYNTH_KEYBOARD_MIN_START_NOTE = 0;
const SYNTH_KEYBOARD_MAX_START_NOTE = 96;
const SYNTH_KEYBOARD_VELOCITY = 128;
const SYNTH_VOLUME_CONTROLLER_MAX = 1024;
const SYNTH_USER_CONTROLLER_MAX = 32768;
const METAMODULE_USER_CONTROLLER_BASE_INDEX = 5;
const KNOB_START_ANGLE = -135;
const KNOB_SWEEP_ANGLE = 270;
const KNOB_DRAG_PIXELS = 180;
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const BLACK_KEY_PITCH_CLASSES = new Set([1, 3, 6, 8, 10]);
const KEYBOARD_NOTE_OFFSETS = new Map([
  ["KeyZ", 0],
  ["KeyS", 1],
  ["KeyX", 2],
  ["KeyD", 3],
  ["KeyC", 4],
  ["KeyV", 5],
  ["KeyG", 6],
  ["KeyB", 7],
  ["KeyH", 8],
  ["KeyN", 9],
  ["KeyJ", 10],
  ["KeyM", 11],
  ["KeyQ", 12],
  ["Digit2", 13],
  ["KeyW", 14],
  ["Digit3", 15],
  ["KeyE", 16],
  ["KeyR", 17],
  ["Digit5", 18],
  ["KeyT", 19],
  ["Digit6", 20],
  ["KeyY", 21],
  ["Digit7", 22],
  ["KeyU", 23],
  ["KeyI", 24],
]);
const FILE_HASH_PREFIX = "#file=";
const LEGACY_SUNSYNTH_RECIPE_PREFIX = "generated/recipes/sunsynth/";
const SUNVOX_EDIT_RECIPE_PREFIX = "generated/recipes/sunvox-edit/";

function projectPermalinkHash(path) {
  return `${FILE_HASH_PREFIX}${encodeURIComponent(path)}`;
}

function projectPermalinkUrl(path) {
  const hash = projectPermalinkHash(path);
  if (typeof window === "undefined") {
    return hash;
  }
  const url = new URL(window.location.href);
  url.hash = hash;
  return url.href;
}

async function copyText(text) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return;
    } catch {
      // Fall back for embedded browsers that expose Clipboard API but reject writes.
    }
  }
  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.setAttribute("readonly", "");
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  document.body.append(textArea);
  textArea.focus();
  textArea.select();
  textArea.setSelectionRange(0, text.length);
  const copied = document.execCommand("copy");
  textArea.remove();
  if (!copied) {
    throw new Error("Copy command failed");
  }
}

function selectedPathFromLocation() {
  if (typeof window === "undefined" || !window.location.hash.startsWith(FILE_HASH_PREFIX)) {
    return "";
  }
  try {
    return decodeURIComponent(window.location.hash.slice(FILE_HASH_PREFIX.length));
  } catch {
    return "";
  }
}

function compact(value) {
  return value === undefined || value === null || value === "" ? "-" : value;
}

function sourceRecipeLink(sourceRecipe) {
  if (!sourceRecipe) {
    return undefined;
  }
  const path = sourceRecipe.path?.startsWith(LEGACY_SUNSYNTH_RECIPE_PREFIX)
    ? sourceRecipe.path.replace(LEGACY_SUNSYNTH_RECIPE_PREFIX, SUNVOX_EDIT_RECIPE_PREFIX)
    : sourceRecipe.path;
  return { ...sourceRecipe, path };
}

function typeLabel(project) {
  return project.type === "synth" ? "SunSynth" : "SunVox";
}

function moduleHexId(value) {
  return value.toString(16).toUpperCase().padStart(2, "0");
}

function svgId(value) {
  return value.replaceAll(/[^A-Za-z0-9_-]/g, "-");
}

function metric(label, value) {
  return (
    <div className="metric">
      <strong>{compact(value)}</strong>
      {label}
    </div>
  );
}

function flagList(flags) {
  if (!flags) {
    return [];
  }
  if (Array.isArray(flags)) {
    return flags;
  }
  return Object.entries(flags)
    .filter(([, value]) => value === true)
    .map(([name]) => name);
}

function canPlay(project) {
  return project?.type === "project";
}

function playProject(project) {
  if (canPlay(project)) {
    window.loadAndPlay?.(project.path);
  }
}

function stopPlayer() {
  window.stopPlayback?.();
}

function volumePercent(volume) {
  return Math.round((volume / MASTER_VOLUME_MAX) * 100);
}

function noteName(note) {
  return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12)}`;
}

function keyboardNoteLabel(notes) {
  if (!notes.size) {
    return "Ready";
  }
  const names = [...notes].sort((left, right) => left - right).map(noteName);
  if (names.length <= 3) {
    return names.join(" ");
  }
  return `${names.slice(0, 2).join(" ")} +${names.length - 2}`;
}

function keyboardNotes(startNote) {
  const notes = [];
  let whiteIndex = -1;
  for (let note = startNote; note <= startNote + SYNTH_KEYBOARD_NOTE_SPAN; note += 1) {
    const pitchClass = note % 12;
    const black = BLACK_KEY_PITCH_CLASSES.has(pitchClass);
    if (!black) {
      whiteIndex += 1;
    }
    notes.push({
      note,
      name: noteName(note),
      black,
      whiteIndex: black ? whiteIndex : whiteIndex,
    });
  }
  return notes;
}

function clampKeyboardStartNote(note) {
  return Math.min(SYNTH_KEYBOARD_MAX_START_NOTE, Math.max(SYNTH_KEYBOARD_MIN_START_NOTE, note));
}

function mappedKeyboardNote(code, startNote) {
  const offset = KEYBOARD_NOTE_OFFSETS.get(code);
  return offset === undefined ? undefined : startNote + offset;
}

function shouldIgnoreKeyboardEvent(event) {
  if (event.altKey || event.ctrlKey || event.metaKey) {
    return true;
  }
  const target = event.target;
  return Boolean(
    target?.closest?.("input, textarea, select, [contenteditable='true'], .instrument-knob"),
  );
}

function pointerSourceId(pointerId) {
  return `pointer:${pointerId}`;
}

function keySourceId(code) {
  return `key:${code}`;
}

function numericControllerValue(value, fallback = 0) {
  return Number.isFinite(value) ? Math.round(value) : fallback;
}

function clampControllerValue(control, value) {
  return Math.max(control.min, Math.min(control.max, numericControllerValue(value, control.value)));
}

function controllerRatio(control, value) {
  if (control.max <= control.min) {
    return 0;
  }
  return (clampControllerValue(control, value) - control.min) / (control.max - control.min);
}

function controllerKeyboardStep(control, multiplier = 1) {
  const coarseStep = Math.max(control.step, Math.round((control.max - control.min) / 128));
  return coarseStep * multiplier;
}

function synthInstrumentControls(project) {
  if (project?.type !== "synth") {
    return [];
  }
  const controls = [];
  const volume = project.synth?.controllers?.find((controller) => controller.index === 0 || controller.path === "volume");
  if (Number.isFinite(volume?.value)) {
    controls.push({
      key: "controller-volume",
      label: volume.label ?? "Volume",
      controllerIndex: 0,
      value: numericControllerValue(volume.value, 256),
      min: 0,
      max: SYNTH_VOLUME_CONTROLLER_MAX,
      step: 1,
    });
  }
  for (const controller of project.synth?.userControllers ?? []) {
    const index = Number.isInteger(controller.index) ? controller.index : controls.length;
    controls.push({
      key: `user-controller-${index}`,
      label: controller.label ?? `User ${index + 1}`,
      controllerIndex: METAMODULE_USER_CONTROLLER_BASE_INDEX + index,
      value: numericControllerValue(controller.value),
      min: 0,
      max: SYNTH_USER_CONTROLLER_MAX,
      step: 1,
    });
  }
  return controls;
}

function synthControllerValueMap(controls) {
  return Object.fromEntries(controls.map((control) => [control.key, control.value]));
}

function TopbarControls({ project, volume, onVolumeChange }) {
  const playable = canPlay(project);
  return (
    <div className="topbar-controls" aria-label="Playback controls">
      <button type="button" disabled={!playable} onClick={() => playProject(project)}>
        <span aria-hidden="true">▶</span>
        Play
      </button>
      <button type="button" onClick={stopPlayer}>
        <span aria-hidden="true">■</span>
        Stop
      </button>
      <label className="volume-control">
        <span>Master</span>
        <input
          type="range"
          min="0"
          max={MASTER_VOLUME_MAX}
          step="1"
          value={volume}
          aria-label="Master volume"
          onChange={(event) => onVolumeChange(Number(event.target.value))}
        />
        <output>{volumePercent(volume)}%</output>
      </label>
    </div>
  );
}

function InstrumentKnobControl({ control, value, onChange }) {
  const dragRef = useRef(undefined);
  const ratio = controllerRatio(control, value);
  const angle = KNOB_START_ANGLE + ratio * KNOB_SWEEP_ANGLE;

  function changeBy(rawValue) {
    onChange(control, rawValue);
  }

  function beginDrag(event) {
    event.preventDefault();
    dragRef.current = {
      x: event.clientX,
      y: event.clientY,
      value,
    };
    try {
      event.currentTarget.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic pointer events in tests do not always create a capturable pointer.
    }
  }

  function updateDrag(event) {
    const drag = dragRef.current;
    if (!drag) {
      return;
    }
    event.preventDefault();
    const delta = event.clientX - drag.x + drag.y - event.clientY;
    const range = control.max - control.min;
    changeBy(drag.value + (delta / KNOB_DRAG_PIXELS) * range);
  }

  function endDrag() {
    dragRef.current = undefined;
  }

  function handleKeyDown(event) {
    let nextValue;
    switch (event.key) {
      case "ArrowRight":
      case "ArrowUp":
        nextValue = value + controllerKeyboardStep(control);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        nextValue = value - controllerKeyboardStep(control);
        break;
      case "PageUp":
        nextValue = value + controllerKeyboardStep(control, 8);
        break;
      case "PageDown":
        nextValue = value - controllerKeyboardStep(control, 8);
        break;
      case "Home":
        nextValue = control.min;
        break;
      case "End":
        nextValue = control.max;
        break;
      default:
        return;
    }
    event.preventDefault();
    changeBy(nextValue);
  }

  return (
    <div className="instrument-control" key={control.key}>
      <span className="instrument-control-label">{control.label}</span>
      <div className="instrument-knob-row">
        <div
          className="instrument-knob"
          role="slider"
          tabIndex={0}
          aria-label={`${control.label} controller`}
          aria-valuemin={control.min}
          aria-valuemax={control.max}
          aria-valuenow={value}
          style={{ "--knob-angle": `${angle}deg`, "--knob-fill": `${ratio * 75}%` }}
          onPointerDown={beginDrag}
          onPointerMove={updateDrag}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
          onKeyDown={handleKeyDown}
        >
          <span className="instrument-knob-face" aria-hidden="true">
            <span className="instrument-knob-indicator" />
          </span>
        </div>
        <output className="instrument-control-value">{value}</output>
      </div>
    </div>
  );
}

function SynthKeyboardSection({ project }) {
  const [activeNotes, setActiveNotes] = useState(() => new Set());
  const [keyboardStatus, setKeyboardStatus] = useState("Ready");
  const [keyboardStartNote, setKeyboardStartNote] = useState(SYNTH_KEYBOARD_BASE_START_NOTE);
  const instrumentControls = useMemo(() => synthInstrumentControls(project), [project]);
  const [controllerValues, setControllerValues] = useState(() => synthControllerValueMap(instrumentControls));
  const keyboardRef = useRef(null);
  const activeInputNotesRef = useRef(new Map());
  const noteHoldCountsRef = useRef(new Map());
  const activeNotesRef = useRef(new Set());
  const synthKeyboardNotes = useMemo(() => keyboardNotes(keyboardStartNote), [keyboardStartNote]);
  const synthKeyboardWhiteKeys = useMemo(
    () => synthKeyboardNotes.filter((keyboardNote) => !keyboardNote.black).length,
    [synthKeyboardNotes],
  );
  const canShiftDown = keyboardStartNote > SYNTH_KEYBOARD_MIN_START_NOTE;
  const canShiftUp = keyboardStartNote < SYNTH_KEYBOARD_MAX_START_NOTE;

  useEffect(() => {
    stopAllInputNotes();
    setKeyboardStatus("Ready");
    setKeyboardStartNote(SYNTH_KEYBOARD_BASE_START_NOTE);
    setControllerValues(synthControllerValueMap(instrumentControls));
    if (project.type === "synth") {
      window.configureSynthControllers?.(
        project.path,
        instrumentControls.map((control) => ({ controllerIndex: control.controllerIndex, value: control.value })),
      );
    }
    return () => {
      stopAllInputNotes();
      if (project.type === "synth") {
        window.stopInstrumentNotes?.();
      }
    };
  }, [instrumentControls, project.path]);

  useEffect(() => {
    if (project.type !== "synth") {
      return undefined;
    }

    function handleKeyDown(event) {
      const note = mappedKeyboardNote(event.code, keyboardStartNote);
      if (note === undefined || event.repeat || shouldIgnoreKeyboardEvent(event)) {
        return;
      }
      event.preventDefault();
      startInputNote(keySourceId(event.code), note);
    }

    function handleKeyUp(event) {
      const note = mappedKeyboardNote(event.code, keyboardStartNote);
      if (note === undefined) {
        return;
      }
      const sourceId = keySourceId(event.code);
      if (!activeInputNotesRef.current.has(sourceId) && shouldIgnoreKeyboardEvent(event)) {
        return;
      }
      event.preventDefault();
      stopInputNote(sourceId);
    }

    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [keyboardStartNote, project.path, project.type]);

  if (project.type !== "synth") {
    return null;
  }

  function noteAtPoint(clientX, clientY) {
    const keyboard = keyboardRef.current;
    if (!keyboard) {
      return undefined;
    }
    const target = document.elementFromPoint(clientX, clientY);
    const key = target?.closest?.(".piano-key");
    if (!key || !keyboard.contains(key)) {
      return undefined;
    }
    return Number(key.dataset.note);
  }

  function publishActiveNotes() {
    const notes = new Set(activeNotesRef.current);
    setActiveNotes(notes);
    setKeyboardStatus(keyboardNoteLabel(notes));
  }

  function hasHeldNote(note) {
    return [...activeInputNotesRef.current.values()].some((heldNote) => heldNote === note);
  }

  function removeHeldNote(note) {
    for (const [sourceId, heldNote] of activeInputNotesRef.current) {
      if (heldNote === note) {
        activeInputNotesRef.current.delete(sourceId);
      }
    }
    noteHoldCountsRef.current.delete(note);
    activeNotesRef.current.delete(note);
  }

  async function startInputNote(sourceId, note) {
    if (activeInputNotesRef.current.get(sourceId) === note) {
      return;
    }

    stopInputNote(sourceId);
    activeInputNotesRef.current.set(sourceId, note);

    const holdCount = noteHoldCountsRef.current.get(note) ?? 0;
    noteHoldCountsRef.current.set(note, holdCount + 1);
    if (holdCount > 0) {
      publishActiveNotes();
      return;
    }

    activeNotesRef.current.add(note);
    setActiveNotes(new Set(activeNotesRef.current));
    setKeyboardStatus("Loading");

    const played = await window.playSynthNote?.(project.path, note, SYNTH_KEYBOARD_VELOCITY);

    if (!hasHeldNote(note)) {
      if (played !== false) {
        window.stopSynthNote?.(note);
      }
      return;
    }

    if (played === false) {
      removeHeldNote(note);
      setActiveNotes(new Set(activeNotesRef.current));
      setKeyboardStatus("Unavailable");
      return;
    }

    publishActiveNotes();
  }

  function stopInputNote(sourceId) {
    const note = activeInputNotesRef.current.get(sourceId);
    if (note === undefined) {
      return;
    }
    activeInputNotesRef.current.delete(sourceId);
    const holdCount = (noteHoldCountsRef.current.get(note) ?? 1) - 1;
    if (holdCount > 0) {
      noteHoldCountsRef.current.set(note, holdCount);
      publishActiveNotes();
      return;
    }

    noteHoldCountsRef.current.delete(note);
    activeNotesRef.current.delete(note);
    window.stopSynthNote?.(note);
    publishActiveNotes();
  }

  function stopAllInputNotes() {
    for (const note of activeNotesRef.current) {
      window.stopSynthNote?.(note);
    }
    activeInputNotesRef.current.clear();
    noteHoldCountsRef.current.clear();
    activeNotesRef.current.clear();
    setActiveNotes(new Set());
    setKeyboardStatus("Ready");
  }

  function shiftKeyboardOctave(direction) {
    stopAllInputNotes();
    setKeyboardStatus("Ready");
    setKeyboardStartNote((note) => clampKeyboardStartNote(note + direction * SYNTH_KEYBOARD_OCTAVE_STEP));
  }

  function changeController(control, rawValue) {
    const value = clampControllerValue(control, rawValue);
    setControllerValues((current) => ({ ...current, [control.key]: value }));
    void (async () => {
      const changed = await window.setSynthController?.(project.path, control.controllerIndex, value);
      if (changed === false) {
        setKeyboardStatus("Unavailable");
      }
    })();
  }

  function handlePointerMove(event) {
    const sourceId = pointerSourceId(event.pointerId);
    if (!activeInputNotesRef.current.has(sourceId)) {
      return;
    }
    const note = noteAtPoint(event.clientX, event.clientY);
    if (note !== undefined) {
      startInputNote(sourceId, note);
    }
  }

  return (
    <section className="section-grid" aria-labelledby="instrument-heading">
      <div className="instrument-header">
        <h3 id="instrument-heading">Instrument</h3>
        <output className="instrument-status">{keyboardStatus}</output>
      </div>
      <div className="instrument-controls" aria-label="Instrument controllers">
        <div className="instrument-control instrument-octave-control">
          <span className="instrument-control-label">Octave</span>
          <div className="octave-controls" aria-label="Keyboard octave">
            <button
              type="button"
              className="octave-button"
              disabled={!canShiftDown}
              aria-label="Octave down"
              onClick={() => shiftKeyboardOctave(-1)}
            >
              -
            </button>
            <button
              type="button"
              className="octave-button"
              disabled={!canShiftUp}
              aria-label="Octave up"
              onClick={() => shiftKeyboardOctave(1)}
            >
              +
            </button>
          </div>
          <output className="instrument-control-value octave-range" aria-label="Keyboard range">
            {noteName(keyboardStartNote)}-{noteName(keyboardStartNote + SYNTH_KEYBOARD_NOTE_SPAN)}
          </output>
        </div>
        {instrumentControls.map((control) => {
          const value = controllerValues[control.key] ?? control.value;
          return (
            <InstrumentKnobControl
              key={control.key}
              control={control}
              value={value}
              onChange={changeController}
            />
          );
        })}
      </div>
      <div className="virtual-keyboard-frame" style={{ "--white-key-count": synthKeyboardWhiteKeys }}>
        <div ref={keyboardRef} className="virtual-keyboard" aria-label={`${project.title} virtual keyboard`}>
          {synthKeyboardNotes.map((keyboardNote) => (
            <button
              key={keyboardNote.note}
              type="button"
              className={`piano-key ${keyboardNote.black ? "is-black" : "is-white"}${
                activeNotes.has(keyboardNote.note) ? " is-active" : ""
              }`}
              style={{ "--white-index": keyboardNote.whiteIndex }}
              aria-label={keyboardNote.name}
              data-note={keyboardNote.note}
              onContextMenu={(event) => event.preventDefault()}
              onPointerDown={(event) => {
                event.preventDefault();
                try {
                  event.currentTarget.setPointerCapture(event.pointerId);
                } catch {
                  // Synthetic pointer events in tests do not always create a capturable pointer.
                }
                startInputNote(pointerSourceId(event.pointerId), keyboardNote.note);
              }}
              onPointerMove={handlePointerMove}
              onPointerUp={(event) => {
                event.preventDefault();
                stopInputNote(pointerSourceId(event.pointerId));
              }}
              onPointerCancel={(event) => stopInputNote(pointerSourceId(event.pointerId))}
              onLostPointerCapture={(event) => stopInputNote(pointerSourceId(event.pointerId))}
            >
              <span>{keyboardNote.name}</span>
            </button>
          ))}
          <div className="keyboard-scroll-lane" aria-hidden="true" />
        </div>
      </div>
    </section>
  );
}

function visiblePatterns(project) {
  return (project.patterns ?? []).filter(
    (pattern) => pattern.eventCount > 0 || Boolean(pattern.name?.trim()) || isClonePattern(pattern),
  );
}

function patternCount(project) {
  return visiblePatterns(project).length;
}

function embeddedProjectCount(project) {
  return project.stats?.embeddedContainers ?? project.synth?.embeddedCount ?? project.embedded?.length;
}

function listedPatterns(project) {
  return visiblePatterns(project).filter((pattern) => !isClonePattern(pattern));
}

function isClonePattern(pattern) {
  return pattern.infoFlags?.clone === true;
}

function isIconOnlyTimelinePattern(pattern) {
  return pattern.lines <= TIMELINE_ICON_ONLY_LINE_LIMIT && Boolean(pattern.icon);
}

function timelinePatterns(project) {
  if (project.type !== "project") {
    return [];
  }
  return visiblePatterns(project).filter(
    (pattern) =>
      Number.isFinite(pattern.position?.x) &&
      Number.isFinite(pattern.position?.y) &&
      Number.isFinite(pattern.lines) &&
      pattern.lines > 0,
  );
}

function timelineLayout(project) {
  const patterns = timelinePatterns(project);
  if (!patterns.length) {
    return undefined;
  }
  const supertracks = Boolean(project.project?.flags?.supertracks);
  const minLine = Math.min(...patterns.map((pattern) => pattern.position.x));
  const maxLine = Math.max(...patterns.map((pattern) => pattern.position.x + pattern.lines));
  const minY = Math.min(...patterns.map((pattern) => pattern.position.y));
  const maxY = Math.max(...patterns.map((pattern) => pattern.position.y + TIMELINE_LANE_HEIGHT));
  const startLine = Math.floor(minLine / 64) * 64;
  const endLine = Math.ceil(maxLine / 64) * 64;
  const startY = Math.floor(minY / TIMELINE_LANE_HEIGHT) * TIMELINE_LANE_HEIGHT;
  const endY = Math.ceil(maxY / TIMELINE_LANE_HEIGHT) * TIMELINE_LANE_HEIGHT;
  const duration = Math.max(1, endLine - startLine);
  const ticks = [];
  for (let line = startLine; line <= endLine; line += 64) {
    ticks.push(line);
  }
  const laneGuides = [];
  if (supertracks) {
    const occupiedLanes = new Map();
    for (const pattern of patterns) {
      const lane = Math.max(0, Math.round(pattern.position.y / TIMELINE_LANE_HEIGHT));
      if (!occupiedLanes.has(lane)) {
        const laneTop = pattern.position.y - startY + TIMELINE_Y_PADDING;
        occupiedLanes.set(lane, {
          lane,
          y: pattern.position.y,
          label: String(lane),
          lineTop: laneTop,
          labelTop: laneTop + TIMELINE_LANE_HEIGHT / 2,
        });
      }
    }
    laneGuides.push(...[...occupiedLanes.values()].sort((a, b) => a.y - b.y || a.lane - b.lane));
  }
  return {
    startLine,
    endLine,
    startY,
    duration,
    ticks,
    laneGuides,
    patterns: patterns.sort((a, b) => a.position.y - b.position.y || a.position.x - b.position.x || a.index - b.index),
    width: duration,
    height: Math.max(96, endY - startY + TIMELINE_Y_PADDING * 2),
    supertracks,
  };
}

function percent(value) {
  return `${value.toFixed(3)}%`;
}

function rectEdgePoint(from, to) {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  if (dx === 0 && dy === 0) {
    return from;
  }
  const tx = dx === 0 ? Number.POSITIVE_INFINITY : GRAPH_NODE_HALF_WIDTH / Math.abs(dx);
  const ty = dy === 0 ? Number.POSITIVE_INFINITY : GRAPH_NODE_HALF_HEIGHT / Math.abs(dy);
  const ratio = Math.min(tx, ty);
  return {
    x: from.x + dx * ratio,
    y: from.y + dy * ratio,
  };
}

function graphEdgePoints(from, to) {
  const start = rectEdgePoint(from, to);
  const end = rectEdgePoint(to, from);
  return { x1: start.x, y1: start.y, x2: end.x, y2: end.y };
}

function ProjectList({ projects, selectedPath, onSelect }) {
  return (
    <aside className="sidebar" aria-labelledby="project-list-heading">
      <section aria-labelledby="project-list-heading">
        <h2 id="project-list-heading">Files</h2>
        <div id="project-list" className="project-list" aria-live="polite">
          {projects.map((project) => (
            <button
              key={project.path}
              type="button"
              className="project-button"
              aria-current={project.path === selectedPath ? "true" : "false"}
              onClick={() => onSelect(project.path)}
            >
              <span>
                <span className="project-title">{project.title}</span>
                <br />
                <span className="project-path">{project.path}</span>
              </span>
              <span className="badge">{typeLabel(project)}</span>
            </button>
          ))}
        </div>
      </section>
    </aside>
  );
}

function classNames(...values) {
  return values.filter(Boolean).join(" ");
}

function moduleLinks(graph, moduleIndex) {
  return {
    inputs: graph.edges.filter((link) => link.to === moduleIndex),
    outputs: graph.edges.filter((link) => link.from === moduleIndex),
  };
}

function isGraphEdgeConnected(link, selectedModuleIndex) {
  return link.from === selectedModuleIndex || link.to === selectedModuleIndex;
}

function isGraphNodeConnected(graph, moduleIndex, selectedModuleIndex) {
  return graph.edges.some(
    (link) =>
      (link.from === selectedModuleIndex && link.to === moduleIndex) ||
      (link.to === selectedModuleIndex && link.from === moduleIndex),
  );
}

function ModuleGraphSvg({ graph, graphId, label = "Module graph", selectedModuleIndex, onSelectModule }) {
  const markerId = `${graphId}-arrow`;
  const selectedMarkerId = `${graphId}-arrow-selected`;
  const hasSelection = selectedModuleIndex !== undefined;
  return (
    <svg className="module-graph" viewBox={graph.viewBox} role="group" aria-label={label}>
      <defs>
        <marker
          id={markerId}
          markerHeight="10"
          markerUnits="userSpaceOnUse"
          markerWidth="10"
          orient="auto"
          refX="9"
          refY="5"
        >
          <path className="graph-arrow" d="M0,0 L10,5 L0,10 z" />
        </marker>
        <marker
          id={selectedMarkerId}
          markerHeight="10"
          markerUnits="userSpaceOnUse"
          markerWidth="10"
          orient="auto"
          refX="9"
          refY="5"
        >
          <path className="graph-arrow-selected" d="M0,0 L10,5 L0,10 z" />
        </marker>
      </defs>
      <g className="graph-edges">
        {graph.edges.map((link, index) => {
          const from = graph.nodes.find((module) => module.index === link.from);
          const to = graph.nodes.find((module) => module.index === link.to);
          const edge = graphEdgePoints(from.position, to.position);
          const selected = hasSelection && isGraphEdgeConnected(link, selectedModuleIndex);
          return (
            <line
              key={`${link.from}-${link.to}-${index}`}
              className={classNames(
                "graph-edge",
                selected && "is-selected",
                hasSelection && !selected && "is-dimmed",
              )}
              x1={edge.x1}
              y1={edge.y1}
              x2={edge.x2}
              y2={edge.y2}
              markerEnd={`url(#${selected ? selectedMarkerId : markerId})`}
            >
              <title>
                {moduleHexId(link.from)} {link.fromName} to {moduleHexId(link.to)} {link.toName}
              </title>
            </line>
          );
        })}
      </g>
      <g className="graph-nodes">
        {graph.nodes.map((module) => {
          const clipId = `${graphId}-node-clip-${module.index}`;
          const selected = module.index === selectedModuleIndex;
          const connected = hasSelection && isGraphNodeConnected(graph, module.index, selectedModuleIndex);
          return (
            <g
              key={module.index}
              className={classNames(
                "graph-node",
                selected && "is-selected",
                connected && "is-connected",
              )}
              data-module-index={module.index}
              style={{ "--module-color": module.color }}
              transform={`translate(${module.position.x} ${module.position.y})`}
              onClick={() => onSelectModule?.(module.index)}
            >
              <clipPath id={clipId}>
                <rect
                  className="graph-node-clip"
                  x={-GRAPH_NODE_HALF_WIDTH}
                  y={-GRAPH_NODE_HALF_HEIGHT}
                  width={GRAPH_NODE_HALF_WIDTH * 2}
                  height={GRAPH_NODE_HALF_HEIGHT * 2}
                />
              </clipPath>
              <rect
                className="graph-node-focus-ring"
                x={-GRAPH_NODE_HALF_WIDTH - 3}
                y={-GRAPH_NODE_HALF_HEIGHT - 3}
                width={GRAPH_NODE_HALF_WIDTH * 2 + 6}
                height={GRAPH_NODE_HALF_HEIGHT * 2 + 6}
              />
              <rect
                className="graph-node-box"
                x={-GRAPH_NODE_HALF_WIDTH}
                y={-GRAPH_NODE_HALF_HEIGHT}
                width={GRAPH_NODE_HALF_WIDTH * 2}
                height={GRAPH_NODE_HALF_HEIGHT * 2}
              />
              <text
                className="graph-node-id"
                x={-GRAPH_NODE_HALF_WIDTH + GRAPH_LABEL_INSET}
                y={-GRAPH_NODE_HALF_HEIGHT - 7}
              >
                {moduleHexId(module.index)}
              </text>
              <text
                className="graph-node-name"
                clipPath={`url(#${clipId})`}
                x={-GRAPH_NODE_HALF_WIDTH + GRAPH_LABEL_INSET}
                y={-GRAPH_NODE_HALF_HEIGHT + 7}
              >
                {module.name}
              </text>
              <text
                className="graph-node-type"
                clipPath={`url(#${clipId})`}
                x={-GRAPH_NODE_HALF_WIDTH + GRAPH_LABEL_INSET}
                y={GRAPH_NODE_HALF_HEIGHT - 6}
              >
                {module.type || module.kind}
              </text>
              <title>
                {moduleHexId(module.index)} {module.name} [{module.type || module.kind}]
              </title>
              <foreignObject
                className="graph-node-hit-area"
                x={-GRAPH_NODE_HALF_WIDTH - 3}
                y={-GRAPH_NODE_HALF_HEIGHT - 3}
                width={GRAPH_NODE_HALF_WIDTH * 2 + 6}
                height={GRAPH_NODE_HALF_HEIGHT * 2 + 6}
              >
                <button
                  type="button"
                  className="graph-node-button"
                  aria-label={`${moduleHexId(module.index)} ${module.name} ${module.type || module.kind}`}
                  aria-pressed={selected ? "true" : "false"}
                  data-module-index={module.index}
                />
              </foreignObject>
            </g>
          );
        })}
      </g>
    </svg>
  );
}

function ModuleReferencePill({ module, count, suffix, className }) {
  const type = moduleReferenceType(module);
  return (
    <span className="module-reference" style={{ "--module-color": module.color }}>
      <span className={classNames("module-reference-pill", className)}>
        <span className="module-reference-id">{moduleHexId(module.index)}</span>
        <span className="module-reference-name">{module.name}</span>
        {type ? <span className="module-reference-type">{type}</span> : null}
      </span>
      {count !== undefined ? <span className="module-reference-meta module-reference-count">{count}</span> : null}
      {suffix ? <span className="module-reference-meta">{suffix}</span> : null}
    </span>
  );
}

function moduleReferenceType(module) {
  if (!module.type || !module.name) {
    return module.type;
  }
  const normalizedName = module.name.toLowerCase();
  const normalizedType = module.type.toLowerCase();
  if (normalizedName === normalizedType || normalizedName.startsWith(normalizedType)) {
    return undefined;
  }
  return module.type;
}

function controllerDisplayValue(controller) {
  const value = controller.displayValue ?? controller.value;
  const suffix = controller.unit ? ` ${controller.unit}` : "";
  return `${value}${suffix}`;
}

function ControllerList({ controllers }) {
  if (!controllers?.length) {
    return <span className="muted">none</span>;
  }
  return (
    <div className="controller-list">
      {controllers.map((controller) => (
        <div className="controller-row" key={`${controller.index}-${controller.path}`}>
          <span className="controller-label">{controller.label}</span>
          <span className="controller-value" title={controller.path}>
            {controllerDisplayValue(controller)}
          </span>
        </div>
      ))}
    </div>
  );
}

function dataChunkMeta(chunk) {
  const parts = [];
  if (chunk.count > 1) {
    parts.push(`x${chunk.count}`);
  }
  if (chunk.details?.length) {
    parts.push(chunk.details.slice(0, 2).join(", "));
  }
  return parts.join(" · ");
}

function DataChunkList({ chunks, total }) {
  const knownCount = chunks?.reduce((sum, chunk) => sum + (chunk.count ?? 1), 0) ?? 0;
  const remaining = Math.max(0, (total ?? knownCount) - knownCount);
  if (!chunks?.length && !remaining) {
    return <span className="muted">none</span>;
  }
  return (
    <div className="data-chunk-list">
      {(chunks ?? []).map((chunk) => (
        <span className="data-chunk-pill" key={`${chunk.name}-${chunk.indexes?.join("-") ?? ""}`}>
          <span className="data-chunk-label">{chunk.label}</span>
          {dataChunkMeta(chunk) ? <span className="data-chunk-meta">{dataChunkMeta(chunk)}</span> : null}
        </span>
      ))}
      {remaining ? (
        <span className="data-chunk-pill is-muted">
          <span className="data-chunk-label">Other data</span>
          <span className="data-chunk-meta">x{remaining}</span>
        </span>
      ) : null}
    </div>
  );
}

function GraphLinkList({ graph, links, direction }) {
  if (!links.length) {
    return <span className="muted">none</span>;
  }
  return (
    <div className="graph-detail-links">
      {links.map((link, index) => {
        const moduleIndex = direction === "input" ? link.from : link.to;
        const moduleName = direction === "input" ? link.fromName : link.toName;
        const slot = direction === "input" ? link.toSlot : link.fromSlot;
        const module = graph.nodes.find((candidate) => candidate.index === moduleIndex) ?? {
          index: moduleIndex,
          name: moduleName,
          color: undefined,
          type: undefined,
        };
        return (
          <ModuleReferencePill
            key={`${direction}-${moduleIndex}-${slot ?? index}`}
            module={module}
            suffix={slot !== undefined ? `slot ${slot}` : undefined}
          />
        );
      })}
    </div>
  );
}

function ModuleGraphDetail({ graph, selectedModuleIndex }) {
  const module =
    graph.nodes.find((candidate) => candidate.index === selectedModuleIndex) ??
    graph.nodes.find((candidate) => candidate.flags?.includes("selected")) ??
    graph.nodes[0];
  const selected = module.index === selectedModuleIndex;
  const { inputs, outputs } = moduleLinks(graph, module.index);
  return (
    <aside className="graph-detail" aria-label="Selected module details">
      <div className="graph-detail-heading">
        <ModuleReferencePill module={module} className="graph-detail-module-pill" />
      </div>
      {!selected ? <p className="graph-detail-hint">Select a node to inspect links.</p> : null}
      <div className="graph-detail-section">
        <h4>Controllers {module.controllerCount ? `(${module.controllerCount})` : ""}</h4>
        <ControllerList controllers={module.controllers} />
      </div>
      <div className="graph-detail-section">
        <h4>Data</h4>
        <DataChunkList chunks={module.dataChunks} total={module.dataChunkCount} />
      </div>
      <div className="graph-detail-section">
        <h4>Inputs</h4>
        <GraphLinkList graph={graph} links={inputs} direction="input" />
      </div>
      <div className="graph-detail-section">
        <h4>Outputs</h4>
        <GraphLinkList graph={graph} links={outputs} direction="output" />
      </div>
    </aside>
  );
}

function defaultSelectedGraphModule(graph) {
  return graph.nodes.find((module) => module.flags?.includes("selected"))?.index ?? graph.nodes[0]?.index;
}

function ModuleGraphPanel({ graph, graphId, label = "Module graph" }) {
  const [selectedModuleIndex, setSelectedModuleIndex] = useState(() => defaultSelectedGraphModule(graph));

  useEffect(() => {
    setSelectedModuleIndex(defaultSelectedGraphModule(graph));
  }, [graph]);

  return (
    <div className="graph-workspace">
      <div className="graph-panel">
        <ModuleGraphSvg
          graph={graph}
          graphId={graphId}
          label={label}
          selectedModuleIndex={selectedModuleIndex}
          onSelectModule={setSelectedModuleIndex}
        />
      </div>
      <ModuleGraphDetail graph={graph} selectedModuleIndex={selectedModuleIndex} />
    </div>
  );
}

function ModuleGraphSection({ project }) {
  const graph = useMemo(() => buildGraphLayout(project), [project]);
  const storedModules = project.project?.moduleCount;
  if (!graph) {
    return null;
  }
  return (
    <section className="section-grid" aria-labelledby="graph-heading">
      <h3 id="graph-heading">Module Graph</h3>
      {storedModules !== undefined ? <p className="section-meta">Stored modules {compact(storedModules)}</p> : null}
      <ModuleGraphPanel graph={graph} graphId="main-module-graph" />
    </section>
  );
}

function ProjectActions({ project }) {
  const playable = canPlay(project);
  const [copyLabel, setCopyLabel] = useState("Copy link");
  const copyResetTimerRef = useRef(undefined);

  useEffect(() => {
    setCopyLabel("Copy link");
    return () => {
      window.clearTimeout(copyResetTimerRef.current);
    };
  }, [project.path]);

  async function copyProjectLink() {
    window.clearTimeout(copyResetTimerRef.current);
    try {
      await copyText(projectPermalinkUrl(project.path));
      setCopyLabel("Copied");
    } catch {
      setCopyLabel("Copy failed");
    }
    copyResetTimerRef.current = window.setTimeout(() => setCopyLabel("Copy link"), 1600);
  }

  return (
    <div className="project-actions">
      {playable ? (
        <>
          <button type="button" onClick={() => playProject(project)}>
            <span aria-hidden="true">▶</span> Play
          </button>
          <button type="button" onClick={stopPlayer}>
            <span aria-hidden="true">■</span> Stop
          </button>
        </>
      ) : null}
      <a className="action-link" href={project.path} download>
        Download
      </a>
      <button
        type="button"
        className="project-permalink"
        data-permalink-hash={projectPermalinkHash(project.path)}
        onClick={copyProjectLink}
      >
        {copyLabel}
      </button>
    </div>
  );
}

function PropertyRow({ label, value }) {
  if (value === undefined || value === null || value === "") {
    return null;
  }
  return (
    <div className="property-row">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function FlagPills({ flags }) {
  const entries = flagList(flags);
  if (!entries.length) {
    return <span className="muted">none</span>;
  }
  return (
    <div className="property-flags">
      {entries.map((flag) => (
        <span className="property-flag" key={flag}>
          {flag}
        </span>
      ))}
    </div>
  );
}

function ProjectPropertiesSection({ project }) {
  const projectInfo = project.project;
  const synthInfo = project.synth;
  const timeline = projectInfo?.timeline;
  const sourceRecipe = sourceRecipeLink(project.sourceRecipe);
  if (!projectInfo && !synthInfo) {
    return null;
  }

  return (
    <section className="section-grid" aria-labelledby="properties-heading">
      <h3 id="properties-heading">{project.type === "synth" ? "Synth Properties" : "Project Properties"}</h3>
      <div className="properties-panel">
        {projectInfo ? (
          <>
            <dl className="property-grid">
              <PropertyRow label="BPM" value={projectInfo.bpm} />
              <PropertyRow label="Speed" value={projectInfo.speed} />
              <PropertyRow label="Global volume" value={projectInfo.globalVolume} />
              <PropertyRow
                label="Timeline grid"
                value={timeline ? `${compact(timeline.grid)} / ${compact(timeline.grid2)}` : undefined}
              />
            </dl>
            <div className="property-block">
              <h4>Flags</h4>
              <FlagPills flags={projectInfo.flags} />
            </div>
          </>
        ) : null}
        {synthInfo ? (
          <>
            <ModuleReferencePill module={synthInfo} className="graph-detail-module-pill" />
            {sourceRecipe ? (
              <div className="property-block">
                <h4>Source</h4>
                <a href={sourceRecipe.path}>{sourceRecipe.name}</a>
              </div>
            ) : null}
            <div className="property-block">
              <h4>Data</h4>
              <DataChunkList chunks={synthInfo.dataChunks} total={synthInfo.dataChunkCount} />
            </div>
            <div className="property-block">
              <h4>Flags</h4>
              <FlagPills flags={synthInfo.flags} />
            </div>
          </>
        ) : null}
      </div>
    </section>
  );
}

function TimelinePattern({ pattern, layout }) {
  const primaryModule = pattern.moduleReferences?.[0];
  const left = ((pattern.position.x - layout.startLine) / layout.duration) * 100;
  const width = (pattern.lines / layout.duration) * 100;
  const top = pattern.position.y - layout.startY + TIMELINE_Y_PADDING + TIMELINE_PATTERN_Y_INSET;
  const clone = isClonePattern(pattern);
  const iconOnly = isIconOnlyTimelinePattern(pattern);
  return (
    <div
      className={`timeline-pattern${clone ? " is-clone" : ""}${iconOnly ? " is-icon-only" : ""}`}
      data-pattern-index={pattern.index}
      data-pattern-lines={pattern.lines}
      style={{
        "--pattern-color": primaryModule?.color,
        left: percent(left),
        top: `${top}px`,
        width: percent(width),
      }}
      title={`#${pattern.index} ${pattern.name || "(unnamed)"}${clone ? ` clone of #${pattern.parent}` : ""} lines=${pattern.lines} events=${pattern.eventCount}`}
    >
      {pattern.icon ? (
        <img
          className="timeline-pattern-icon"
          src={pattern.icon.src}
          width={pattern.icon.width}
          height={pattern.icon.height}
          alt=""
          aria-hidden="true"
        />
      ) : null}
      {iconOnly ? null : (
        <span className="timeline-pattern-label">
          #{pattern.index} {pattern.name || "(unnamed)"}
        </span>
      )}
    </div>
  );
}

function TimelineSection({ project }) {
  const layout = useMemo(() => timelineLayout(project), [project]);
  if (!layout) {
    return null;
  }
  return (
    <section className="section-grid" aria-labelledby="timeline-heading">
      <h3 id="timeline-heading">Timeline</h3>
      <div
        className="timeline-panel"
        role="img"
        aria-label={`${project.title} ${layout.supertracks ? "supertracks" : "classic"} timeline`}
      >
        <div className="timeline-canvas" style={{ "--timeline-width": `${layout.width}px` }}>
          <div className="timeline-header">
            <div className="timeline-lane-label" />
            <div className="timeline-axis">
              {layout.ticks.map((line) => (
                <span
                  className="timeline-tick-label"
                  key={line}
                  style={{ left: percent(((line - layout.startLine) / layout.duration) * 100) }}
                >
                  {line}
                </span>
              ))}
            </div>
          </div>
          <div className="timeline-body" style={{ height: `${layout.height}px` }}>
            <div className="timeline-lane-column">
              {layout.laneGuides.map((lane) => (
                <span
                  className="timeline-lane-number"
                  key={lane.lane}
                  style={{ top: `${lane.labelTop}px` }}
                  aria-label={`Supertrack ${lane.label}`}
                >
                  {lane.label}
                </span>
              ))}
            </div>
            <div className="timeline-plot">
              {layout.ticks.map((line) => (
                <span
                  className="timeline-grid-line"
                  key={line}
                  style={{ left: percent(((line - layout.startLine) / layout.duration) * 100) }}
                />
              ))}
              {layout.laneGuides.map((lane) => (
                <span className="timeline-lane-guide" key={lane.lane} style={{ top: `${lane.lineTop}px` }} />
              ))}
              {layout.patterns.map((pattern) => (
                <TimelinePattern key={pattern.index} pattern={pattern} layout={layout} />
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function PatternList({ patterns }) {
  return (
    <div className="pattern-grid">
      {patterns.map((pattern) => {
        const moduleReferences = pattern.moduleReferences ?? [];
        return (
          <div className="pattern-row" key={pattern.index}>
            <div className="pattern-title">
              {pattern.icon ? (
                <img
                  className="pattern-icon"
                  src={pattern.icon.src}
                  width={pattern.icon.width}
                  height={pattern.icon.height}
                  alt=""
                  aria-hidden="true"
                />
              ) : null}
              <span className="pattern-name">
                #{pattern.index} {pattern.name || "(unnamed)"}
              </span>
            </div>
            <div className="pattern-meta">
              lines={compact(pattern.lines)} tracks={compact(pattern.tracks)} events={compact(pattern.eventCount)}
            </div>
            {moduleReferences.length ? (
              <div className="module-reference-list" aria-label={`Modules used by pattern ${pattern.index}`}>
                {moduleReferences.map((module) => (
                  <ModuleReferencePill key={module.index} module={module} count={module.eventCount} />
                ))}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function PatternSection({ project }) {
  const patterns = listedPatterns(project);
  const storedPatterns = project.project?.patternCount;
  if (!patterns.length && storedPatterns === undefined) {
    return null;
  }
  return (
    <section className="section-grid" aria-labelledby="patterns-heading">
      <h3 id="patterns-heading">Patterns</h3>
      {storedPatterns !== undefined ? <p className="section-meta">Stored patterns {compact(storedPatterns)}</p> : null}
      {patterns.length ? <PatternList patterns={patterns} /> : <p className="muted">No listed source patterns.</p>}
    </section>
  );
}

function EmbeddedSection({ project }) {
  const embeddedCount = embeddedProjectCount(project);
  if (!project.embedded.length && embeddedCount === undefined) {
    return null;
  }
  return (
    <section className="section-grid" aria-labelledby="embedded-heading">
      <h3 id="embedded-heading">Embedded</h3>
      {embeddedCount !== undefined ? <p className="section-meta">Embedded projects {compact(embeddedCount)}</p> : null}
      {project.embedded.length ? (
        <div className="embedded-grid">
          {project.embedded.map((embedded) => (
            <EmbeddedProject key={`${embedded.hostModule}-${embedded.dataChunkIndex}`} embedded={embedded} />
          ))}
        </div>
      ) : (
        <p className="muted">No embedded projects.</p>
      )}
    </section>
  );
}

function EmbeddedProject({ embedded }) {
  const graph = useMemo(() => buildGraphLayout(embedded.document), [embedded.document]);
  const patterns = listedPatterns(embedded.document);
  const graphId = svgId(`embedded-${embedded.hostModule}-${embedded.dataChunkIndex}-${embedded.hostName}`);
  const title = embedded.document.project?.name || embedded.document.title || embedded.document.path || "(unnamed)";
  const hostModule = {
    index: embedded.hostModule,
    name: embedded.hostName,
    kind: embedded.hostKind,
    type: embedded.hostType,
    color: embedded.hostColor,
  };
  return (
    <article className="embedded-row">
      <div className="embedded-header">
        <div>
          <span className="embedded-title">{title}</span>
          <div className="embedded-host">
            <ModuleReferencePill module={hostModule} />
          </div>
        </div>
        <div className="module-meta">
          modules={embedded.document.stats.activeModules} links={embedded.document.stats.links} patterns=
          {patternCount(embedded.document)}
        </div>
      </div>
      {graph ? (
        <ModuleGraphPanel graph={graph} graphId={graphId} label={`Embedded module graph for ${title}`} />
      ) : null}
      {patterns.length ? (
        <section className="embedded-patterns" aria-label={`${title} patterns`}>
          <h4>Patterns</h4>
          <PatternList patterns={patterns} />
        </section>
      ) : null}
    </article>
  );
}

function ProjectDetails({ project, error }) {
  if (error) {
    return (
      <section id="project-details" className="details" aria-live="polite">
        <p className="muted">{error}</p>
      </section>
    );
  }
  if (!project) {
    return (
      <section id="project-details" className="details" aria-live="polite">
        <p className="muted">Loading project index...</p>
      </section>
    );
  }
  return (
    <section id="project-details" className="details" aria-live="polite">
      <div className="details-header">
        <div>
          <h2>{project.title}</h2>
          <div className="project-path">{project.path}</div>
        </div>
        <ProjectActions project={project} />
      </div>

      <div className="section-grid">
        <ProjectPropertiesSection project={project} />
        <ModuleGraphSection project={project} />
        <SynthKeyboardSection project={project} />
        <TimelineSection project={project} />
        <PatternSection project={project} />
        <EmbeddedSection project={project} />
      </div>
    </section>
  );
}

function App() {
  const [projects, setProjects] = useState([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [error, setError] = useState("");
  const [masterVolume, setMasterVolume] = useState(DEFAULT_MASTER_VOLUME);
  const topbarControlsRoot = useMemo(() => document.getElementById("topbar-controls"), []);

  useEffect(() => {
    let alive = true;
    async function loadProjectIndex() {
      const response = await fetch(PROJECT_INDEX_PATH);
      if (!response.ok) {
        throw new Error(`Project index ${response.status}`);
      }
      const data = await response.json();
      if (!alive) {
        return;
      }
      const nextProjects = data.projects ?? [];
      const hashPath = selectedPathFromLocation();
      const initialProject = nextProjects.find((project) => project.path === hashPath) ?? nextProjects[0];
      setProjects(nextProjects);
      setSelectedPath(initialProject?.path ?? "");
    }
    loadProjectIndex().catch((loadError) => {
      if (alive) {
        setError(loadError.message);
      }
    });
    return () => {
      alive = false;
    };
  }, []);

  const selectedProject = useMemo(
    () => projects.find((project) => project.path === selectedPath),
    [projects, selectedPath],
  );

  useEffect(() => {
    if (!projects.length) {
      return undefined;
    }
    function applyHashSelection() {
      const hashPath = selectedPathFromLocation();
      const nextProject = projects.find((project) => project.path === hashPath) ?? projects[0];
      setSelectedPath(nextProject?.path ?? "");
    }
    window.addEventListener("hashchange", applyHashSelection);
    window.addEventListener("popstate", applyHashSelection);
    return () => {
      window.removeEventListener("hashchange", applyHashSelection);
      window.removeEventListener("popstate", applyHashSelection);
    };
  }, [projects]);

  function selectProjectPath(path) {
    setSelectedPath(path);
    const nextHash = projectPermalinkHash(path);
    if (window.location.hash !== nextHash) {
      window.history.pushState(null, "", nextHash);
    }
  }

  useEffect(() => {
    function applyVolume() {
      window.setMasterVolume?.(masterVolume);
    }
    applyVolume();
    window.addEventListener("sunvox-player-api-ready", applyVolume);
    return () => {
      window.removeEventListener("sunvox-player-api-ready", applyVolume);
    };
  }, [masterVolume]);

  return (
    <>
      {topbarControlsRoot
        ? createPortal(
            <TopbarControls project={selectedProject} volume={masterVolume} onVolumeChange={setMasterVolume} />,
            topbarControlsRoot,
          )
        : null}
      <main className="app-shell">
        <ProjectList projects={projects} selectedPath={selectedPath} onSelect={selectProjectPath} />
        <ProjectDetails project={selectedProject} error={error} />
      </main>
    </>
  );
}

createRoot(document.getElementById("app-root")).render(<App />);

// @ts-check
// Small structured builder for multi-pattern SunVox projects: named modules
// with routing, and timeline patterns written with note/controller helpers.

import { TEXT_FORMAT } from "../../../tools/sunvox-codec.mjs";
import { defaultControllers } from "../../../tools/sunsynth-lab.mjs";
import { deterministicIconBase64 } from "../../../tools/sunvox-music-recipe-helpers.mjs";

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_TO_SHARP = { Db: "C#", Eb: "D#", Gb: "F#", Ab: "G#", Bb: "A#", Cb: "B", Fb: "E" };

/** MIDI-like note number (C0 = 0, SunVox convention) from a name such as "Eb4". */
export function noteNumber(name) {
  if (typeof name === "number") return name;
  const match = /^([A-G])([b#]?)(-?\d)$/u.exec(name);
  if (!match) throw new Error(`Invalid note: ${name}`);
  let pitch = `${match[1]}${match[2]}`;
  let octave = Number(match[3]);
  if (match[2] === "b") {
    pitch = FLAT_TO_SHARP[pitch];
    if (match[1] === "C") octave -= 1;
  }
  return octave * 12 + NOTE_NAMES.indexOf(pitch);
}

export function noteName(number) {
  return `${NOTE_NAMES[((number % 12) + 12) % 12]}${Math.floor(number / 12)}`;
}

export class PatternWriter {
  constructor(builder, { name, x, y, lines, tracks, color }) {
    this.builder = builder;
    this.name = name;
    this.x = x;
    this.y = y;
    this.lines = lines;
    this.tracks = tracks;
    this.color = color;
    this.events = [];
    this.used = new Map();
  }

  put(event) {
    if (event.line < 0 || event.line >= this.lines) return undefined;
    if (event.track < 0 || event.track >= this.tracks) {
      throw new Error(`${this.name}: track ${event.track} out of range (${this.tracks})`);
    }
    const key = `${event.line}:${event.track}`;
    const existing = this.used.get(key);
    if (existing) {
      // Allow a note-off to be replaced by a later note on the same cell.
      if (existing.note === "noteOff" && event.note !== undefined && event.note !== "noteOff") {
        this.events.splice(this.events.indexOf(existing), 1);
      } else if (event.note === "noteOff" && existing.note !== undefined) {
        return existing;
      } else {
        throw new Error(`${this.name}: cell already used at line ${event.line} track ${event.track}`);
      }
    }
    this.used.set(key, event);
    this.events.push(event);
    return event;
  }

  /**
   * Note with optional gate (in lines), micro delay (1/32 line), effect and controller.
   * @param {{ line: number, track: number, note: string | number, module: string, velocity?: number,
   *   gate?: number, delay?: number, effect?: string, parameter?: unknown, controller?: string, value?: number }} options
   */
  note({ line, track, note, module, velocity = 100, gate, delay, effect, parameter, controller, value }) {
    const moduleIndex = this.builder.moduleIndex(module);
    const event = {
      line,
      track,
      note: /^[A-G]/u.test(String(note)) || typeof note === "number" ? noteName(noteNumber(note)) : note,
      velocity: Math.max(1, Math.min(128, Math.round(velocity))),
      module: moduleIndex,
    };
    if (delay) {
      event.effect = "delayEvent";
      event.delayLine32nds = Math.max(1, Math.min(31, Math.round(delay)));
    } else if (effect) {
      event.effect = effect;
      if (parameter !== undefined) event.parameter = parameter;
    }
    if (controller) {
      event.controller = controller;
      event.parameter = value;
    }
    this.put(event);
    if (gate !== undefined && gate > 0) this.off({ line: line + gate, track, module });
    return event;
  }

  off({ line, track, module }) {
    if (line >= this.lines) return undefined;
    return this.put({ line, track, note: "noteOff", module: this.builder.moduleIndex(module) });
  }

  /** Controller automation; value is SunVox's normalized 0..0x8000 pattern range. */
  ctl({ line, track, module, controller, value }) {
    return this.put({ line, track, module: this.builder.moduleIndex(module), controller, parameter: Math.round(value) });
  }

  effect({ line, track, module, effect, parameter }) {
    const event = { line, track, effect };
    if (module !== undefined) event.module = this.builder.moduleIndex(module);
    if (parameter !== undefined) event.parameter = parameter;
    return this.put(event);
  }

  toDocument(index) {
    return {
      name: this.name,
      position: { x: this.x, y: this.y },
      ...(this.flags ? { flags: this.flags } : {}),
      tracks: this.tracks,
      lines: this.lines,
      foreground: this.color?.foreground ?? "#000000",
      background: this.color?.background ?? "#ffffff",
      events: this.events
        .slice()
        .sort((a, b) => a.line - b.line || a.track - b.track),
      iconBase64: deterministicIconBase64(79, index),
    };
  }
}

export class SongBuilder {
  constructor({ name, bpm, speed = 6, globalVolume = 256 }) {
    this.project = { name, bpm, speed, globalVolume };
    this.modules = [];
    this.moduleKeys = new Map();
    this.links = [];
    this.patterns = [];
    this.addModule("output", {
      flags: { exists: true, output: true },
      name: "Output",
      position: { x: 0, y: 0, z: 0 },
    });
  }

  moduleIndex(key) {
    if (typeof key === "number") return key;
    const index = this.moduleKeys.get(key);
    if (index === undefined) throw new Error(`Unknown module key: ${key}`);
    return index;
  }

  addModule(key, definition) {
    if (this.moduleKeys.has(key)) throw new Error(`Duplicate module key: ${key}`);
    const { to, ...module } = definition;
    // Sparse controller objects would otherwise be zero-filled by the codec
    // (issue #37), e.g. Amplifier dcOffset 0 instead of its 128 center.
    if (module.type) module.controllers = { ...defaultControllers(module.type), ...module.controllers };
    const index = this.modules.length;
    this.modules.push(module);
    this.moduleKeys.set(key, index);
    for (const target of [to ?? []].flat()) this.links.push([key, target]);
    return index;
  }

  place(key, x, y) {
    this.modules[this.moduleIndex(key)].position = { x, y, z: 0 };
  }

  connect(source, target) {
    this.links.push([source, target]);
  }

  pattern(options) {
    const writer = new PatternWriter(this, options);
    this.patterns.push(writer);
    return writer;
  }

  build({ comments = [], selectedModule = 0, flags = {}, pruneEmptyPatterns = false } = {}) {
    const modules = this.modules.map((module) => structuredClone(module));
    const patterns = pruneEmptyPatterns ? this.patterns.filter((pattern) => pattern.events.length) : this.patterns;
    for (const [source, target] of this.links) {
      const destination = modules[this.moduleIndex(target)];
      destination.inputs ??= [];
      destination.inputs.push({ slot: destination.inputs.length, module: this.moduleIndex(source) });
    }
    return {
      format: TEXT_FORMAT,
      magic: "SVOX",
      headerTailHex: "00000000",
      _comments: comments,
      project: {
        version: 33554437,
        baseVersion: 33554437,
        flags,
        syncFlags: { midiStartStopContinue: true, otherStartStopContinue: true },
        name: this.project.name,
        bpm: this.project.bpm,
        speed: this.project.speed,
        globalVolume: this.project.globalVolume,
        timeline: { grid: 4, grid2: 4 },
        view: { moduleScale: 256, moduleZoom: 120, xOffset: -200, yOffset: -200 },
        restartPosition: 0,
        selectedModule,
        lastSelectedGenerator: selectedModule,
        currentPattern: 0,
        currentPatternTrack: 0,
        currentPatternLine: 0,
      },
      patterns: patterns.map((pattern, index) => pattern.toDocument(index)),
      modules,
      trailingChunks: [],
    };
  }
}

/**
 * Section-by-lane pattern grid for supertracks projects. Each lane keeps one
 * horizontal row of patterns sharing track state, so notes may sustain across
 * section boundaries and are released by explicit note-offs.
 */
export class Timeline {
  constructor(song, { sections, lanes, linesPerBar = 16 }) {
    this.song = song;
    this.sections = sections;
    this.linesPerBar = linesPerBar;
    this.writers = new Map();
    for (const lane of lanes) {
      for (const section of sections) {
        const writer = song.pattern({
          name: `${section.name} · ${lane.name}`,
          x: section.start * linesPerBar,
          y: lane.y,
          lines: section.bars * linesPerBar,
          tracks: lane.tracks,
          color: lane.color,
        });
        writer.flags = { noNotesOff: true };
        writer.start = section.start * linesPerBar;
        this.writers.set(`${lane.key}:${section.key}`, writer);
      }
    }
    this.laneKeys = lanes.map((lane) => lane.key);
  }

  locate(lane, line) {
    for (const section of this.sections) {
      const start = section.start * this.linesPerBar;
      const end = start + section.bars * this.linesPerBar;
      if (line >= start && line < end) {
        return { writer: this.writers.get(`${lane}:${section.key}`), local: line - start };
      }
    }
    return undefined;
  }

  note(lane, line, { gate, ...options }) {
    const target = this.locate(lane, line);
    if (!target) return undefined;
    const event = target.writer.note({ ...options, line: target.local });
    if (gate !== undefined && gate > 0) this.off(lane, line + gate, options);
    return event;
  }

  off(lane, line, { track, module }) {
    const target = this.locate(lane, line);
    return target?.writer.off({ line: target.local, track, module });
  }

  ctl(lane, line, options) {
    const target = this.locate(lane, line);
    return target?.writer.ctl({ ...options, line: target.local });
  }

  effect(lane, line, options) {
    const target = this.locate(lane, line);
    return target?.writer.effect({ ...options, line: target.local });
  }
}

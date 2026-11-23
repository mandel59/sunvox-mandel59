// @ts-check
// Score for "Pixel Sprint" (#104): an original chiptune action-stage theme in
// E minor at 168 BPM, lifted to F# minor for the coda. 64 bars, one line is a
// 16th note. Console-style voice budget: pulse lead, pulse harmony /
// tick-rate arpeggios (SunVox effect 0x08), triangle bass and noise drums.

import { createRng } from "../../../../tools/sample-synth.mjs";
import { noteNumber } from "../../../../tools/sunvox-song-builder.mjs";

export const BPM = 168;
export const LPB = 16;
export const TOTAL_BARS = 64;

export const SECTIONS = Object.freeze([
  { key: "intro", name: "Intro", start: 0, bars: 4 },
  { key: "a1", name: "A1", start: 4, bars: 8 },
  { key: "a2", name: "A2", start: 12, bars: 8 },
  { key: "b1", name: "B1", start: 20, bars: 8 },
  { key: "bridge", name: "Bridge", start: 28, bars: 8 },
  { key: "a3", name: "A3", start: 36, bars: 8 },
  { key: "b2", name: "B2", start: 44, bars: 8 },
  { key: "coda", name: "Coda", start: 52, bars: 8 },
  { key: "ending", name: "Ending", start: 60, bars: 4 },
]);

// ---------------------------------------------------------------------------
// Harmony: one chord per bar.

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const QUALITIES = { "": [0, 4, 7], m: [0, 3, 7] };

const A_CHORDS = ["Em", "C", "D", "Bm", "Em", "C", "Am", "B"];
const B_CHORDS = ["C", "D", "Bm", "Em", "Am", "D", "G", "B"];
const transposeChord = (symbol, semitones) => {
  const match = /^([A-G]#?)(m?)$/u.exec(symbol);
  if (!match) throw new Error(`Unsupported chord: ${symbol}`);
  return `${NAMES[(NAMES.indexOf(match[1]) + semitones + 12) % 12]}${match[2]}`;
};
const CHART = [
  "Em", "C", "D", "B", // intro fanfare
  ...A_CHORDS, ...A_CHORDS,
  ...B_CHORDS,
  "Am", "Bm", "C", "D", "Am", "Bm", "C", "B", // bridge
  ...A_CHORDS,
  ...B_CHORDS.slice(0, 6), "A", "C#", // B2 turns toward F# minor
  ...A_CHORDS.map((symbol) => transposeChord(symbol, 2)), // coda in F# minor
  "D", "E", "F#m", "F#m", // ending
];
if (CHART.length !== TOTAL_BARS) throw new Error(`Chart covers ${CHART.length} bars`);

function parseChord(symbol) {
  const match = /^([A-G]#?)(m?)$/u.exec(symbol);
  if (!match) throw new Error(`Unsupported chord: ${symbol}`);
  return { symbol, rootPc: NAMES.indexOf(match[1]), voicing: QUALITIES[match[2]] };
}

export const chordAtBar = (bar) => parseChord(CHART[Math.min(bar, TOTAL_BARS - 1)]);

const pcOf = (note) => ((note % 12) + 12) % 12;

// ---------------------------------------------------------------------------
// Melodies, "Note:16ths" tokens, one string per bar.

const INTRO = [
  "B5:2 B5:2 -:2 B5:2 -:2 B5:2 A5:2 B5:2",
  "C6:2 C6:2 -:2 C6:2 -:2 C6:2 B5:2 C6:2",
  "D6:2 D6:2 -:2 D6:2 -:2 D6:2 C6:2 D6:2",
  "D#6:4 F#6:4 B6:4 -:4",
];

const THEME_A = [
  "E5:2 G5:2 B5:4 A5:2 G5:2 F#5:2 G5:2",
  "E5:4 C5:2 E5:2 G5:4 E5:4",
  "F#5:2 A5:2 D6:4 C6:2 A5:2 F#5:2 A5:2",
  "B5:8 A5:2 B5:2 D6:4",
  "E6:4 D6:2 B5:2 G5:4 B5:2 E6:2",
  "D6:2 C6:2 G5:4 E5:4 G5:2 C6:2",
  "C6:2 B5:2 A5:4 E5:2 A5:2 C6:2 E6:2",
  "D#6:6 B5:2 F#5:4 A5:2 B5:2",
];

const THEME_B = [
  "G5:3 E5:3 G5:2 C6:4 B5:2 C6:2",
  "D6:3 A5:3 F#5:2 A5:4 D6:4",
  "F#6:4 D6:2 B5:2 F#5:4 B5:4",
  "G5:4 B5:4 E6:8",
  "E6:3 C6:3 A5:2 E5:4 A5:4",
  "F#5:3 A5:3 D6:2 C6:4 A5:4",
  "B5:2 D6:2 G6:4 F#6:2 D6:2 B5:2 D6:2",
  "D#6:8 F#6:4 D#6:4",
];
const THEME_B2 = [
  ...THEME_B.slice(0, 6),
  "C#6:2 E6:2 A6:4 E6:2 C#6:2 A5:2 C#6:2",
  "G#5:4 C#6:4 F6:4 G#6:4",
];

const BRIDGE = [
  "A5:12 G5:2 A5:2",
  "B5:12 A5:2 B5:2",
  "C6:8 E6:8",
  "D6:8 F#6:4 A6:4",
  "E6:8 C6:4 A5:4",
  "F#6:8 D6:4 B5:4",
  "G6:8 E6:4 C6:4",
  "F#6:8 D#6:4 B5:2 D#6:2",
];

const ENDING = [
  "A5:2 D6:2 F#6:4 A5:2 D6:2 F#6:4",
  "B5:2 E6:2 G#6:4 B5:2 E6:2 G#6:4",
  "C#6:2 E6:2 F#6:4 C#6:2 E6:2 F#6:4",
  "F#6:12 -:4",
];

/** @returns {{ line: number, length: number, note: number }[]} */
function parseLine(bars, startBar, transpose = 0) {
  const notes = [];
  let line = startBar * LPB;
  for (const token of bars.join(" ").split(/\s+/u)) {
    const match = /^([A-G][b#]?\d|-):(\d+)$/u.exec(token);
    if (!match) throw new Error(`Bad token: ${token}`);
    const length = Number(match[2]);
    if (match[1] !== "-") notes.push({ line, length, note: noteNumber(match[1]) + transpose });
    line += length;
  }
  if (line !== (startBar + bars.length) * LPB) throw new Error(`Line at bar ${startBar} has ${line - startBar * LPB} lines`);
  return notes;
}

/** Lead melody of the whole song (for checks). */
export const LEAD_LINE = [
  ...parseLine(INTRO, 0),
  ...parseLine(THEME_A, 4),
  ...parseLine(THEME_A, 12),
  ...parseLine(THEME_B, 20),
  ...parseLine(BRIDGE, 28),
  ...parseLine(THEME_A, 36),
  ...parseLine(THEME_B2, 44),
  ...parseLine(THEME_A, 52, 2),
  ...parseLine(ENDING, 60),
];

/** Highest chord tone at least a minor third below the melody note. */
function harmonyBelow(note, chord) {
  for (let candidate = note - 3; candidate > note - 12; candidate -= 1) {
    if (chord.voicing.some((interval) => pcOf(candidate - chord.rootPc) === interval)) return candidate;
  }
  return note - 12;
}

// Triangle bass roots kept between E2 and D#3.
const BASS_ROOT = (pc) => 28 + ((pc - 4 + 12) % 12);
// Driving bass: [line, octave] per bar.
const BASS_DRIVE = [[0, 0], [2, 0], [4, 12], [6, 0], [8, 0], [10, 12], [12, 0], [14, 12]];
const BASS_SYNC = [[0, 0], [3, 0], [6, 12], [8, 0], [11, 0], [14, 12]];

export function arrange(timeline, M) {
  const rng = createRng(104);
  const human = (velocity, spread = 3) => Math.max(1, Math.min(128, Math.round(velocity + (rng() * 2 - 1) * spread)));
  const sectionOf = (bar) => SECTIONS.find((section) => bar >= section.start && bar < section.start + section.bars).key;

  // --- Lead (pulse 1): duty 25 % for the themes, 12.5 % for the bridge -------
  const duty = (value) => (value / 1022) * 0x8000;
  for (const [bar, value] of [[0, 256], [28, 128], [36, 256], [52, 200]]) {
    timeline.ctl("mod", bar * LPB, { track: 0, module: M.lead, controller: "dutyCycle", value: duty(value) });
  }
  const writeLead = (notes, { velocity = 112, staccato = false } = {}) => {
    notes.forEach((entry, index) => {
      const next = notes[index + 1];
      const legato = next && next.line === entry.line + entry.length;
      const gate = staccato ? Math.min(entry.length, 2) - 1 || 1 : legato ? entry.length : entry.length - 1;
      timeline.note("lead", entry.line, { track: 0, note: entry.note, module: M.lead, velocity: human(velocity), gate });
      // Delayed vibrato on notes of a half note or longer.
      if (entry.length >= 8) {
        for (let offset = 4; offset < gate; offset += 1) {
          timeline.effect("lead", entry.line + offset, { track: 0, module: M.lead, effect: "vibrato", parameter: { speed: 16, amplitude: Math.min(14, 4 + offset) } });
        }
      }
    });
  };
  writeLead(parseLine(INTRO, 0));
  writeLead(parseLine(THEME_A, 4));
  writeLead(parseLine(THEME_A, 12));
  writeLead(parseLine(THEME_B, 20));
  writeLead(parseLine(BRIDGE, 28), { velocity: 108 });
  writeLead(parseLine(THEME_A, 36));
  writeLead(parseLine(THEME_B2, 44));
  writeLead(parseLine(THEME_A, 52, 2), { velocity: 116 });
  writeLead(parseLine(ENDING, 60), { velocity: 116 });

  // --- Pulse 2: tick arpeggios or harmony a third/sixth below -------------
  const arpChord = (bar, { from = 0, to = LPB, velocity = 84, octave = 5 } = {}) => {
    const chord = chordAtBar(bar);
    const [, third, fifth] = chord.voicing;
    const root = octave * 12 + chord.rootPc;
    const base = bar * LPB;
    timeline.note("harm", base + from, { track: 0, note: root, module: M.pulse2, velocity: human(velocity), effect: "arpeggio", parameter: { firstOffset: third, secondOffset: fifth } });
    for (let line = from + 1; line < to; line += 1) {
      timeline.effect("harm", base + line, { track: 0, module: M.pulse2, effect: "arpeggio", parameter: { firstOffset: third, secondOffset: fifth } });
    }
    timeline.off("harm", base + to, { track: 0, module: M.pulse2 });
  };
  const harmonize = (notes, transpose = 0, velocity = 92) => {
    notes.forEach((entry, index) => {
      const chord = chordAtBar(Math.floor(entry.line / LPB));
      const next = notes[index + 1];
      const legato = next && next.line === entry.line + entry.length;
      timeline.note("harm", entry.line, { track: 0, note: harmonyBelow(entry.note + transpose, chord), module: M.pulse2, velocity: human(velocity), gate: legato ? entry.length : entry.length - 1 });
    });
  };
  for (let bar = 0; bar < 4; bar += 1) {
    if (bar === 3) arpChord(bar, { to: 12, velocity: 96 });
    else for (const [from, to] of [[0, 2], [2, 4], [6, 8], [10, 12], [12, 14], [14, 16]]) arpChord(bar, { from, to, velocity: 90 });
  }
  for (let bar = 4; bar < 12; bar += 1) arpChord(bar, { velocity: 72 });
  harmonize(parseLine(THEME_A, 12));
  for (let bar = 20; bar < 28; bar += 1) {
    for (const [from, to] of [[0, 3], [3, 6], [6, 8], [8, 11], [11, 14], [14, 16]]) arpChord(bar, { from, to, velocity: 80 });
  }
  for (let bar = 28; bar < 36; bar += 1) arpChord(bar, { velocity: 86, octave: 4 });
  harmonize(parseLine(THEME_A, 36));
  harmonize(parseLine(THEME_B2, 44), 0, 86);
  harmonize(parseLine(THEME_A, 52), 2, 96);
  harmonize(parseLine(ENDING, 60).slice(0, -1), 0, 96);
  timeline.note("harm", 63 * LPB, { track: 0, note: "C#6", module: M.pulse2, velocity: 96, gate: 12 });

  // --- Triangle bass ---------------------------------------------------------
  for (let bar = 0; bar < TOTAL_BARS; bar += 1) {
    const section = sectionOf(bar);
    const root = BASS_ROOT(chordAtBar(bar).rootPc);
    const base = bar * LPB;
    if (bar === 63) {
      timeline.note("bass", base, { track: 0, note: root, module: M.bass, velocity: 120, gate: 12 });
      continue;
    }
    if (section === "intro") {
      for (const line of [0, 6, 12]) timeline.note("bass", base + line, { track: 0, note: root, module: M.bass, velocity: 116, gate: bar === 3 && line === 12 ? 4 : 2 });
      continue;
    }
    if (section === "bridge") {
      // Half notes walking up to the next root.
      timeline.note("bass", base, { track: 0, note: root, module: M.bass, velocity: human(116), gate: 7 });
      timeline.note("bass", base + 8, { track: 0, note: root + 7, module: M.bass, velocity: human(108), gate: 5 });
      timeline.note("bass", base + 14, { track: 0, note: root + 10, module: M.bass, velocity: human(104), gate: 2 });
      continue;
    }
    const pattern = section.startsWith("b") ? BASS_SYNC : BASS_DRIVE;
    for (const [line, octave] of pattern) {
      timeline.note("bass", base + line, { track: 0, note: root + octave, module: M.bass, velocity: human(octave ? 108 : 118), gate: line % 2 ? 2 : 2 });
    }
  }

  // --- Noise drums -----------------------------------------------------------
  const kick = (line, velocity = 124) => timeline.note("drums", line, { track: 0, note: "C3", module: M.kick, velocity: human(velocity) });
  const snare = (line, velocity = 118) => timeline.note("drums", line, { track: 1, note: "C5", module: M.snare, velocity: human(velocity) });
  const hat = (line, velocity) => timeline.note("drums", line, { track: 2, note: "C5", module: M.hat, velocity: human(velocity, 5) });
  for (let bar = 0; bar < TOTAL_BARS; bar += 1) {
    const section = sectionOf(bar);
    const base = bar * LPB;
    if (bar === 63) {
      kick(base);
      timeline.note("drums", base, { track: 3, note: "C5", module: M.crash, velocity: 116 });
      continue;
    }
    if (section === "intro") {
      for (const line of [0, 6, 12]) kick(base + line);
      if (bar === 3) for (let line = 0; line < LPB; line += bar === 3 ? 1 : 2) snare(base + line, 60 + line * 4);
      continue;
    }
    if ([4, 20, 36, 44, 52, 60].includes(bar)) timeline.note("drums", base, { track: 3, note: "C5", module: M.crash, velocity: 112 });
    if (section === "bridge") {
      // Half-time feel: kick on 1, snare on 3, 8th hats.
      kick(base);
      kick(base + 10, 112);
      snare(base + 8);
      for (let line = 0; line < LPB; line += 2) if (line !== 8) hat(base + line, line % 4 ? 76 : 92);
      if (bar === 35) for (const line of [12, 13, 14, 15]) snare(base + line, 84 + (line - 12) * 10);
      continue;
    }
    const fill = bar % 8 === 3 && bar > 4;
    const kicks = section.startsWith("b") ? [0, 3, 6, 10] : [0, 6, 8];
    for (const line of kicks) if (!(fill && line >= 12)) kick(base + line);
    for (const line of [4, 12]) if (!(fill && line === 12)) snare(base + line);
    for (let line = 0; line < LPB; line += 2) {
      if (fill && line >= 12) continue;
      if (line !== 4 && line !== 12) hat(base + line, line % 4 ? 84 : 100);
    }
    if (fill) for (const line of [12, 13, 14, 15]) snare(base + line, 86 + (line - 12) * 10);
  }
}

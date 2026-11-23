// @ts-check
// Score for "Brass Ferry" (#105): fast ska in G major at 176 BPM. 64 bars, one
// line is a 16th note. Horn fanfare / A theme (16) / B (8) / call-and-response
// break with organ answers (8) / A theme with harmony (16) / B (8) / ending
// hits. Offbeat guitar and organ skanks, walking bass, two-part horns.

import { createRng } from "../../../../tools/sample-synth.mjs";
import { noteNumber } from "../../../../tools/sunvox-song-builder.mjs";

export const BPM = 176;
export const LPB = 16;
export const TOTAL_BARS = 64;

export const SECTIONS = Object.freeze([
  { key: "intro", name: "Intro", start: 0, bars: 4 },
  { key: "a1", name: "A1", start: 4, bars: 16 },
  { key: "b1", name: "B1", start: 20, bars: 8 },
  { key: "break", name: "Break", start: 28, bars: 8 },
  { key: "a2", name: "A2", start: 36, bars: 16 },
  { key: "b2", name: "B2", start: 52, bars: 8 },
  { key: "ending", name: "Ending", start: 60, bars: 4 },
]);

// ---------------------------------------------------------------------------
// Harmony: one or two chords per bar ("C D" splits the bar in halves).

const A_CHORDS = ["G", "G", "Em", "Em", "C", "C", "D", "D", "G", "G", "Em", "Em", "C", "D", "G", "G"];
const B_CHORDS = ["C", "D", "Bm", "Em", "Am", "D", "G", "D7"];
const CHART = [
  "G", "Em", "C D", "D7", // intro fanfare
  ...A_CHORDS,
  ...B_CHORDS,
  "G", "G", "Em", "Em", "C", "C", "D", "D7", // break
  ...A_CHORDS,
  ...B_CHORDS,
  "G", "Em", "C D", "G", // ending
];
if (CHART.length !== TOTAL_BARS) throw new Error(`Chart covers ${CHART.length} bars`);

const QUALITIES = { "": [0, 4, 7], m: [0, 3, 7], 7: [0, 4, 7, 10] };

function parseChord(symbol) {
  const match = /^([A-G][b#]?)(m|7|)$/u.exec(symbol);
  if (!match) throw new Error(`Unsupported chord: ${symbol}`);
  return { symbol, rootPc: noteNumber(`${match[1]}4`) % 12, voicing: QUALITIES[match[2]] };
}

/** Chord segments: [{ line, chord }]. */
export const SEGMENTS = CHART.flatMap((entry, bar) => {
  const symbols = entry.split(" ");
  return symbols.map((symbol, index) => ({ line: bar * LPB + (index * LPB) / symbols.length, chord: parseChord(symbol) }));
});
export const chordAt = (line) => SEGMENTS.findLast((segment) => segment.line <= line).chord;
export const chordAtBar = (bar) => chordAt(bar * LPB);

const pcOf = (note) => ((note % 12) + 12) % 12;

/** Close voicing (triad inversion + doubled bottom, or the four 7th-chord tones) nearest the previous one. */
function createVoicer(low, high) {
  let previous;
  return (chord) => {
    let best;
    let bestCost = Infinity;
    const tones = chord.voicing;
    const rotations = tones.map((_, r) => [...tones.slice(r), ...tones.slice(0, r)]);
    for (let base = low; base < low + 12; base += 1) for (const rotation of rotations) {
      const notes = [];
      for (const interval of rotation) {
        let note = Math.max(base, (notes.at(-1) ?? base - 1) + 1);
        while (pcOf(note) !== (chord.rootPc + interval) % 12) note += 1;
        notes.push(note);
      }
      if (notes.length === 3) notes.push(notes[0] + 12);
      if (notes.at(-1) > high) continue;
      const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
      let cost = Math.abs(mean - (low + high) / 2) * 0.4;
      if (previous) notes.forEach((note, index) => { cost += Math.abs(note - previous[index]); });
      if (cost < bestCost) {
        bestCost = cost;
        best = notes;
      }
    }
    previous = best;
    return best;
  };
}

// ---------------------------------------------------------------------------
// Melodies, "Note:16ths" tokens, one string per bar.

const INTRO = [
  "G5:2 -:2 G5:2 -:2 D5:2 E5:2 G5:2 -:2",
  "B5:2 -:2 B5:2 -:2 G5:2 A5:2 B5:2 -:2",
  "C6:2 -:2 C6:2 -:2 D6:2 -:2 D6:2 -:2",
  "C6:4 A5:4 F#5:4 D5:4",
];

const THEME_A = [
  "D5:2 D5:2 B4:2 D5:4 G5:2 -:2 D5:2",
  "E5:2 D5:2 B4:2 G4:4 -:6",
  "E5:2 E5:2 G5:2 E5:4 B5:2 -:2 G5:2",
  "A5:2 G5:2 E5:2 B4:4 -:6",
  "C5:2 E5:2 G5:2 C6:4 B5:2 A5:2 G5:2",
  "E5:6 C5:2 -:8",
  "D5:2 F#5:2 A5:2 D6:4 C6:2 A5:2 F#5:2",
  "A5:8 -:4 D5:2 D5:2",
  "D5:2 D5:2 B4:2 D5:4 G5:2 -:2 D5:2",
  "E5:2 D5:2 B4:2 G4:4 -:2 G4:2 A4:2",
  "B4:2 E5:2 G5:2 B5:4 A5:2 G5:2 E5:2",
  "G5:6 F#5:2 E5:4 -:4",
  "E5:2 G5:2 C6:4 B5:2 A5:2 G5:4",
  "F#5:2 A5:2 D6:4 C6:2 A5:2 F#5:4",
  "G5:4 -:2 G5:2 -:2 G5:2 -:4",
  "-:4 D5:2 E5:2 G5:2 A5:2 B5:4",
];

const THEME_B = [
  "G5:4 E5:2 G5:2 C6:6 -:2",
  "A5:4 F#5:2 A5:2 D6:6 -:2",
  "B5:2 A5:2 F#5:2 D5:2 F#5:4 B5:4",
  "G5:8 E5:4 -:4",
  "C6:2 B5:2 A5:2 E5:2 A5:4 C6:4",
  "D6:2 C6:2 A5:2 F#5:2 A5:4 D6:4",
  "B5:4 G5:4 D5:4 G5:4",
  "F#5:2 -:2 F#5:2 -:2 A5:2 -:2 C6:2 -:2",
];

const BREAK_HORNS = [
  "G5:2 -:2 G5:2 -:10",
  "-:16",
  "B4:2 -:2 B4:2 -:2 E5:2 -:6",
  "-:16",
  "C5:2 E5:2 G5:2 -:10",
  "-:16",
  "D5:2 -:2 F#5:2 -:2 A5:2 -:2 D6:2 -:2",
  "D6:2 D6:2 -:4 A5:2 C6:2 D6:2 -:2",
];

const BREAK_ORGAN = [
  "-:16",
  "B5:1 A5:1 G5:2 D5:2 E5:2 G5:4 -:4",
  "-:16",
  "G5:1 F#5:1 E5:2 B4:2 D5:2 E5:4 -:4",
  "-:16",
  "E5:1 D5:1 C5:2 G4:2 A4:2 C5:4 -:4",
  "-:16",
  "-:16",
];

const ENDING = [
  "D5:2 D5:2 B4:2 D5:4 G5:2 -:2 D5:2",
  "E5:2 E5:2 G5:2 E5:4 B5:2 -:4",
  "C6:2 -:2 C6:2 -:2 D6:2 -:2 D6:2 -:2",
  "G5:12 -:4",
];

/** @returns {{ line: number, length: number, note: number }[]} */
function parseLine(bars, startBar) {
  const notes = [];
  let line = startBar * LPB;
  for (const token of bars.join(" ").split(/\s+/u)) {
    const match = /^([A-G][b#]?\d|-):(\d+)$/u.exec(token);
    if (!match) throw new Error(`Bad token: ${token}`);
    const length = Number(match[2]);
    if (match[1] !== "-") notes.push({ line, length, note: noteNumber(match[1]) });
    line += length;
  }
  if (line !== (startBar + bars.length) * LPB) throw new Error(`Line at bar ${startBar} has ${line - startBar * LPB} lines`);
  return notes;
}

/** Trumpet melody of the whole song (for checks). */
export const LEAD_LINE = [
  ...parseLine(INTRO, 0),
  ...parseLine(THEME_A, 4),
  ...parseLine(THEME_B, 20),
  ...parseLine(BREAK_HORNS, 28),
  ...parseLine(THEME_A, 36),
  ...parseLine(THEME_B, 52),
  ...parseLine(ENDING, 60),
];

/** Highest chord tone at least a minor third below the melody note. */
function harmonyBelow(note, chord) {
  for (let candidate = note - 3; candidate > note - 12; candidate -= 1) {
    if (chord.voicing.some((interval) => pcOf(candidate - chord.rootPc) === interval)) return candidate;
  }
  return note - 12;
}

// Bass roots kept between E1 and D#2.
const BASS_ROOT = (pc) => 16 + ((pc - 4 + 12) % 12);

export function arrange(timeline, M) {
  const rng = createRng(105);
  const human = (velocity, spread = 4) => Math.max(1, Math.min(128, Math.round(velocity + (rng() * 2 - 1) * spread)));
  const sectionOf = (bar) => SECTIONS.find((section) => bar >= section.start && bar < section.start + section.bars).key;

  // --- Horns -----------------------------------------------------------------
  const horns = (notes, { harmony = true, velocity = 112 } = {}) => {
    notes.forEach((entry, index) => {
      const next = notes[index + 1];
      const legato = next && next.line === entry.line + entry.length;
      const gate = legato ? entry.length : Math.max(1, entry.length - 1);
      // Short notes get a little fall-off in velocity; long ones a delayed vibrato.
      timeline.note("horns", entry.line, { track: 0, note: entry.note, module: M.trumpet, velocity: human(entry.length <= 2 ? velocity : velocity - 4, 3), gate });
      if (harmony) timeline.note("horns", entry.line, { track: 1, note: harmonyBelow(entry.note, chordAt(entry.line)), module: M.trombone, velocity: human(velocity - 6, 3), gate });
      if (entry.length >= 6) {
        for (let offset = 3; offset < gate; offset += 1) {
          timeline.effect("horns", entry.line + offset, { track: 0, module: M.trumpet, effect: "vibrato", parameter: { speed: 14, amplitude: Math.min(10, 2 + offset) } });
        }
      }
    });
  };
  horns(parseLine(INTRO, 0), { velocity: 116 });
  horns(parseLine(THEME_A, 4), { harmony: false });
  horns(parseLine(THEME_B, 20));
  horns(parseLine(BREAK_HORNS, 28), { velocity: 114 });
  horns(parseLine(THEME_A, 36), { velocity: 116 });
  horns(parseLine(THEME_B, 52), { velocity: 116 });
  horns(parseLine(ENDING, 60), { velocity: 118 });

  // --- Skanks: guitar on every offbeat, organ doubling in the louder parts ----
  const guitarVoicer = createVoicer(55, 72);
  const organVoicer = createVoicer(50, 66);
  for (let bar = 0; bar < 63; bar += 1) {
    const section = sectionOf(bar);
    for (const line of [2, 6, 10, 14]) {
      const at = bar * LPB + line;
      const chord = chordAt(at);
      if (section === "intro" && line !== 14 && bar < 3) continue;
      if (section === "break" && bar < 30 && line % 8 !== 6) continue;
      guitarVoicer(chord).forEach((note, index) => {
        timeline.note("guitar", at, { track: index, note, module: M.guitar, velocity: human(line === 6 || line === 14 ? 104 : 96, 4), gate: 2, delay: index || undefined });
      });
      if (["a2", "b2", "break", "ending"].includes(section) || (section === "b1")) {
        organVoicer(chord).forEach((note, index) => {
          timeline.note("organ", at, { track: index, note, module: M.organ, velocity: human(section === "break" ? 92 : 84, 3), gate: 2 });
        });
      }
    }
  }
  // Intro: band hits on the downbeats under the fanfare.
  for (let bar = 0; bar < 4; bar += 1) {
    const voicing = guitarVoicer(chordAtBar(bar));
    voicing.forEach((note, index) => timeline.note("guitar", bar * LPB, { track: index, note, module: M.guitar, velocity: 112, gate: 2 }));
  }
  // Organ answers in the break.
  for (const entry of parseLine(BREAK_ORGAN, 28)) {
    timeline.note("organ", entry.line, { track: 4, note: entry.note, module: M.organ, velocity: human(110, 3), gate: entry.length });
  }
  // Final chord.
  const finalLine = 63 * LPB;
  guitarVoicer(chordAtBar(63)).forEach((note, index) => timeline.note("guitar", finalLine, { track: index, note, module: M.guitar, velocity: 118, gate: 4 }));
  organVoicer(chordAtBar(63)).forEach((note, index) => timeline.note("organ", finalLine, { track: index, note, module: M.organ, velocity: 108, gate: 12 }));

  // --- Walking bass ----------------------------------------------------------
  for (let bar = 0; bar < TOTAL_BARS; bar += 1) {
    const section = sectionOf(bar);
    const base = bar * LPB;
    if (bar === 63) {
      timeline.note("bass", base, { track: 0, note: BASS_ROOT(chordAtBar(bar).rootPc), module: M.bass, velocity: 122, gate: 12 });
      continue;
    }
    if (section === "intro") {
      timeline.note("bass", base, { track: 0, note: BASS_ROOT(chordAtBar(bar).rootPc), module: M.bass, velocity: 118, gate: 2 });
      if (bar === 3) for (const [line, note] of [[8, "D2"], [10, "E2"], [12, "F#2"], [14, "F#1"]]) timeline.note("bass", base + line, { track: 0, note, module: M.bass, velocity: 108, gate: 2 });
      continue;
    }
    for (let beat = 0; beat < 4; beat += 1) {
      const line = base + beat * 4;
      const chord = chordAt(line);
      const root = BASS_ROOT(chord.rootPc);
      const third = root + chord.voicing[1];
      const fifth = root + 7;
      const nextLine = line + 4;
      const nextChord = chordAt(Math.min(nextLine, TOTAL_BARS * LPB - 1));
      const nextRoot = BASS_ROOT(nextChord.rootPc);
      const changing = nextChord.symbol !== chord.symbol;
      let note;
      if (beat === 0 || (beat === 2 && chordAt(line - 1).symbol !== chord.symbol)) note = root;
      else if (beat === 3 && changing) note = nextRoot + (bar % 2 ? 1 : -1);
      else if (beat === 1) note = bar % 2 ? fifth : third;
      else if (beat === 2) note = bar % 2 ? third + 12 : fifth;
      else note = bar % 2 ? fifth : root + 9;
      const breakLight = section === "break" && bar < 30 && beat % 2 === 1;
      if (breakLight) continue;
      timeline.note("bass", line, { track: 0, note, module: M.bass, velocity: human(beat === 0 ? 120 : 108, 3), gate: 3 });
    }
  }

  // --- Drums -----------------------------------------------------------------
  const kick = (line, velocity = 118) => timeline.note("drums", line, { track: 0, note: "C3", module: M.kick, velocity: human(velocity, 3) });
  const snare = (line, velocity = 112, pitch = "A3") => {
    timeline.note("drums", line, { track: 1, note: "C5", module: M.snareNoise, velocity: human(velocity, 3) });
    timeline.note("drums", line, { track: 2, note: pitch, module: M.snareBody, velocity: human(velocity - 6, 3) });
  };
  const rim = (line, velocity = 104) => timeline.note("drums", line, { track: 2, note: "E5", module: M.snareBody, velocity: human(velocity, 3) });
  const hat = (line, velocity) => timeline.note("drums", line, { track: 3, note: "C5", module: M.hat, velocity: human(velocity, 5) });
  const crash = (line, velocity = 112) => timeline.note("drums", line, { track: 4, note: "C5", module: M.crash, velocity });
  for (let bar = 0; bar < TOTAL_BARS; bar += 1) {
    const section = sectionOf(bar);
    const base = bar * LPB;
    if (bar === 63) {
      kick(base, 124);
      snare(base, 118);
      crash(base, 120);
      continue;
    }
    if (section === "intro") {
      kick(base);
      crash(base, 104);
      if (bar === 3) [4, 6, 8, 10, 12, 13, 14, 15].forEach((line, index) => snare(base + line, 70 + index * 6, 45 + index));
      continue;
    }
    if ([4, 20, 36, 52, 60].includes(bar)) crash(base);
    if (section === "break" && bar < 30) {
      kick(base);
      for (const line of [4, 12]) rim(base + line);
      for (const line of [2, 6, 10, 14]) hat(base + line, 86);
      continue;
    }
    const fill = bar % 8 === 3 && bar !== 3;
    for (const line of [0, 8]) kick(base + line);
    if (section === "a2" || section === "b2" || section === "ending") kick(base + 14, 96);
    for (const line of [4, 12]) {
      if (fill && line === 12) continue;
      snare(base + line);
    }
    for (let line = 0; line < LPB; line += 2) {
      if (fill && line >= 12) continue;
      hat(base + line, line % 4 === 2 ? 100 : 74);
    }
    if (fill) [12, 13, 14, 15].forEach((line, index) => snare(base + line, 86 + index * 9, 46 + index * 2));
    if (section !== "break") {
      timeline.note("drums", base + 14, { track: 5, note: "C5", module: M.openHat, velocity: human(section.startsWith("a") ? 84 : 96, 4) });
    }
  }
}

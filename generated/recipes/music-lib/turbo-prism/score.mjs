// @ts-check
// Score for "Turbo Prism" (#103): Eurobeat in B minor at 156 BPM. 64 bars,
// one line is a 16th note. Intro riff / Verse / Pre-chorus / Chorus (on the
// relative D major side, IV-V-iii-vi) / Riff / Break into a whole-step lift /
// two choruses in C# minor / Outro riff ending on a C# minor hit.

import { createRng } from "../../../../tools/sample-synth.mjs";
import { noteNumber } from "../../../../tools/sunvox-song-builder.mjs";

export const BPM = 156;
export const LPB = 16;
export const TOTAL_BARS = 64;

export const SECTIONS = Object.freeze([
  { key: "intro", name: "Intro", start: 0, bars: 8 },
  { key: "verse", name: "Verse", start: 8, bars: 8 },
  { key: "pre", name: "Pre-chorus", start: 16, bars: 8 },
  { key: "chorus1", name: "Chorus 1", start: 24, bars: 8 },
  { key: "riff", name: "Riff", start: 32, bars: 8 },
  { key: "break", name: "Break", start: 40, bars: 4 },
  { key: "chorus2", name: "Chorus 2", start: 44, bars: 8 },
  { key: "chorus3", name: "Chorus 3", start: 52, bars: 8 },
  { key: "outro", name: "Outro", start: 60, bars: 4 },
]);

// ---------------------------------------------------------------------------
// Harmony: one chord per bar.

const RIFF_CHORDS = ["Bm", "G", "A", "F#", "Bm", "G", "A", "F#"];
const CHORUS_CHORDS = ["G", "A", "F#m", "Bm", "Em", "F#m", "G", "A"];
const CHORUS_UP = ["A", "B", "G#m", "C#m", "F#m", "G#m", "A", "B"];
const CHART = [
  ...RIFF_CHORDS, // intro
  "Bm", "G", "A", "F#m", "Bm", "G", "Em", "F#", // verse
  "Em", "F#m", "G", "A", "Em", "F#m", "G", "A", // pre-chorus
  ...CHORUS_CHORDS, // chorus 1
  ...RIFF_CHORDS, // riff
  "G", "A", "Bsus4", "B", // break, V of the new key
  ...CHORUS_UP, ...CHORUS_UP, // choruses in C# minor
  "C#m", "A", "B", "C#m", // outro
];
if (CHART.length !== TOTAL_BARS) throw new Error(`Chart covers ${CHART.length} bars`);

const QUALITIES = { "": [0, 4, 7], m: [0, 3, 7], sus4: [0, 5, 7] };

function parseChord(symbol) {
  const match = /^([A-G][b#]?)(m|sus4|)$/u.exec(symbol);
  if (!match) throw new Error(`Unsupported chord: ${symbol}`);
  return { symbol, rootPc: noteNumber(`${match[1]}4`) % 12, voicing: QUALITIES[match[2]] };
}

export const chordAtBar = (bar) => parseChord(CHART[Math.min(bar, TOTAL_BARS - 1)]);

const pcOf = (note) => ((note % 12) + 12) % 12;

/** Four-note voicing (triad inversion + doubled bottom) nearest the previous one. */
function createVoicer(low, high) {
  let previous;
  return (chord) => {
    let best;
    let bestCost = Infinity;
    const rotations = chord.voicing.map((_, r) => [...chord.voicing.slice(r), ...chord.voicing.slice(0, r)]);
    for (let base = low; base < low + 12; base += 1) for (const rotation of rotations) {
      const notes = [];
      for (const interval of rotation) {
        let note = Math.max(base, (notes.at(-1) ?? base - 1) + 1);
        while (pcOf(note) !== (chord.rootPc + interval) % 12) note += 1;
        notes.push(note);
      }
      notes.push(notes[0] + 12);
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

const RIFF = [
  "B4:2 B4:1 D5:1 F#5:2 B5:2 A5:2 F#5:2 D5:2 F#5:2",
  "G5:2 F#5:2 D5:2 B4:2 D5:2 G5:2 F#5:2 D5:2",
  "E5:2 A5:2 C#6:2 A5:2 E5:2 C#5:2 E5:2 A5:2",
  "A#5:3 F#5:3 C#5:2 A#4:2 C#5:2 F#5:2 E5:2",
];
const RIFF_B = [...RIFF.slice(0, 3), "A#5:3 C#6:3 A#5:2 F#5:4 -:4"];

const VERSE = [
  "-:2 F#4:2 B4:2 C#5:2 D5:4 C#5:2 B4:2",
  "D5:4 B4:2 G4:2 -:4 G4:2 A4:2",
  "B4:2 C#5:2 E5:4 C#5:2 A4:2 B4:2 C#5:2",
  "C#5:6 A4:2 F#4:6 -:2",
  "-:2 F#4:2 B4:2 C#5:2 D5:4 E5:2 F#5:2",
  "G5:4 F#5:2 D5:2 B4:4 D5:2 E5:2",
  "E5:2 F#5:2 G5:4 F#5:2 E5:2 D5:2 E5:2",
  "F#5:8 E5:2 C#5:2 A#4:4",
];

const PRE = [
  "G4:2 B4:2 E5:4 D5:2 B4:2 G4:4",
  "A4:2 C#5:2 F#5:4 E5:2 C#5:2 A4:4",
  "B4:2 D5:2 G5:4 F#5:2 D5:2 B4:2 D5:2",
  "E5:4 C#5:4 A4:4 C#5:4",
  "E5:2 F#5:2 G5:4 F#5:2 E5:2 B4:4",
  "C#5:2 E5:2 F#5:4 E5:2 C#5:2 A4:4",
  "B4:4 D5:4 G5:4 B5:4",
  "A5:8 -:4 E5:2 F#5:2",
];

const CHORUS = [
  "G5:4 F#5:2 G5:2 A5:4 F#5:2 D5:2",
  "E5:4 F#5:2 E5:2 C#5:4 A4:2 C#5:2",
  "F#5:4 E5:2 F#5:2 A5:4 C#6:2 A5:2",
  "B5:6 A5:2 F#5:4 D5:2 E5:2",
  "G5:4 F#5:2 E5:2 B5:4 A5:2 G5:2",
  "A5:4 F#5:2 E5:2 C#5:4 E5:2 F#5:2",
  "G5:4 A5:2 B5:2 D6:4 B5:2 A5:2",
  "A5:6 G5:2 F#5:2 E5:2 C#5:2 E5:2",
];
// The last chorus ends on a held B (V of C# minor) with a pickup into the outro riff.
const CHORUS_END = [...CHORUS.slice(0, 7), "A5:8 -:4 F#5:2 G#5:2"];

const BREAK_PIANO = [
  "G5:4 F#5:2 G5:2 A5:4 F#5:2 D5:2",
  "E5:4 F#5:2 E5:2 C#5:4 A4:2 C#5:2",
  "E5:4 F#5:4 B5:8",
  "F#5:4 B5:4 D#6:4 -:4",
];

const OUTRO = [
  "C#5:2 C#5:1 E5:1 G#5:2 C#6:2 B5:2 G#5:2 E5:2 G#5:2",
  "A5:2 G#5:2 E5:2 C#5:2 E5:2 A5:2 G#5:2 E5:2",
  "F#5:2 B5:2 D#6:2 B5:2 F#5:2 D#5:2 F#5:2 B5:2",
  "C#6:6 -:10",
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

/** Lead melody of the whole song (for checks): [{ line, length, note }]. */
export const LEAD_LINE = [
  ...parseLine([...RIFF, ...RIFF_B], 0),
  ...parseLine(VERSE, 8),
  ...parseLine(PRE, 16),
  ...parseLine(CHORUS, 24),
  ...parseLine([...RIFF, ...RIFF_B], 32),
  ...parseLine(CHORUS, 44, 2),
  ...parseLine(CHORUS_END, 52, 2),
  ...parseLine(OUTRO, 60),
];

// ---------------------------------------------------------------------------

// Bass roots kept between F#1 and F2 (octave jumps go up to F3).
const BASS_ROOT = (pc) => 18 + ((pc - 6 + 12) % 12);

// Brass stab rhythms: [line, gate, velocity].
const RIFF_STABS = [[0, 3, 116], [6, 2, 104], [10, 2, 108], [12, 3, 112]];
const CHORUS_STABS = [[0, 2, 100], [6, 2, 90], [10, 2, 94]];

export function arrange(timeline, M) {
  const rng = createRng(103);
  const human = (velocity, spread = 4) => Math.max(1, Math.min(128, Math.round(velocity + (rng() * 2 - 1) * spread)));
  const sectionOf = (bar) => SECTIONS.find((section) => bar >= section.start && bar < section.start + section.bars).key;
  const isChorus = (bar) => sectionOf(bar).startsWith("chorus");
  const freq = (hz) => (hz / 14000) * 0x8000;

  // --- Automation and FX -----------------------------------------------------
  // Music bus low-pass opens over the first four intro bars and dips in the break.
  const musicCutoff = (bar) => {
    if (bar < 4) return 700 * ((14000 / 700) ** (bar / 4));
    if (bar >= 40 && bar < 42) return 2600;
    if (bar >= 42 && bar < 44) return 2600 * ((14000 / 2600) ** ((bar - 42) / 2));
    return 14000;
  };
  for (let line = 0; line < TOTAL_BARS * LPB; line += 2) {
    const bar = line / LPB;
    const value = musicCutoff(bar);
    if (line === 0 || Math.abs(value - musicCutoff(Math.max(0, bar - 2 / LPB))) > 1) {
      timeline.ctl("mod", line, { track: 0, module: M.musicFilter, controller: "freq", value: freq(value) });
    }
  }
  // Risers into chorus 1 and the key-up chorus.
  for (const startBar of [22, 42]) {
    const length = 2 * LPB - 1;
    timeline.note("mod", startBar * LPB, { track: 1, note: "C5", module: M.riser, velocity: 100, gate: length });
    for (let line = 0; line < length; line += 2) {
      const t = line / (2 * LPB);
      timeline.ctl("mod", startBar * LPB + line, { track: 2, module: M.riserVcf, controller: "freq", value: freq(500 + 8500 * t * t) });
    }
  }
  for (const bar of [4, 24, 32, 44, 52, 60, 63]) {
    timeline.note("mod", bar * LPB, { track: 3, note: "C5", module: M.crash, velocity: bar === 4 ? 96 : 116 });
  }

  // --- Drums -----------------------------------------------------------------
  const snare = (line, velocity, pitch = "A3") => {
    timeline.note("drums", line, { track: 1, note: "C5", module: M.snareNoise, velocity });
    timeline.note("drums", line, { track: 2, note: pitch, module: M.snareBody, velocity: velocity - 6 });
  };
  const roll = (startBar, bars) => {
    for (let bar = startBar; bar < startBar + bars; bar += 1) {
      const step = bar === startBar + bars - 1 ? 1 : 2;
      for (let line = 0; line < LPB; line += step) {
        const t = ((bar - startBar) * LPB + line) / (bars * LPB);
        snare(bar * LPB + line, Math.round(56 + 66 * t), 45 + Math.round(t * 10));
      }
    }
  };
  roll(3, 1);
  roll(22, 2);
  roll(43, 1);

  for (let bar = 2; bar < TOTAL_BARS; bar += 1) {
    const section = sectionOf(bar);
    const base = bar * LPB;
    if (section === "break") continue;
    if (bar === 63) {
      timeline.note("drums", base, { track: 0, note: "C3", module: M.kick, velocity: 124 });
      continue;
    }
    for (const line of [0, 4, 8, 12]) {
      timeline.note("drums", base + line, { track: 0, note: "C3", module: M.kick, velocity: human(line === 0 ? 124 : 118, 3) });
    }
    if (bar < 4) continue;
    const building = (bar >= 22 && bar < 24) || bar === 3;
    if (!building) {
      for (const line of [4, 12]) {
        timeline.note("drums", base + line, { track: 3, note: "C5", module: M.clap, velocity: human(116, 3) });
        if (section !== "verse") snare(base + line, human(100, 3));
      }
      if (bar % 8 === 7 && bar !== 39) [13, 14, 15].forEach((line, index) => snare(base + line, 78 + index * 14, 47 + index * 2));
    } else {
      for (const line of [4, 12]) timeline.note("drums", base + line, { track: 3, note: "C5", module: M.clap, velocity: human(110, 3) });
    }
    for (let step = 0; step < LPB; step += 1) {
      if (step % 4 === 2) timeline.note("drums", base + step, { track: 4, note: "C5", module: M.openHat, velocity: human(section === "verse" ? 96 : 108, 4) });
      else if (section !== "verse" || step % 2 === 0) {
        timeline.note("drums", base + step, { track: 5, note: "C5", module: M.closedHat, velocity: human(step % 4 === 0 ? 66 : 86, 6) });
      }
    }
  }

  // --- Octave bass -----------------------------------------------------------
  for (let bar = 4; bar < 63; bar += 1) {
    const section = sectionOf(bar);
    if (section === "break") continue;
    const root = BASS_ROOT(chordAtBar(bar).rootPc);
    for (let step = 0; step < 8; step += 1) {
      const line = bar * LPB + step * 2;
      const up = step % 2 === 1;
      timeline.note("bass", line, { track: 0, note: root + (up ? 12 : 0), module: M.bass, velocity: human(up ? 104 : 118, 3), gate: 2 });
    }
  }
  timeline.note("bass", 63 * LPB, { track: 0, note: BASS_ROOT(chordAtBar(63).rootPc), module: M.bass, velocity: 120, gate: LPB });

  // --- Brass stabs -----------------------------------------------------------
  const brassVoicer = createVoicer(54, 72);
  for (let bar = 4; bar < TOTAL_BARS; bar += 1) {
    const section = sectionOf(bar);
    const voicing = brassVoicer(chordAtBar(bar));
    const base = bar * LPB;
    if (bar === 63) {
      voicing.forEach((note, index) => timeline.note("brass", base, { track: index, note, module: M.brass, velocity: 118, gate: 8 }));
      continue;
    }
    if (section === "break" || section === "pre") continue;
    if (section === "verse") {
      for (const line of [2, 6, 10, 14]) voicing.forEach((note, index) => {
        timeline.note("brass", base + line, { track: index, note, module: M.brass, velocity: human(70, 3), gate: 1 });
      });
      continue;
    }
    const stabs = isChorus(bar) ? CHORUS_STABS : RIFF_STABS;
    for (const [line, gate, velocity] of stabs) voicing.forEach((note, index) => {
      timeline.note("brass", base + line, { track: index, note, module: M.brass, velocity: human(velocity, 3), gate });
    });
  }

  // --- Strings: pre-chorus, choruses and the break ---------------------------
  const stringVoicer = createVoicer(50, 69);
  for (let bar = 16; bar < 60; bar += 1) {
    const section = sectionOf(bar);
    if (section === "riff") continue;
    const voicing = stringVoicer(chordAtBar(bar));
    const gate = bar === 43 ? LPB - 2 : LPB;
    const velocity = section === "break" ? 112 : section === "pre" ? 96 : 104;
    voicing.forEach((note, index) => timeline.note("pad", bar * LPB, { track: index, note, module: M.strings, velocity: human(velocity, 2), gate }));
  }

  // --- Leads -----------------------------------------------------------------
  const writeLead = (notes, module, { octave = false, velocity = 112, octaveVelocity = 76 } = {}) => {
    notes.forEach((entry, index) => {
      const next = notes[index + 1];
      const legato = next && next.line === entry.line + entry.length;
      const gate = legato ? entry.length : entry.length - 1;
      timeline.note("lead", entry.line, { track: 0, note: entry.note, module, velocity: human(velocity, 3), gate });
      if (octave) timeline.note("lead", entry.line, { track: 1, note: entry.note + 12, module, velocity: human(octaveVelocity, 3), gate });
    });
  };
  writeLead(parseLine([...RIFF, ...RIFF_B], 0), M.sawLeadIn);
  writeLead(parseLine(VERSE, 8), M.verseLead, { velocity: 108 });
  writeLead(parseLine(PRE, 16), M.verseLead, { velocity: 112 });
  writeLead(parseLine(CHORUS, 24), M.sawLeadIn, { octave: true, octaveVelocity: 64 });
  writeLead(parseLine([...RIFF, ...RIFF_B], 32), M.sawLeadIn, { octave: true, octaveVelocity: 56 });
  writeLead(parseLine(CHORUS, 44, 2), M.sawLeadIn, { octave: true, octaveVelocity: 72 });
  writeLead(parseLine(CHORUS_END, 52, 2), M.sawLeadIn, { octave: true, octaveVelocity: 78 });
  writeLead(parseLine(OUTRO, 60), M.sawLeadIn, { octave: true, octaveVelocity: 64 });

  // --- 16th arpeggio ---------------------------------------------------------
  const arpVoicer = createVoicer(62, 82);
  const ARP_ORDER = [0, 1, 2, 3, 2, 1, 0, 1, 2, 3, 2, 1, 0, 1, 2, 3];
  for (let bar = 0; bar < 62; bar += 1) {
    const section = sectionOf(bar);
    if (section === "break" && bar < 42) continue;
    const voicing = arpVoicer(chordAtBar(bar));
    const quiet = bar < 4 || section === "verse";
    ARP_ORDER.forEach((voice, step) => {
      timeline.note("arp", bar * LPB + step, { track: 0, note: voicing[voice], module: M.arp, velocity: human((step % 4 === 0 ? 96 : 80) - (quiet ? 12 : 0), 4), gate: 1 });
    });
  }

  // --- Break piano -----------------------------------------------------------
  const pianoVoicer = createVoicer(52, 70);
  for (let bar = 40; bar < 44; bar += 1) {
    const chord = chordAtBar(bar);
    const voicing = pianoVoicer(chord);
    voicing.forEach((note, index) => {
      timeline.note("piano", bar * LPB, { track: index, note, module: M.piano, velocity: human(92, 3), gate: bar === 43 ? 12 : LPB, delay: index ? index * 2 : undefined });
    });
    timeline.note("piano", bar * LPB, { track: 4, note: 36 + chord.rootPc, module: M.piano, velocity: human(96, 3), gate: bar === 43 ? 12 : LPB });
  }
  for (const entry of parseLine(BREAK_PIANO, 40)) {
    timeline.note("piano", entry.line, { track: 5, note: entry.note, module: M.piano, velocity: human(108, 3), gate: entry.length });
    timeline.note("piano", entry.line, { track: 6, note: entry.note + 12, module: M.piano, velocity: human(82, 3), gate: entry.length });
  }
}

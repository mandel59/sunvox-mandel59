// @ts-check
// Score for "Midnight Loop Line" (#79): neo city pop in Eb major, 116 BPM,
// with a final chorus lifted to E major. All parts are generated into a
// section-by-lane Timeline; one line is a 16th note.

import { createRng } from "../../../tools/sample-synth.mjs";
import { noteNumber } from "./song-builder.mjs";

export const BPM = 116;
export const LPB = 16;
export const BAR_SECONDS = (60 / BPM) * 4;

export const SECTIONS = Object.freeze([
  { key: "intro", name: "Intro", start: 0, bars: 8 },
  { key: "verse", name: "Verse", start: 8, bars: 8 },
  { key: "pre", name: "Pre-chorus", start: 16, bars: 4 },
  { key: "chorus", name: "Chorus", start: 20, bars: 8 },
  { key: "inter", name: "Interlude", start: 28, bars: 4 },
  { key: "bridge", name: "Bridge", start: 32, bars: 8 },
  { key: "build", name: "Lift", start: 40, bars: 2 },
  { key: "final", name: "Final chorus", start: 42, bars: 8 },
  { key: "outro", name: "Outro", start: 50, bars: 7 },
]);

export const TOTAL_BARS = 57;

// One entry per bar; two symbols split the bar into halves.
export const CHART = Object.freeze([
  // Intro: dream (0-3), theme riff (4-7)
  "Abmaj9", "Gm7", "Fm9", "Bb7sus4", "Ebmaj7", "Cm7", "Abmaj7", "Bb7sus4 Bb7",
  // Verse: IVmaj7 - III7 - vim7 - vm7 I7 ("Just the Two of Us" motion)
  "Abmaj7", "G7b9", "Cm7", "Bbm7 Eb7", "Abmaj7", "G7b9", "Cm7", "Bbm7 Eb7",
  // Pre-chorus: ii - iii - IV - V
  "Fm7", "Gm7", "Abmaj7", "Bb7sus4 Bb7",
  // Chorus: royal road IVmaj7 - V7 - iiim7 - vim7
  "Abmaj7", "Bb7", "Gm7", "Cm7", "Abmaj7", "Bb7", "Gm7 C7b9", "Fm7 Bb7sus4",
  // Interlude: theme riff
  "Ebmaj7", "Cm7", "Abmaj7", "Bb7sus4 Bb7",
  // Bridge with the minor subdominant
  "Cm7", "Abmaj7", "Fm7", "Gm7", "Bbm7 Eb7", "Abmaj7", "Abm6", "Bb7sus4",
  // Lift to E major
  "F#m7", "B7sus4 B7",
  // Final chorus in E
  "Amaj7", "B7", "G#m7", "C#m7", "Amaj7", "B7", "G#m7 C#7b9", "F#m7 B7sus4",
  // Outro: theme riff in E, final chord, tail
  "Emaj7", "C#m7", "Amaj7", "B7sus4 B7", "Emaj9", "Emaj9", "Emaj9",
]);

const EB_MAJOR = [3, 5, 7, 8, 10, 0, 2];
const E_MAJOR = [4, 6, 8, 9, 11, 1, 3];
export const scaleForBar = (bar) => (bar >= 40 ? E_MAJOR : EB_MAJOR);

// ---------------------------------------------------------------------------
// Harmony

const QUALITIES = {
  maj7: { tones: [0, 4, 7, 11], upper: [4, 7, 11, 14] },
  maj9: { tones: [0, 4, 7, 11, 14], upper: [4, 7, 11, 14] },
  m7: { tones: [0, 3, 7, 10], upper: [3, 7, 10, 14] },
  m9: { tones: [0, 3, 7, 10, 14], upper: [3, 7, 10, 14] },
  m6: { tones: [0, 3, 7, 9], upper: [3, 7, 9, 14] },
  7: { tones: [0, 4, 7, 10], upper: [4, 10, 14, 21] },
  // III7 / V7-of-minor chords take the diatonic b9 and b13 tensions.
  "7b9": { tones: [0, 4, 7, 10, 13], upper: [4, 10, 13, 20] },
  "7sus4": { tones: [0, 5, 7, 10], upper: [5, 10, 14, 19] },
};

export function parseChord(symbol) {
  const match = /^([A-G][b#]?)(maj9|maj7|m9|m7|m6|7sus4|7b9|7)$/u.exec(symbol);
  if (!match) throw new Error(`Unsupported chord: ${symbol}`);
  const quality = QUALITIES[match[2]];
  const rootPc = ((noteNumber(`${match[1]}4`) % 12) + 12) % 12;
  return { symbol, rootPc, ...quality };
}

/** Chords active in a bar as [{ chord, start, length }] in lines relative to the bar. */
export function chordsInBar(bar) {
  const symbols = CHART[bar].split(" ");
  const length = LPB / symbols.length;
  return symbols.map((symbol, index) => ({ chord: parseChord(symbol), start: index * length, length }));
}

export function chordAt(line) {
  const bar = Math.floor(line / LPB);
  const position = line % LPB;
  const entries = chordsInBar(Math.min(bar, CHART.length - 1));
  return entries.filter((entry) => entry.start <= position).at(-1).chord;
}

function voicingCandidates(chord, intervals, low, high) {
  const pcs = [...new Set(intervals.map((interval) => (chord.rootPc + interval) % 12))].sort((a, b) => a - b);
  const candidates = [];
  for (let rotation = 0; rotation < pcs.length; rotation += 1) {
    const order = [...pcs.slice(rotation), ...pcs.slice(0, rotation)];
    for (let base = low; base < low + 12; base += 1) {
      if (base % 12 !== order[0]) continue;
      const notes = [base];
      for (const pc of order.slice(1)) {
        let next = notes.at(-1) + 1;
        while (next % 12 !== pc) next += 1;
        notes.push(next);
      }
      if (notes.at(-1) <= high) candidates.push(notes);
    }
  }
  return candidates;
}

/** Voice-leading voicer: picks the close voicing nearest the previous one. */
export function createVoicer({ low, high, center, intervals = "upper" }) {
  let previous;
  return (chord) => {
    const set = intervals === "upper" ? chord.upper : intervals === "tones" ? chord.tones : intervals(chord);
    const candidates = voicingCandidates(chord, set, low, high);
    if (!candidates.length) throw new Error(`No voicing for ${chord.symbol}`);
    let best;
    let bestCost = Number.POSITIVE_INFINITY;
    for (const notes of candidates) {
      const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
      let cost = Math.abs(mean - center) * 0.6;
      if (previous) {
        for (let index = 0; index < notes.length; index += 1) {
          cost += Math.abs(notes[index] - previous[Math.min(index, previous.length - 1)]);
        }
      }
      if (cost < bestCost) {
        bestCost = cost;
        best = notes;
      }
    }
    previous = best;
    return best;
  };
}

// Lead and doubled lines that voicings must respect.
const MELODY_NOTES = [];

function sustainedMelodyPcs(start, end) {
  const pcs = new Set();
  for (const entry of MELODY_NOTES) {
    if (entry.length < 2) continue;
    if (entry.line < end && entry.line + entry.length > start) pcs.add(((entry.note % 12) + 12) % 12);
  }
  return pcs;
}

/**
 * Removes voicing tones a semitone below a sustained melody pitch class (the
 * b9 rub), replacing them with the nearest non-clashing chord tone.
 */
export function fitVoicing(voicing, chord, start, end) {
  const melody = sustainedMelodyPcs(start, end);
  if (!melody.size) return voicing;
  const clashes = (pc) => [...melody].some((m) => (m - pc + 12) % 12 === 1);
  const used = new Set(voicing.map((note) => note % 12));
  const result = [];
  for (const note of voicing) {
    if (!clashes(note % 12)) {
      result.push(note);
      continue;
    }
    const options = chord.tones
      .map((tone) => (chord.rootPc + tone) % 12)
      .filter((pc) => !clashes(pc) && !used.has(pc));
    let best;
    for (const pc of options) {
      for (const candidate of [note - 12, note, note + 12].map((n) => n - (((n % 12) - pc + 12) % 12))) {
        if (best === undefined || Math.abs(candidate - note) < Math.abs(best - note)) best = candidate;
      }
    }
    if (best !== undefined) {
      used.add(best % 12);
      result.push(best);
    }
  }
  return result.sort((a, b) => a - b);
}

function bassRoot(chord, previous) {
  let best = 28 + ((chord.rootPc - 4 + 12) % 12);
  if (previous !== undefined) {
    for (const candidate of [best - 12, best, best + 12]) {
      if (candidate >= 27 && candidate <= 42 && Math.abs(candidate - previous) < Math.abs(best - previous)) best = candidate;
    }
  }
  return best;
}

function diatonicBelow(note, scale, steps = 2) {
  const pc = ((note % 12) + 12) % 12;
  const degree = scale.indexOf(pc);
  if (degree < 0) return note - 3;
  const target = scale[(degree - steps + scale.length * 2) % scale.length];
  let result = note - 1;
  while (((result % 12) + 12) % 12 !== target) result -= 1;
  return result;
}

// ---------------------------------------------------------------------------
// Melody notation: "Note:16ths[mods]" tokens; "-:n" is a rest.
// Mods: ! accent, . staccato, ~ glide from previous, v vibrato, _ soft.

export function parseMelody(text, startLine, transpose = 0) {
  const notes = [];
  let line = startLine;
  for (const token of text.trim().split(/\s+/u)) {
    const match = /^([A-G][b#]?\d|-):(\d+)([!.~v_]*)$/u.exec(token);
    if (!match) throw new Error(`Bad melody token: ${token}`);
    const length = Number(match[2]);
    if (match[1] !== "-") {
      notes.push({
        line,
        length,
        note: noteNumber(match[1]) + transpose,
        accent: match[3].includes("!"),
        staccato: match[3].includes("."),
        glide: match[3].includes("~"),
        vibrato: match[3].includes("v"),
        soft: match[3].includes("_"),
      });
    }
    line += length;
  }
  return { notes, end: line };
}

function melody(bars, startBar, transpose = 0) {
  const { notes, end } = parseMelody(bars.join(" "), startBar * LPB, transpose);
  if (end !== (startBar + bars.length) * LPB) {
    throw new Error(`Melody at bar ${startBar} spans ${end - startBar * LPB} lines, expected ${bars.length * LPB}`);
  }
  return notes;
}

const RIFF = [
  "Eb6:1. -:1 D6:1 Bb5:2 -:1 G5:1 Bb5:2 -:1 C6:1 D6:2 -:1 Bb5:2",
  "C6:1. -:1 Bb5:1 G5:2 -:1 Eb5:1 G5:2 -:1 F5:1 G5:2 -:1 Eb5:2",
  "C6:1. -:1 Bb5:1 Ab5:2 -:1 G5:1 Ab5:2 -:1 Bb5:1 C6:2 -:1 Eb6:2",
  "Eb6:2! -:1 D6:2! -:1 Bb5:2! -:4 Ab5:1 Bb5:1 C6:1 D6:1",
];

const VERSE = [
  "-:2 C5:1 Eb5:1 G5:2 F5:1 Eb5:1 F5:2 Eb5:1 C5:3 -:2",
  "-:2 D5:1 F5:1 Ab5:2 G5:1 F5:1 G5:3 F5:1 D5:2 B4:2",
  "C5:4 Eb5:1 G5:1 Bb5:2 Ab5:1 G5:2 F5:1 Eb5:2 D5:2",
  "Db5:2 C5:1 Bb4:1 Db5:2 F5:2 G5:3 F5:1 Eb5:1 Db5:1 Eb5:2",
  "-:2 C5:1 Eb5:1 G5:2 F5:1 Eb5:1 Bb5:3 Ab5:1 G5:4",
  "-:2 F5:1 G5:1 Ab5:2 G5:1 F5:1 D5:2 F5:2 G5:2 B4:2",
  "C5:2 Eb5:1 G5:1 C6:4v Bb5:2 G5:2 Eb5:2 F5:2",
  "Db5:3 C5:1 Bb4:2 Db5:2 Eb5:4 -:4",
];

const PRE = [
  "Ab4:2 C5:2 Eb5:3 F5:1 Eb5:2 C5:2 Eb5:4",
  "Bb4:2 D5:2 F5:3 G5:1 F5:2 D5:2 F5:4",
  "C5:2 Eb5:2 G5:3 Ab5:1 G5:2 Eb5:2 G5:2 Ab5:2",
  "Bb5:6v Ab5:1 Bb5:1 C6:2 D6:2 -:2 Eb5:1 F5:1",
];

const CHORUS = [
  "G5:3 Bb5:3 C6:2 Bb5:2 G5:2 F5:1 G5:3",
  "F5:3 Ab5:3 Bb5:2 Ab5:2 F5:2 Eb5:1 F5:3",
  "D5:3 F5:3 G5:2 F5:2 D5:2 C5:1 D5:3",
  "Eb5:3 G5:3 F5:2 Eb5:2 D5:2 C5:2 Eb5:1 F5:1",
  "G5:3 Bb5:3 C6:2 Bb5:2 G5:2 F5:1 G5:3",
  "F5:3 Ab5:3 Bb5:2 C6:2 D6:2 Bb5:1 Eb6:3!",
  "D6:4v C6:2 Bb5:2 C6:3 Bb5:1 G5:2 E5:2",
  "F5:3 G5:1 Ab5:2 G5:2 F5:2 Eb5:1 D5:1 Eb5:4",
];

const BRIDGE = [
  "G5:6 F5:2 Eb5:4 D5:2 Eb5:2",
  "C5:8v -:4 Eb5:2 F5:2",
  "Ab5:6 G5:2 F5:4 Eb5:2 F5:2",
  "D5:8v -:4 F5:2 G5:2",
  "Db6:4 C6:2 Bb5:2 G5:4 Ab5:2 Bb5:2",
  "C6:8v Bb5:2 Ab5:2 G5:4",
  "B5:6v Bb5:2 Ab5:4 F5:4",
  "F5:3! G5:3! Ab5:2! -:8",
];

const LIFT = [
  "-:8 C#5:2 E5:2 F#5:2 A5:2",
  "B5:6v A5:1 B5:1 C#6:2 D#6:2 -:2 E5:1 F#5:1",
];

const OUTRO_TAIL = ["E6:16v", "-:16", "-:16"];

const BELL_TEASER = [
  "-:4 G5:3 Bb5:3 C6:6",
  "-:4 F5:3 Bb5:3 D6:6",
  "-:4 Eb5:3 Ab5:3 C6:6",
  "-:4 F5:3 Bb5:3 Eb6:4 D6:2",
];

export const LEAD_LINES = Object.freeze({
  riff1: melody(RIFF, 4),
  verse: melody(VERSE, 8),
  pre: melody(PRE, 16),
  chorus: melody(CHORUS, 20),
  riff2: melody(RIFF, 28),
  bridge: melody(BRIDGE, 32),
  lift: melody(LIFT, 40),
  final: melody(CHORUS, 42, 1),
  riff3: melody(RIFF, 50, 1),
  outroTail: melody(OUTRO_TAIL, 54, 0),
  bellTeaser: melody(BELL_TEASER, 0),
});

// ---------------------------------------------------------------------------
// Arrangement

const SWING = 5; // 1/32-line delay for off-beat 16ths
const KIMES = new Set([7, 31, 39, 53]);

function sectionOf(bar) {
  return SECTIONS.find((section) => bar >= section.start && bar < section.start + section.bars)?.key;
}

function swingDelay(line) {
  return line % 2 === 1 ? SWING : 0;
}

export function arrange(timeline, M) {
  const rng = createRng(79);
  MELODY_NOTES.length = 0;
  for (const notes of Object.values(LEAD_LINES)) MELODY_NOTES.push(...notes);
  const human = (velocity, spread = 4) => Math.max(1, Math.min(128, Math.round(velocity + (rng() * 2 - 1) * spread)));

  // --- Lead and doubles -----------------------------------------------------
  const writeLine = (notes, { module, track, lane = "lead", velocity = 104, bellDouble = false, swing = true, glideSpeed = 70 }) => {
    notes.forEach((entry, index) => {
      const next = notes[index + 1];
      const legato = next && next.line === entry.line + entry.length;
      const gate = entry.staccato ? Math.max(1, entry.length - 1) : legato ? undefined : entry.length;
      const options = {
        track,
        note: entry.note,
        module,
        velocity: human(velocity + (entry.accent ? 14 : 0) - (entry.soft ? 24 : 0), 3),
        gate,
      };
      if (entry.glide) Object.assign(options, { effect: "tonePortamento", parameter: { speed: glideSpeed } });
      else if (swing && swingDelay(entry.line)) options.delay = swingDelay(entry.line);
      timeline.note(lane, entry.line, options);
      if (entry.vibrato && entry.length >= 6) {
        for (let offset = 4; offset < entry.length; offset += 1) {
          timeline.effect(lane, entry.line + offset, { track, module, effect: "vibrato", parameter: { speed: 6, amplitude: Math.min(28, 8 + offset * 3) } });
        }
      }
      if (bellDouble && entry.length >= 2) {
        timeline.note(lane, entry.line, {
          track: 1, note: entry.note + 12, module: M.bell, velocity: human(entry.accent ? 84 : 70, 4), gate: Math.min(entry.length, 4),
          ...(swingDelay(entry.line) ? { delay: swingDelay(entry.line) } : {}),
        });
      }
    });
  };

  writeLine(LEAD_LINES.riff1, { module: M.lead, track: 0, velocity: 106 });
  writeLine(LEAD_LINES.verse, { module: M.lead, track: 0, velocity: 98 });
  writeLine(LEAD_LINES.pre, { module: M.lead, track: 0, velocity: 102 });
  writeLine(LEAD_LINES.chorus, { module: M.lead, track: 0, velocity: 110, bellDouble: true });
  writeLine(LEAD_LINES.riff2, { module: M.lead, track: 0, velocity: 108 });
  writeLine(LEAD_LINES.bridge, { module: M.whistle, track: 6, velocity: 100, swing: false });
  writeLine(LEAD_LINES.lift, { module: M.lead, track: 0, velocity: 106 });
  writeLine(LEAD_LINES.final, { module: M.lead, track: 0, velocity: 116, bellDouble: true });
  writeLine(LEAD_LINES.riff3, { module: M.lead, track: 0, velocity: 110 });
  writeLine(LEAD_LINES.outroTail, { module: M.lead, track: 0, velocity: 112 });
  writeLine(LEAD_LINES.bellTeaser, { module: M.bell, track: 1, velocity: 62, swing: false });

  // Brass doubles the riff an octave down with a diatonic third underneath.
  for (const riff of [LEAD_LINES.riff1, LEAD_LINES.riff2, LEAD_LINES.riff3]) {
    for (const entry of riff) {
      const bar = Math.floor(entry.line / LPB);
      if (KIMES.has(bar) && entry.line % LPB < 8) continue;
      const top = entry.note - 12;
      const under = diatonicBelow(top, scaleForBar(bar));
      const gate = entry.staccato ? 1 : Math.min(entry.length, 2);
      const delay = swingDelay(entry.line) || undefined;
      timeline.note("lead", entry.line, { track: 2, note: top, module: M.brass, velocity: human(entry.accent ? 118 : 104), gate, delay });
      timeline.note("lead", entry.line, { track: 3, note: under, module: M.brass, velocity: human(entry.accent ? 110 : 96), gate, delay });
    }
  }

  // --- Chords ---------------------------------------------------------------
  const epVoicer = createVoicer({ low: 53, high: 77, center: 64 });
  const stringVoicer = createVoicer({ low: 60, high: 86, center: 72, intervals: "tones" });
  const brassVoicer = createVoicer({ low: 65, high: 84, center: 74 });
  const guitarVoicer = createVoicer({ low: 55, high: 72, center: 63, intervals: (chord) => chord.upper.slice(0, 3) });

  const epChord = (line, chord, { gate, velocity, roll = 0 }) => {
    fitVoicing(epVoicer(chord), chord, line, line + gate).forEach((note, index) => {
      timeline.note("keys", line, {
        track: index, note, module: M.ep, velocity: human(velocity + (index === 3 ? 6 : 0), 3), gate,
        ...(roll ? { delay: Math.min(31, index * roll) } : swingDelay(line) ? { delay: swingDelay(line) } : {}),
      });
    });
  };

  const stringChord = (line, chord, { gate, velocity }) => {
    fitVoicing(stringVoicer(chord), chord, line, line + gate).slice(0, 4).forEach((note, index) => {
      timeline.note("keys", line, { track: 5 + index, note, module: M.strings, velocity: human(velocity, 2), gate });
    });
  };

  const choirVoicer = createVoicer({ low: 62, high: 84, center: 72 });
  const choirChord = (line, chord, { gate, velocity }) => {
    fitVoicing(choirVoicer(chord), chord, line, line + gate).slice(0, 4).forEach((note, index) => {
      timeline.note("lead", line, { track: 7 + index, note, module: M.choir, velocity: human(velocity, 2), gate });
    });
  };

  const brassStab = (line, chord, { gate = 1, velocity = 100 }) => {
    fitVoicing(brassVoicer(chord), chord, line, line + gate).slice(0, 4).forEach((note, index) => {
      timeline.note("lead", line, {
        track: 2 + index, note, module: M.brass, velocity: human(velocity, 3), gate,
        ...(swingDelay(line) ? { delay: swingDelay(line) } : {}),
      });
    });
  };

  const COMP_SECTIONS = ["intro", "inter", "verse", "outro"];
  const canPush = (bar) =>
    bar >= 4 && bar + 1 < 54 && COMP_SECTIONS.includes(sectionOf(bar)) && sectionOf(bar + 1) === sectionOf(bar) &&
    !KIMES.has(bar) && !KIMES.has(bar + 1) && chordsInBar(bar).length === 1 && chordsInBar(bar + 1).length === 1;

  for (let bar = 0; bar < TOTAL_BARS; bar += 1) {
    const section = sectionOf(bar);
    const base = bar * LPB;
    const entries = chordsInBar(bar);
    const nextEntries = bar + 1 < TOTAL_BARS ? chordsInBar(bar + 1) : undefined;
    const sameSectionNext = nextEntries && sectionOf(bar + 1) === section;
    const kime = KIMES.has(bar);

    // Electric piano
    if (section === "intro" && bar < 4) {
      epChord(base, entries[0].chord, { gate: 16, velocity: 74, roll: 5 });
    } else if (kime) {
      for (const offset of [0, 3, 6]) epChord(base + offset, chordAt(base + offset), { gate: 2, velocity: 104 });
    } else if (COMP_SECTIONS.includes(section) && bar < 54) {
      const pushed = canPush(bar - 1);
      for (const entry of entries) {
        const hits = entry.length === 16 ? [[0, 3], [6, 2], [10, 3]] : [[0, 3], [3, 2]];
        for (const [offset, gate] of hits) {
          if (offset === 0 && entry.start === 0 && pushed) continue;
          epChord(base + entry.start + offset, entry.chord, { gate, velocity: section === "verse" ? 86 : 96 });
        }
      }
      if (canPush(bar)) {
        epChord(base + 14, nextEntries[0].chord, { gate: 4, velocity: section === "verse" ? 90 : 100 });
      }
    } else if (["chorus", "final", "pre"].includes(section)) {
      for (const entry of entries) {
        epChord(base + entry.start, entry.chord, { gate: entry.length === 16 ? 6 : 5, velocity: 92 });
        if (entry.length === 16) epChord(base + 8, entry.chord, { gate: 5, velocity: 84 });
      }
    } else if (section === "bridge" && !kime) {
      for (const entry of entries) {
        const voicing = fitVoicing(epVoicer(entry.chord), entry.chord, base + entry.start, base + entry.start + entry.length);
        while (voicing.length < 4) voicing.push(voicing.at(-1) + 12);
        const arp = [voicing[0], voicing[1], voicing[2], voicing[3], voicing[0] + 12, voicing[3], voicing[2], voicing[1]];
        for (let step = 0; step < entry.length / 2; step += 1) {
          const line = base + entry.start + step * 2;
          const [note] = fitVoicing([arp[step]], entry.chord, line, line + 6);
          if (note === undefined) continue;
          timeline.note("keys", line, { track: step % 5, note, module: M.ep, velocity: human(step % 4 === 0 ? 84 : 70, 4), gate: 6 });
        }
      }
    } else if (section === "build") {
      for (const entry of entries) epChord(base + entry.start, entry.chord, { gate: entry.length, velocity: 88 + (bar - 40) * 12 });
    } else if (bar === 54) {
      epChord(base, entries[0].chord, { gate: 30, velocity: 96, roll: 7 });
    }

    // Strings
    const stringVelocity = { intro: 58, pre: 80, chorus: 86, bridge: 70, build: 78 + (bar - 40) * 16, final: 92, outro: 84 }[section];
    if (stringVelocity && !kime && !(section === "intro" && bar >= 4) && !(section === "outro" && bar !== 54)) {
      for (const entry of entries) stringChord(base + entry.start, entry.chord, { gate: bar === 54 ? 32 : entry.length, velocity: stringVelocity });
    }
    if (section === "verse" && bar >= 12) {
      stringChord(base, entries[0].chord, { gate: 16, velocity: 54 });
    }

    // "Aah" choir layer
    const choirVelocity = { chorus: 84, final: 96, bridge: 72 }[section];
    if (choirVelocity && !kime) {
      for (const entry of entries) choirChord(base + entry.start, entry.chord, { gate: entry.length, velocity: choirVelocity });
    }
    if (bar === 54) choirChord(base, entries[0].chord, { gate: 32, velocity: 90 });

    // Brass stabs and kime hits
    if (kime) {
      for (const offset of [0, 3, 6]) brassStab(base + offset, chordAt(base + offset), { gate: 2, velocity: 118 });
    } else if (section === "chorus" || section === "final") {
      if (bar % 2 === 1) brassStab(base + 6, entries[0].chord, { gate: 1, velocity: 96 });
      if (sameSectionNext && bar % 2 === 1) brassStab(base + 14, nextEntries[0].chord, { gate: 2, velocity: 108 });
      if (bar === 20 || bar === 42) brassStab(base, entries[0].chord, { gate: 3, velocity: 116 });
    }

    // Guitar cutting
    if (["verse", "chorus", "final"].includes(section) && !kime) {
      const voicings = entries.map((entry) => fitVoicing(guitarVoicer(entry.chord), entry.chord, base + entry.start, base + entry.start + entry.length));
      for (let step = 0; step < 16; step += 1) {
        const notes = voicings[entries.findLastIndex((entry) => entry.start <= step)];
        const accent = step === 4 || step === 12;
        if (!accent && ![0, 2, 3, 6, 7, 9, 10, 11, 14, 15].includes(step)) continue;
        const module = accent ? M.cutOpen : M.cutMute;
        notes.forEach((note, index) => {
          timeline.note("keys", base + step, {
            track: 9 + index, note: note + 12, module, velocity: human(accent ? 104 : step % 2 ? 46 : 64, 6),
            gate: accent ? 2 : 1, delay: Math.min(31, swingDelay(base + step) + index * 2) || undefined,
          });
        });
      }
    }
  }

  // --- Bass -----------------------------------------------------------------
  let previousRoot;
  for (let bar = 0; bar < TOTAL_BARS; bar += 1) {
    const section = sectionOf(bar);
    const base = bar * LPB;
    const entries = chordsInBar(bar);
    const nextChord = bar + 1 < TOTAL_BARS ? chordsInBar(bar + 1)[0].chord : undefined;
    const play = (offset, note, gate, velocity, track = 0) =>
      timeline.note("bass", base + offset, { track, note, module: M.bass, velocity: human(velocity, 4), gate, delay: swingDelay(offset) || undefined });
    if ((section === "intro" && bar < 4) || bar >= 55) continue;
    if (KIMES.has(bar)) {
      const root = bassRoot(entries[0].chord, previousRoot);
      for (const offset of [0, 3, 6]) play(offset, root, 2, 120);
      if (bar !== 39) {
        // Unison break: the bass doubles the lead's pickup run.
        const run = MELODY_NOTES.filter((entry) => entry.line >= base + 12 && entry.line < base + 16);
        for (const [index, entry] of run.entries()) {
          let note = entry.note;
          while (note > 46) note -= 12;
          play(entry.line - base, note, 1, 100 + index * 4, index % 2);
        }
      }
      previousRoot = root;
      continue;
    }
    if (bar === 54) {
      const root = bassRoot(entries[0].chord, previousRoot);
      play(0, root, 28, 112);
      continue;
    }
    for (const entry of entries) {
      const root = bassRoot(entry.chord, previousRoot);
      previousRoot = root;
      const seventh = root + entry.chord.tones[3];
      const fifth = root + 7;
      const s = entry.start;
      const isLast = s + entry.length === 16;
      let approach = fifth;
      if (nextChord && isLast) {
        // Chromatic approach into the next root, avoiding a b9 under the melody.
        const target = bassRoot(nextChord, root);
        const near = rng() < 0.5 ? [target - 1, target + 1] : [target + 1, target - 1];
        const melodyPcs = [...MELODY_NOTES]
          .filter((entry) => entry.line < base + 16 && entry.line + entry.length > base + 14)
          .map((entry) => ((entry.note % 12) + 12) % 12);
        approach = [...near, target - 5, target + 2].find((candidate) => !melodyPcs.some((m) => (m - candidate + 120) % 12 === 1)) ?? target;
      }
      if (["chorus", "final", "inter", "outro"].includes(section) || (section === "intro" && bar >= 4)) {
        for (let step = 0; step < entry.length; step += 2) {
          play(s + step, step % 4 === 2 ? root + 12 : root, 1, step % 4 === 0 ? 118 : 100, (step / 2) % 2);
        }
        if (isLast && bar % 2 === 1) play(15, approach, 1, 96, 1);
      } else if (section === "verse") {
        if (entry.length === 16) {
          play(0, root, 2, 118);
          play(3, root, 1, 82, 1);
          play(4, root + 12, 1, 104);
          play(6, root, 2, 100, 1);
          play(8, fifth, 2, 104);
          play(10, root + 12, 1, 110, 1);
          play(11, seventh, 1, 90);
          play(12, fifth, 1, 96, 1);
          play(14, approach, 2, 100);
        } else {
          play(s, root, 2, 116);
          play(s + 3, root, 1, 80, 1);
          play(s + 4, root + 12, 1, 104);
          play(s + 6, isLast ? approach : fifth, 2, 98, 1);
        }
      } else if (section === "pre") {
        for (let step = 0; step < entry.length; step += 2) {
          play(s + step, step === 6 || step === 14 ? root + 12 : root, 2, step % 4 === 0 ? 116 : 98, (step / 2) % 2);
        }
      } else if (section === "bridge") {
        play(s, root, entry.length === 16 ? 10 : 6, 104);
        if (entry.length === 16) play(10, fifth, 4, 92, 1);
        if (isLast) play(14, approach, 2, 96, 1);
      } else if (section === "build") {
        for (let step = 0; step < entry.length; step += 1) {
          if (bar === 40 && step % 2) continue;
          play(s + step, step % 4 === 2 ? root + 12 : root, 1, 96 + step * 1.5, step % 2);
        }
      }
    }
  }

  // --- Drums ----------------------------------------------------------------
  const hit = (line, track, module, note, velocity, delay) =>
    timeline.note("drums", line, { track, note, module, velocity: human(velocity, 5), delay: delay ?? (swingDelay(line) || undefined) });
  const kick = (line, velocity) => hit(line, 0, M.kick, "C5", velocity, 0);
  const snare = (line, velocity) => hit(line, 1, M.snare, "C5", velocity, 0);
  const ghost = (line, velocity) => hit(line, 1, M.snare, "D5", velocity);
  const clap = (line, velocity) => hit(line, 2, M.clap, "C5", velocity, 0);
  const closedHat = (line, velocity) => hit(line, 3, M.hats, "C5", velocity);
  const openHat = (line, velocity) => hit(line, 3, M.hats, "D5", velocity);
  const pedalHat = (line, velocity) => hit(line, 3, M.hats, "E5", velocity);
  const shaker = (line, velocity) => hit(line, 4, M.perc, line % 2 ? "D5" : "C5", velocity);
  const tamb = (line, velocity) => hit(line, 5, M.perc, "E5", velocity, 0);
  const snap = (line, velocity) => hit(line, 5, M.perc, "F5", velocity, 0);
  const tom = (line, note, velocity) => hit(line, 6, M.toms, note, velocity, 0);
  const crash = (line, velocity = 104) => hit(line, 7, M.cymbals, "C5", velocity, 0);
  const reverseCymbal = (line, velocity = 100) => hit(line, 7, M.cymbals, "D5", velocity, 0);

  const tomFill = (base, from = 8) => {
    const fill = [[8, "C5", 100, "snare"], [10, "D5", 104], [11, "D5", 96], [12, "A4", 106], [13, "A4", 98], [14, "E4", 112], [15, "E4", 104]];
    for (const [offset, note, velocity, kind] of fill) {
      if (offset < from) continue;
      if (kind === "snare") snare(base + offset, velocity);
      else tom(base + offset, note, velocity);
    }
  };

  for (let bar = 0; bar < TOTAL_BARS; bar += 1) {
    const section = sectionOf(bar);
    const base = bar * LPB;
    if (KIMES.has(bar)) {
      for (const offset of [0, 3, 6]) {
        kick(base + offset, 124);
        if (offset) snare(base + offset, 116);
        clap(base + offset, 100);
      }
      crash(base, 112);
      if (bar === 39) {
        crash(base + 6, 100);
      } else if (bar === 53) {
        tomFill(base, 8);
      } else {
        tomFill(base, 8);
      }
      continue;
    }
    if (section === "intro" && bar < 4) {
      if (bar === 3) reverseCymbal(base, 96);
      continue;
    }
    const disco = ["chorus", "final", "inter", "outro"].includes(section) || (section === "intro" && bar >= 4);
    if (bar >= 54) {
      if (bar === 54) {
        kick(base, 120);
        crash(base, 110);
      }
      continue;
    }
    if (disco) {
      for (const offset of [0, 4, 8, 12]) kick(base + offset, offset === 0 ? 122 : 114);
      for (const offset of [4, 12]) {
        snare(base + offset, 112);
        clap(base + offset, 96);
      }
      for (let step = 0; step < 16; step += 1) {
        if (step % 4 === 2) openHat(base + step, 82);
        else closedHat(base + step, step % 2 ? 54 : 78);
      }
      if (section === "chorus" || section === "final") {
        for (let step = 0; step < 16; step += 1) shaker(base + step, step % 2 ? 46 : 64);
        tamb(base + 4, 76);
        tamb(base + 12, 82);
      }
      ghost(base + 7, 30);
      ghost(base + 15, 34);
      const sectionStart = SECTIONS.find((entry) => entry.key === section).start;
      if (bar === sectionStart || (bar - sectionStart) % 4 === 0) crash(base, bar === sectionStart ? 112 : 96);
      if ((bar === 27 || bar === 49) && !KIMES.has(bar)) tomFill(base, 12);
    } else if (section === "verse") {
      kick(base, 118);
      kick(base + 6, 94);
      kick(base + 8, 110);
      if (bar % 2 === 1) kick(base + 11, 88);
      snare(base + 4, 108);
      snare(base + 12, 110);
      ghost(base + 7, 32);
      ghost(base + 10, 26);
      if (bar !== 15) ghost(base + 15, 36);
      for (let step = 0; step < 16; step += 1) {
        if (step === 14 && bar % 2 === 1) openHat(base + step, 72);
        else closedHat(base + step, step % 2 ? 46 : step % 4 === 0 ? 80 : 70);
      }
      if (bar >= 12) for (let step = 0; step < 16; step += 2) shaker(base + step + 1, 40);
      if (bar === 8) crash(base, 104);
      if (bar === 15) {
        snare(base + 14, 90);
        snare(base + 15, 100);
      }
    } else if (section === "pre") {
      for (const offset of [0, 4, 8, 12]) kick(base + offset, 112);
      snare(base + 4, 108);
      if (bar !== 19) snare(base + 12, 110);
      for (let step = 0; step < 14; step += 2) closedHat(base + step, step % 4 === 0 ? 82 : 66);
      openHat(base + 14, 76);
      if (bar === 16) crash(base, 100);
      if (bar === 19) {
        for (let step = 8; step < 16; step += 1) snare(base + step, 70 + (step - 8) * 6);
        reverseCymbal(base, 100);
      }
    } else if (section === "bridge") {
      kick(base, 108);
      if (bar % 2 === 1) kick(base + 10, 84);
      snare(base + 8, 92);
      snap(base + 4, 70);
      snap(base + 12, 74);
      for (let step = 0; step < 16; step += 2) {
        if (step === 4 || step === 12) pedalHat(base + step, 52);
        else closedHat(base + step, step % 4 === 0 ? 60 : 46);
      }
      if (bar === 32) crash(base, 84);
    } else if (section === "build") {
      for (const offset of [0, 4, 8, 12]) kick(base + offset, 104 + (bar - 40) * 10);
      const step = bar === 40 ? 2 : 1;
      for (let offset = 0; offset < 16; offset += step) {
        snare(base + offset, 60 + ((bar - 40) * 16 + offset) * 2);
      }
      if (bar === 41) {
        reverseCymbal(base, 104);
        tom(base + 12, "D5", 110);
        tom(base + 13, "A4", 112);
        tom(base + 14, "E4", 116);
        tom(base + 15, "E4", 120);
      }
    }
  }

  // --- Ambience and automation ----------------------------------------------
  timeline.note("fx", 0, { track: 0, note: "C5", module: M.ambience, velocity: 104 });
  for (let beat = 0; beat < 14; beat += 1) {
    const level = beat < 6 ? 46 + beat * 9 : 100 - (beat - 6) * 9;
    timeline.note("fx", beat * 4, { track: 1, note: beat % 2 ? "C#5" : "D5", module: M.ambience, velocity: level });
  }
  // Outro: the crossing rings again and a last train passes under the final chord.
  for (let beat = 0; beat < 10; beat += 1) {
    timeline.note("fx", 54 * LPB + 4 + beat * 4, { track: 1, note: beat % 2 ? "C#5" : "D5", module: M.ambience, velocity: 34 + beat * 5 });
  }
  timeline.note("fx", 54 * LPB, { track: 0, note: "C5", module: M.ambience, velocity: 88 });

  // Electric piano filter opens through the dream intro.
  for (let step = 0; step <= 16; step += 1) {
    const hz = 900 * (14000 / 900) ** (step / 16);
    timeline.ctl("fx", step * 4, { track: 2, module: M.epFilter, controller: "freq", value: (hz / 14000) * 0x8000 });
  }
  // Choir vowel: "a" for choruses, toward "o" for the bridge.
  for (const [bar, position] of [[20, 0], [32, 40], [42, 0], [54, 30]]) {
    timeline.ctl("fx", bar * LPB, { track: 5, module: M.choirFormant, controller: "vowelPosition", value: (position / 256) * 0x8000 });
  }
  // Lead brightness per section.
  for (const [bar, hz] of [[4, 7600], [8, 4300], [16, 5600], [20, 8200], [28, 7800], [40, 6800], [42, 9200], [50, 8400]]) {
    timeline.ctl("fx", bar * LPB, { track: 3, module: M.lead, controller: "filterFreq", value: (hz / 14000) * 0x8000 });
  }
  // Ritardando into the final chord.
  for (const [line, bpm] of [[53 * LPB + 8, 110], [53 * LPB + 12, 103], [54 * LPB, 96]]) {
    timeline.effect("fx", line, { track: 4, effect: "setBpm", parameter: { bpm } });
  }
}

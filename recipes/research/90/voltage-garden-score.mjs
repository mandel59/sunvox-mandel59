// @ts-check
// Score for "Voltage Garden" (#90): a one-minute D Dorian loop at 128 BPM.
// 32 bars = 512 lines = exactly 60 s; bar 31 turns around (A7) into bar 0.
// One line is a 16th note.

import { createRng } from "../../../tools/sample-synth.mjs";
import { noteNumber } from "../../../tools/sunvox-song-builder.mjs";

export const BPM = 128;
export const LPB = 16;
export const TOTAL_BARS = 32;
export const TOTAL_LINES = TOTAL_BARS * LPB;

export const SECTIONS = Object.freeze([
  { key: "a", name: "A Pulse", start: 0, bars: 8 },
  { key: "b", name: "B Bass", start: 8, bars: 8 },
  { key: "c", name: "C Lead", start: 16, bars: 8 },
  { key: "d", name: "D Turnaround", start: 24, bars: 8 },
]);

// ---------------------------------------------------------------------------
// Harmony: two bars per chord.

const LOOP = ["Dm9", "Bbmaj9", "Fmaj9", "C69"];
const TURN = ["Gm9", "Bbmaj9", "A7sus4", "A7"];
const CHART = [...LOOP, ...LOOP, ...LOOP, ...TURN];

const QUALITIES = {
  m9: { tones: [0, 3, 7, 10, 14], pad: [3, 7, 10, 14] },
  maj9: { tones: [0, 4, 7, 11, 14], pad: [4, 7, 11, 14] },
  69: { tones: [0, 4, 7, 9, 14], pad: [4, 9, 14, 19] },
  "7sus4": { tones: [0, 5, 7, 10, 14], pad: [5, 10, 14, 19] },
  7: { tones: [0, 4, 7, 10, 14], pad: [4, 10, 14, 19] },
};

function parseChord(symbol) {
  const match = /^([A-G][b#]?)(m9|maj9|69|7sus4|7)$/u.exec(symbol);
  if (!match) throw new Error(`Unsupported chord: ${symbol}`);
  return { symbol, rootPc: noteNumber(`${match[1]}4`) % 12, ...QUALITIES[match[2]] };
}

export const chordAtBar = (bar) => parseChord(CHART[Math.floor((bar % TOTAL_BARS) / 2)]);

const pcOf = (note) => ((note % 12) + 12) % 12;

/** Ascending chord-tone pool within [low, high]. */
function tonePool(chord, low, high) {
  const pcs = new Set(chord.tones.map((tone) => (chord.rootPc + tone) % 12));
  const pool = [];
  for (let note = low; note <= high; note += 1) if (pcs.has(pcOf(note))) pool.push(note);
  return pool;
}

/** Pad voicing nearest the previous one: the pad pitch classes stacked upward from each base. */
function createPadVoicer(low, high) {
  let previous;
  return (chord) => {
    let best;
    let bestCost = Infinity;
    for (let base = low; base < low + 12; base += 1) {
      const notes = [];
      for (const interval of chord.pad) {
        let note = Math.max(base, (notes.at(-1) ?? base - 1) + 1);
        while (pcOf(note) !== (chord.rootPc + interval) % 12) note += 1;
        notes.push(note);
      }
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
// Lead (section C) and the turnaround call, "Note:16ths" tokens.

const LEAD_C = [
  "D5:3 F5:3 A5:4 G5:2 F5:2 E5:2",
  "D5:10 -:2 C5:2 D5:2",
  "F5:3 A5:3 C6:4 Bb5:2 A5:2 F5:2",
  "D5:10 -:2 E5:2 F5:2",
  "G5:3 A5:3 C6:4 E6:2 D6:2 C6:2",
  "A5:10 -:2 G5:2 A5:2",
  "G5:3 E5:3 D5:4 C5:2 D5:2 E5:2",
  "D5:12 -:4",
];

const LEAD_TURN = [
  "-:16",
  "-:16",
  "E5:4 C#5:4 A4:8",
  "C#5:6 D5:2 E5:4 G5:4",
];

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

// ---------------------------------------------------------------------------
// Macro "voltage" keyframes (bar, 0..1). Bar 32 equals bar 0 so the loop is seamless.

const MACRO = [[0, 0.3], [8, 0.45], [16, 0.72], [23.5, 0.92], [24, 0.12], [28, 0.14], [32, 0.3]];

export function macroAt(bar) {
  for (let index = 1; index < MACRO.length; index += 1) {
    const [b0, v0] = MACRO[index - 1];
    const [b1, v1] = MACRO[index];
    if (bar <= b1) return v0 + ((v1 - v0) * (bar - b0)) / (b1 - b0);
  }
  return MACRO.at(-1)[1];
}

// ---------------------------------------------------------------------------

// Turing-machine style 16-step index pattern into the chord-tone pool.
const SEQ_STEPS = [0, 2, 4, 2, 5, 3, 1, 3, 0, 2, 4, 6, 5, 3, 2, 1];
const SEQ_MUTATED = { 6: 7, 11: 8, 15: 4 };

const BASS_A = [[0, 0], [2, 0], [4, 12], [6, 0], [8, 0], [10, 0], [12, 12], [14, 7]];
const BASS_B = [[0, 0], [3, 0], [4, 12], [6, 0], [8, 0], [10, 7], [11, 12], [14, 0]];
const BASS_ROOT = { 2: 26, 10: 22, 5: 29, 0: 24, 7: 19, 9: 21 };

const PLUCK_SCALE = ["D5", "F5", "G5", "A5", "C6", "D6", "F6"].map(noteNumber);

/** Euclidean rhythm: `hits` onsets spread over `steps`, rotated. */
function euclid(hits, steps, rotate = 0) {
  const pattern = [];
  for (let step = 0; step < steps; step += 1) pattern.push(((step + rotate) * hits) % steps < hits);
  return pattern;
}

export function arrange(timeline, M) {
  const rng = createRng(90);
  const human = (velocity, spread = 4) => Math.max(1, Math.min(128, Math.round(velocity + (rng() * 2 - 1) * spread)));
  const sectionOf = (bar) => SECTIONS.find((section) => bar >= section.start && bar < section.start + section.bars).key;

  // --- Modulation resets and the macro ---------------------------------------
  // LFO phases are reset on line 0 so every pass of the loop is identical.
  for (const [index, lfo] of [M.seqLfo, M.hatVca, M.leadWobble, M.pluckRandom].entries()) {
    timeline.ctl("mod", 0, { track: index, module: lfo, controller: "setPhase", value: 0 });
  }
  for (let line = 0; line < TOTAL_LINES; line += 2) {
    timeline.ctl("mod", line, { track: 4, module: M.macro, controller: "value", value: macroAt(line / LPB) * 0x8000 });
  }
  // Riser: pink noise opening through a band-pass over bars 28-31, closed at the loop point.
  for (let line = 28 * LPB; line < TOTAL_LINES; line += 2) {
    const t = (line - 28 * LPB) / (4 * LPB);
    timeline.ctl("mod", line, { track: 5, module: M.riserVcf, controller: "freq", value: ((400 + 7600 * t * t) / 14000) * 0x8000 });
  }
  timeline.note("mod", 28 * LPB, { track: 6, note: "C5", module: M.riser, velocity: 40, gate: 4 * LPB - 1 });
  for (let bar = 28; bar < 32; bar += 1) {
    timeline.ctl("mod", bar * LPB + 1, { track: 7, module: M.riser, controller: "volume", value: ((60 + 40 * (bar - 28)) / 256) * 0x8000 });
  }

  // --- Drums -----------------------------------------------------------------
  for (let bar = 0; bar < TOTAL_BARS; bar += 1) {
    const section = sectionOf(bar);
    const base = bar * LPB;
    const breakdown = bar >= 24 && bar < 28;
    if (!breakdown) {
      const beats = bar === 31 ? [0, 4, 8] : [0, 4, 8, 12];
      for (const line of beats) timeline.note("drums", base + line, { track: 0, note: "C3", module: M.kick, velocity: human(120, 3) });
    }
    if (bar === 27) timeline.note("drums", base + 14, { track: 0, note: "C3", module: M.kick, velocity: 96 });
    const backbeat = section === "b" || section === "c" || bar >= 28;
    if (backbeat) {
      for (const line of [4, 12]) {
        if (bar === 31 && line === 12) continue;
        timeline.note("drums", base + line, { track: 1, note: "C5", module: M.snareNoise, velocity: human(112, 4) });
        timeline.note("drums", base + line, { track: 2, note: "G3", module: M.snareBody, velocity: human(104, 4) });
      }
    }
    if (bar === 7 || bar === 15 || bar === 23) {
      timeline.note("drums", base + 14, { track: 1, note: "C5", module: M.snareNoise, velocity: 70 });
      timeline.note("drums", base + 15, { track: 3, note: "C5", module: M.snareNoise, velocity: 86 });
    }
    if (bar === 31) {
      // Snare roll on beat 4 into the loop point.
      [12, 13, 14, 15].forEach((line, index) => {
        timeline.note("drums", base + line, { track: 1, note: "C5", module: M.snareNoise, velocity: 70 + index * 14 });
        timeline.note("drums", base + line, { track: 2, note: ["G3", "A3", "B3", "D4"][index], module: M.snareBody, velocity: 70 + index * 12 });
      });
    }
    // Hats: the 12-line LFO VCA after the hats gives a 3-against-4 accent cycle.
    for (let step = 0; step < LPB; step += 1) {
      const offbeat = step % 4 === 2;
      let play;
      if (section === "a") play = offbeat || (bar >= 4 && step % 2 === 1 && rng() < 0.35);
      else if (breakdown) play = step % 2 === 0 && !(step % 4 === 0);
      else play = true;
      if (!play) continue;
      const open = (section === "c" || bar >= 28) && offbeat && step === 14;
      timeline.note("drums", base + step, {
        track: 4, note: "C5", module: open ? M.openHat : M.hat,
        velocity: human(offbeat ? 110 : step % 2 ? 72 : 88, 6),
      });
    }
  }

  // --- Sequencer -------------------------------------------------------------
  for (let bar = 0; bar < TOTAL_BARS; bar += 1) {
    const chord = chordAtBar(bar);
    const pool = tonePool(chord, 38, 64);
    const mutate = sectionOf(bar) === "c" && bar % 2 === 1;
    for (let step = 0; step < LPB; step += 1) {
      const index = mutate && SEQ_MUTATED[step] !== undefined ? SEQ_MUTATED[step] : SEQ_STEPS[step];
      const note = pool[Math.min(index, pool.length - 1)];
      // Three-step accent cycle against the 16-step bar.
      const accent = (bar * LPB + step) % 3 === 0;
      timeline.note("seq", bar * LPB + step, { track: 0, note, module: M.seqIn, velocity: human(accent ? 118 : 86, 3) });
    }
  }
  timeline.off("seq", TOTAL_LINES - 1, { track: 0, module: M.seqIn });

  // --- Bass ------------------------------------------------------------------
  for (let bar = 0; bar < TOTAL_BARS; bar += 1) {
    const chord = chordAtBar(bar);
    const root = BASS_ROOT[chord.rootPc];
    const section = sectionOf(bar);
    const base = bar * LPB;
    if (bar >= 24 && bar < 28) {
      // Breakdown: one long low root per chord, the envelope barely opening.
      if (bar % 2 === 0) timeline.note("bass", base, { track: 0, note: root, module: M.bassIn, velocity: 90, gate: 2 * LPB - 2 });
      continue;
    }
    const pattern = section === "a" ? BASS_A : BASS_B;
    pattern.forEach(([line, interval], index) => {
      const next = pattern[index + 1]?.[0] ?? LPB;
      timeline.note("bass", base + line, {
        track: 0, note: root + interval, module: M.bassIn,
        velocity: human(line % 4 === 0 ? 112 : 96, 4), gate: Math.min(2, next - line),
      });
    });
  }

  // --- Pad -------------------------------------------------------------------
  const padVoicer = createPadVoicer(48, 72);
  for (let bar = 0; bar < TOTAL_BARS; bar += 2) {
    const chord = chordAtBar(bar);
    const voicing = padVoicer(chord);
    const velocity = sectionOf(bar) === "a" ? 78 : bar >= 24 && bar < 28 ? 100 : 88;
    voicing.forEach((note, index) => {
      timeline.note("chords", bar * LPB, { track: index, note, module: M.pad, velocity: human(velocity, 2), gate: 2 * LPB - 1 });
    });
  }

  // --- Plucks (S&H band-pass "bongos") -----------------------------------------
  for (let bar = 8; bar < TOTAL_BARS; bar += 1) {
    const chord = chordAtBar(bar);
    const pcs = new Set(chord.tones.map((tone) => (chord.rootPc + tone) % 12));
    const rhythm = euclid(bar >= 24 && bar < 28 ? 7 : 5, LPB, bar % 3);
    rhythm.forEach((hit, step) => {
      if (!hit) return;
      const options = PLUCK_SCALE.filter((note) => pcs.has(pcOf(note)));
      const note = options[Math.floor(rng() * options.length)];
      timeline.note("chords", bar * LPB + step, { track: 4 + (step % 2), note, module: M.pluck, velocity: human(96, 10) });
    });
  }

  // --- FM lead ---------------------------------------------------------------
  const lead = [...parseLine(LEAD_C, 16), ...parseLine(LEAD_TURN, 28)];
  lead.forEach((entry, index) => {
    const next = lead[index + 1];
    const legato = next && next.line === entry.line + entry.length;
    timeline.note("lead", entry.line, {
      track: 0, note: entry.note, module: M.leadIn, velocity: human(entry.length >= 8 ? 108 : 100, 3),
      gate: legato ? undefined : entry.length - (entry.length > 4 ? 1 : 0),
    });
  });
}

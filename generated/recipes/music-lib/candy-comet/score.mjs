// @ts-check
// Score for "Candy Comet" (#99): happy hardcore in F major at 176 BPM with a
// whole-tone lift to G major for the last drop. 72 bars, one line is a 16th
// note. Intro / Build / Drop 1 / Breakdown / Drop 2 / Outro, ending on a held
// G major chord that rings out.

import { createRng } from "../../../../tools/sample-synth.mjs";
import { noteNumber } from "../../../../tools/sunvox-song-builder.mjs";

export const BPM = 176;
export const LPB = 16;
export const TOTAL_BARS = 72;
export const TOTAL_LINES = TOTAL_BARS * LPB;

export const SECTIONS = Object.freeze([
  { key: "intro", name: "Intro", start: 0, bars: 8 },
  { key: "build", name: "Build", start: 8, bars: 8 },
  { key: "drop1", name: "Drop 1", start: 16, bars: 16 },
  { key: "break", name: "Breakdown", start: 32, bars: 16 },
  { key: "drop2", name: "Drop 2", start: 48, bars: 16 },
  { key: "outro", name: "Outro", start: 64, bars: 8 },
]);

// ---------------------------------------------------------------------------
// Harmony: one chord per bar, I-V-vi-IV in F, then in G after bar 48.

const HOOK_CHORDS_F = ["F", "C", "Dm", "Bb", "F", "C", "Bb", "C"];
const HOOK_CHORDS_G = ["G", "D", "Em", "C", "G", "D", "C", "D"];
const CHART = [
  ...HOOK_CHORDS_F, // intro
  ...HOOK_CHORDS_F, // build
  ...HOOK_CHORDS_F, ...HOOK_CHORDS_F, // drop 1
  "Dm", "Bb", "F", "C", "Dm", "Bb", "Gm", "C", // breakdown, piano arpeggios
  "F", "C", "Dm", "Bb", "Bb", "C", "Dsus4", "D", // breakdown, piano hook and lift to G
  ...HOOK_CHORDS_G, ...HOOK_CHORDS_G, // drop 2
  "G", "D", "Em", "C", "G", "D", "C", "G", // outro
];
if (CHART.length !== TOTAL_BARS) throw new Error(`Chart covers ${CHART.length} bars`);

const QUALITIES = {
  "": [0, 4, 7],
  m: [0, 3, 7],
  sus4: [0, 5, 7],
};

function parseChord(symbol) {
  const match = /^([A-G][b#]?)(m|sus4|)$/u.exec(symbol);
  if (!match) throw new Error(`Unsupported chord: ${symbol}`);
  return { symbol, rootPc: noteNumber(`${match[1]}4`) % 12, voicing: QUALITIES[match[2]] };
}

export const chordAtBar = (bar) => parseChord(CHART[Math.min(bar, TOTAL_BARS - 1)]);

const pcOf = (note) => ((note % 12) + 12) % 12;

/**
 * Four-note voicing nearest the previous one: any inversion of the triad,
 * stacked upward from each base, with the bottom note doubled an octave up.
 */
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
// Melodies, "Note:16ths" tokens, one string per bar (written in F major).

const HOOK_A = [
  "C5:2 C5:2 A4:2 C5:4 D5:2 C5:2 A4:2",
  "G4:2 G4:2 E4:2 G4:4 C5:6",
  "A4:2 A4:2 F4:2 A4:4 Bb4:2 A4:2 F4:2",
  "D4:2 F4:2 Bb4:2 D5:4 C5:2 Bb4:2 A4:2",
  "C5:2 C5:2 A4:2 C5:4 F5:2 E5:2 D5:2",
  "E5:4 D5:2 C5:4 G4:6",
  "D5:2 D5:2 C5:2 Bb4:4 A4:2 Bb4:2 C5:2",
  "C5:4 D5:2 E5:4 G5:6",
];

const HOOK_B = [
  ...HOOK_A.slice(0, 5),
  "G5:4 F5:2 E5:4 D5:2 C5:4",
  "D5:2 F5:2 D5:2 Bb4:4 C5:2 D5:2 E5:2",
  "E5:6 D5:2 C5:8",
];

/** Breakdown piano line: the first half of the hook, then a rising lift into G. */
const BREAK_LINE = [
  ...HOOK_A.slice(0, 4),
  "Bb4:4 D5:4 F5:8",
  "C5:4 E5:4 G5:8",
  "D5:4 G5:4 A5:8",
  "F#5:4 A5:4 D6:4 -:4",
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

// ---------------------------------------------------------------------------

// Offbeat bass roots kept between Bb1 and A2.
const BASS_ROOT = (pc) => 22 + ((pc - 10 + 12) % 12);

// Supersaw stab rhythm per bar (3+3+2 / 3+3+2): [line, gate, velocity].
const STABS = [[0, 2, 118], [3, 2, 100], [6, 2, 108], [8, 2, 114], [11, 2, 100], [14, 2, 106]];

// Kick-free snare roll velocities and densities over four bars.
const ROLL_STEP = [4, 2, 1, 1];

export function arrange(timeline, M) {
  const rng = createRng(99);
  const human = (velocity, spread = 4) => Math.max(1, Math.min(128, Math.round(velocity + (rng() * 2 - 1) * spread)));
  const sectionOf = (bar) => SECTIONS.find((section) => bar >= section.start && bar < section.start + section.bars).key;
  const isDrop = (bar) => ["drop1", "drop2"].includes(sectionOf(bar));
  const freq = (hz) => (hz / 14000) * 0x8000;

  // --- Automation and FX -----------------------------------------------------
  // Drum bus low-pass: the kick enters muffled at bar 4 and opens by bar 8.
  const drumCutoff = (bar) => (bar < 4 ? 380 : bar < 8 ? 380 * ((14000 / 380) ** ((bar - 4) / 4)) : 14000);
  // Supersaw low-pass: opens over the build, closes slightly for the outro.
  const sawCutoff = (bar) => {
    if (bar < 8) return 500;
    if (bar < 16) return 500 * (18 ** ((bar - 8) / 8));
    if (bar >= 64 && bar < 70) return 9000 * (0.5 ** ((bar - 64) / 6));
    if (bar >= 70) return 4500;
    return 9000;
  };
  for (let line = 0; line < TOTAL_LINES; line += 2) {
    const bar = line / LPB;
    const previousBar = Math.max(0, bar - 2 / LPB);
    for (const [track, module, curve] of [[0, M.drumFilter, drumCutoff], [1, M.sawFilter, sawCutoff]]) {
      const value = curve(bar);
      if (line === 0 || Math.abs(value - curve(previousBar)) > 1) {
        timeline.ctl("mod", line, { track, module, controller: "freq", value: freq(value) });
      }
    }
  }
  // Risers into each drop: band-passed pink noise sweeping up over 4 bars.
  for (const startBar of [12, 44]) {
    const length = 4 * LPB - (startBar === 44 ? 4 : 1);
    timeline.note("mod", startBar * LPB, { track: 2, note: "C5", module: M.riser, velocity: 100, gate: length });
    for (let line = startBar * LPB; line < startBar * LPB + length; line += 2) {
      const t = (line - startBar * LPB) / (4 * LPB);
      timeline.ctl("mod", line, { track: 3, module: M.riserVcf, controller: "freq", value: freq(400 + 8600 * t * t) });
    }
  }
  // Impacts on the downbeat of each drop, the outro and the final chord.
  for (const bar of [16, 48, 64, 70]) {
    timeline.note("mod", bar * LPB, { track: 4, note: "C5", module: M.crash, velocity: bar === 64 ? 90 : 116 });
    if (bar !== 64) timeline.note("mod", bar * LPB, { track: 5, note: "C2", module: M.boom, velocity: 120 });
  }

  // --- Drums -----------------------------------------------------------------
  const roll = (startBar) => {
    for (let bar = startBar; bar < startBar + 4; bar += 1) {
      const step = ROLL_STEP[bar - startBar];
      const last = bar === startBar + 3;
      for (let line = 0; line < LPB; line += step) {
        if (startBar === 44 && last && line >= 12) break;
        const t = ((bar - startBar) * LPB + line) / (4 * LPB);
        timeline.note("drums", bar * LPB + line, { track: 1, note: "C5", module: M.snareNoise, velocity: Math.round(52 + 72 * t) });
        timeline.note("drums", bar * LPB + line, { track: 2, note: 45 + Math.round(t * 12), module: M.snareBody, velocity: Math.round(48 + 70 * t) });
      }
    }
  };
  roll(12);
  roll(44);

  for (let bar = 4; bar < 71; bar += 1) {
    const section = sectionOf(bar);
    const base = bar * LPB;
    if (section === "break") continue;
    // Four-on-the-floor kick; silent under the last roll bar and after bar 70.
    const kickBeats = bar === 15 ? [0, 4, 8] : bar === 70 ? [0] : [0, 4, 8, 12];
    for (const line of kickBeats) {
      const velocity = bar < 8 ? 100 : line === 0 ? 124 : 118;
      // Kick tuned to the fifth: C in F major, D after the lift to G.
      timeline.note("drums", base + line, { track: 0, note: bar >= 48 ? "D3" : "C3", module: M.kick, velocity: human(velocity, 3) });
    }
    if (bar < 8 || bar >= 70) continue;
    // Snare + clap on 2 and 4 in the drops and the outro.
    const backbeat = isDrop(bar) || (section === "outro" && bar < 70);
    if (backbeat) {
      for (const line of [4, 12]) {
        timeline.note("drums", base + line, { track: 1, note: "C5", module: M.snareNoise, velocity: human(112, 3) });
        timeline.note("drums", base + line, { track: 2, note: "A3", module: M.snareBody, velocity: human(104, 3) });
        timeline.note("drums", base + line, { track: 3, note: "C5", module: M.clap, velocity: human(116, 3) });
      }
      // Fill on the last beat of every 8th bar.
      if (bar % 8 === 7) {
        [13, 14, 15].forEach((line, index) => {
          timeline.note("drums", base + line, { track: 1, note: "C5", module: M.snareNoise, velocity: 80 + index * 14 });
          timeline.note("drums", base + line, { track: 2, note: 47 + index * 2, module: M.snareBody, velocity: 76 + index * 14 });
        });
      }
    }
    // Offbeat open hats from the build; 16th closed hats in the drops.
    for (let step = 0; step < LPB; step += 1) {
      if (step % 4 === 2) timeline.note("drums", base + step, { track: 4, note: "C5", module: M.openHat, velocity: human(section === "build" ? 92 : 110, 4) });
      else if (isDrop(bar) || (section === "outro" && bar < 68)) {
        timeline.note("drums", base + step, { track: 5, note: "C5", module: M.closedHat, velocity: human(step % 4 === 0 ? 70 : 92, 6) });
      }
    }
  }

  // --- Offbeat bass ----------------------------------------------------------
  for (let bar = 8; bar < 70; bar += 1) {
    const section = sectionOf(bar);
    if (section === "break") continue;
    if (bar === 15 || (section === "outro" && bar >= 68)) continue;
    const root = BASS_ROOT(chordAtBar(bar).rootPc);
    for (const line of [2, 6, 10, 14]) {
      timeline.note("bass", bar * LPB + line, { track: 0, note: root, module: M.bassIn, velocity: human(line === 14 ? 104 : 116, 3), gate: 2 });
    }
  }

  // --- Supersaws -------------------------------------------------------------
  const sawVoicer = createVoicer(50, 67);
  for (let bar = 8; bar < TOTAL_BARS; bar += 1) {
    const section = sectionOf(bar);
    if (section === "break") continue;
    const voicing = sawVoicer(chordAtBar(bar));
    const base = bar * LPB;
    if (section === "build" || bar >= 70) {
      // Held chords while the filter opens; the last chord rings out.
      if (bar === 71) continue;
      const gate = bar >= 70 ? 2 * LPB - 2 : bar === 15 ? LPB - 4 : LPB;
      voicing.forEach((note, index) => {
        timeline.note("saws", base, { track: index, note, module: M.sawIn, velocity: human(bar >= 70 ? 112 : 96, 2), gate });
      });
      continue;
    }
    for (const [line, gate, velocity] of STABS) {
      voicing.forEach((note, index) => {
        timeline.note("saws", base + line, { track: index, note, module: M.sawIn, velocity: human(velocity, 3), gate });
      });
    }
  }

  // --- Lead (supersaw hook) --------------------------------------------------
  const writeLead = (notes, { octave = false, velocity = 112 } = {}) => {
    notes.forEach((entry, index) => {
      const next = notes[index + 1];
      const legato = next && next.line === entry.line + entry.length;
      const gate = legato ? entry.length : entry.length - 1;
      timeline.note("lead", entry.line, { track: 0, note: entry.note, module: M.leadIn, velocity: human(velocity, 3), gate });
      if (octave) timeline.note("lead", entry.line, { track: 1, note: entry.note + 12, module: M.leadIn, velocity: human(velocity - 30, 3), gate });
    });
  };
  writeLead([...parseLine(HOOK_A, 16), ...parseLine(HOOK_B, 24)]);
  writeLead([...parseLine(HOOK_A, 48, 2), ...parseLine(HOOK_B, 56, 2)], { octave: true });

  // --- Piano -----------------------------------------------------------------
  const pianoVoicer = createVoicer(55, 72);
  const melody = (notes, velocity, octaveUp = true) => {
    for (const entry of notes) {
      timeline.note("piano", entry.line, { track: 6, note: entry.note + 12, module: M.piano, velocity: human(velocity, 4), gate: entry.length });
      if (octaveUp) timeline.note("piano", entry.line, { track: 7, note: entry.note + 24, module: M.piano, velocity: human(velocity - 26, 4), gate: entry.length });
    }
  };
  const chordHit = (bar, line, voicing, velocity, gate, rootNote) => {
    voicing.forEach((note, index) => {
      timeline.note("piano", bar * LPB + line, { track: index, note, module: M.piano, velocity: human(velocity, 3), gate, delay: index ? index * 2 : undefined });
    });
    if (rootNote !== undefined) {
      timeline.note("piano", bar * LPB + line, { track: 4, note: rootNote, module: M.piano, velocity: human(velocity, 3), gate });
      timeline.note("piano", bar * LPB + line, { track: 5, note: rootNote + 12, module: M.piano, velocity: human(velocity - 12, 3), gate });
    }
  };
  // Intro and build: the hook in octaves over half-note chords.
  melody(parseLine(HOOK_A, 0), 104);
  melody(parseLine(HOOK_A, 8), 96);
  for (let bar = 0; bar < 16; bar += 1) {
    const chord = chordAtBar(bar);
    const voicing = pianoVoicer(chord);
    const root = 36 + chord.rootPc;
    if (bar === 15) chordHit(bar, 0, voicing, 88, 12, root);
    else for (const line of [0, 8]) chordHit(bar, line, voicing, line ? 78 : 90, 8, root);
  }
  // Drops: piano doubles the hook an octave above the lead in drop 2 only.
  melody([...parseLine(HOOK_A, 48, 2), ...parseLine(HOOK_B, 56, 2)], 86, false);
  // Breakdown: broken-chord 8ths, then the hook and the lift.
  for (let bar = 32; bar < 48; bar += 1) {
    const chord = chordAtBar(bar);
    const voicing = pianoVoicer(chord);
    const root = 36 + chord.rootPc;
    if (bar < 40) {
      const order = [0, 1, 2, 3, 2, 1, 2, 3];
      order.forEach((voice, index) => {
        timeline.note("piano", bar * LPB + index * 2, { track: voice, note: voicing[voice], module: M.piano, velocity: human(index === 0 ? 96 : 78, 5), gate: 2 });
      });
      timeline.note("piano", bar * LPB, { track: 4, note: root, module: M.piano, velocity: human(92, 3), gate: LPB });
    } else {
      chordHit(bar, 0, voicing, 84, bar === 47 ? 12 : LPB, root);
    }
  }
  melody(parseLine(BREAK_LINE, 40), 108);
  // Outro: chord stabs on the beat, a long final chord.
  for (let bar = 64; bar < 71; bar += 1) {
    const chord = chordAtBar(bar);
    const voicing = pianoVoicer(chord);
    const root = 36 + chord.rootPc;
    if (bar === 70) chordHit(bar, 0, voicing, 108, 2 * LPB - 2, root);
    else for (const line of [0, 6, 12]) chordHit(bar, line, voicing, line ? 80 : 96, 4, root);
  }

  // --- Pad (bowed saws) ------------------------------------------------------
  const padVoicer = createVoicer(48, 67);
  for (let bar = 0; bar < 48; bar += 1) {
    const section = sectionOf(bar);
    if (isDrop(bar)) continue;
    const voicing = padVoicer(chordAtBar(bar));
    const gate = bar === 47 ? LPB - 4 : LPB;
    const velocity = section === "break" ? 112 : section === "build" ? 92 : 100;
    voicing.forEach((note, index) => {
      timeline.note("pad", bar * LPB, { track: index, note, module: M.padIn, velocity: human(velocity, 2), gate });
    });
  }
}

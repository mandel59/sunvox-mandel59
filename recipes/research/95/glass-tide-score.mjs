// @ts-check
// Score for "Glass Tide" (#95): liquid drum & bass in F minor at 174 BPM.
// 72 bars, one line is a 16th note. Intro / Drop 1 / Breakdown / Drop 2 /
// Outro, ending on a held Fm9 that rings out.

import { createRng } from "../../../tools/sample-synth.mjs";
import { noteNumber } from "../../../tools/sunvox-song-builder.mjs";

export const BPM = 174;
export const LPB = 16;
export const TOTAL_BARS = 72;
export const TOTAL_LINES = TOTAL_BARS * LPB;

export const SECTIONS = Object.freeze([
  { key: "intro", name: "Intro", start: 0, bars: 16 },
  { key: "drop1", name: "Drop 1", start: 16, bars: 16 },
  { key: "break", name: "Breakdown", start: 32, bars: 16 },
  { key: "drop2", name: "Drop 2", start: 48, bars: 16 },
  { key: "outro", name: "Outro", start: 64, bars: 8 },
]);

// ---------------------------------------------------------------------------
// Harmony: two bars per chord.

const CYCLE = ["Fm9", "Dbmaj9", "Eb69", "Cm9"];
const DROP = [...CYCLE, "Fm9", "Dbmaj9", "Bbm9", "C7b9"];
const CHART = [
  ...CYCLE, "Fm9", "Dbmaj9", "Bbm9", "C7sus4", // intro
  ...DROP, // drop 1
  "Dbmaj9", "Eb69", "Cm9", "Fm9", "Dbmaj9", "Eb69", "Bbm9", "C7sus4", // breakdown
  ...DROP, // drop 2
  "Fm9", "Dbmaj9", "Eb69", "Fm9", // outro
];
if (CHART.length * 2 !== TOTAL_BARS) throw new Error(`Chart covers ${CHART.length * 2} bars`);

const QUALITIES = {
  m9: { tones: [0, 3, 7, 10, 14], voicing: [3, 7, 10, 14] },
  maj9: { tones: [0, 4, 7, 11, 14], voicing: [4, 7, 11, 14] },
  69: { tones: [0, 4, 7, 9, 14], voicing: [4, 9, 14, 19] },
  "7sus4": { tones: [0, 5, 7, 10, 14], voicing: [5, 10, 14, 19] },
  "7b9": { tones: [0, 4, 7, 10, 13], voicing: [10, 13, 16, 19] },
};

function parseChord(symbol) {
  const match = /^([A-G][b#]?)(m9|maj9|69|7sus4|7b9)$/u.exec(symbol);
  if (!match) throw new Error(`Unsupported chord: ${symbol}`);
  return { symbol, rootPc: noteNumber(`${match[1]}4`) % 12, ...QUALITIES[match[2]] };
}

export const chordAtBar = (bar) => parseChord(CHART[Math.floor(bar / 2)]);

const pcOf = (note) => ((note % 12) + 12) % 12;

/** Voicing nearest the previous one: the chord's voicing pitch classes stacked upward from each base. */
function createVoicer(low, high) {
  let previous;
  return (chord) => {
    let best;
    let bestCost = Infinity;
    for (let base = low; base < low + 12; base += 1) {
      const notes = [];
      for (const interval of chord.voicing) {
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
// Lead lines, "Note:16ths" tokens, one string per bar.

const LEAD_BREAK = [
  "F5:8 Eb5:4 C5:4",
  "Ab5:16",
  "G5:8 F5:4 Eb5:4",
  "Bb5:16",
  "Db6:8 C6:4 Ab5:4",
  "F5:16",
  "G5:8 F5:4 G5:4",
  "C6:8 -:8",
];

const LEAD_DROP = [
  "-:2 C6:4 Eb6:2 C6:4 Ab5:4",
  "G5:10 -:2 F5:2 G5:2",
  "Ab5:6 F5:2 Eb5:4 F5:4",
  "C5:12 -:4",
  "-:2 Bb5:4 C6:2 Bb5:4 G5:4",
  "F5:6 G5:2 Bb5:8",
  "G5:6 Eb5:2 D5:4 Eb5:4",
  "G5:12 -:4",
  "-:2 C6:4 Eb6:2 F6:4 Eb6:4",
  "C6:10 -:2 Ab5:2 C6:2",
  "Db6:6 C6:2 Ab5:4 F5:4",
  "Eb5:10 -:2 F5:2 Ab5:2",
  "Db6:6 C6:2 Bb5:4 Ab5:4",
  "F5:12 -:4",
  "G5:4 Bb5:4 Db6:4 E6:4",
  "C6:12 -:4",
];

const LEAD_OUTRO = [
  "-:2 C6:4 Eb6:2 C6:4 Ab5:4",
  "G5:10 -:6",
  "Ab5:6 F5:2 Eb5:4 C5:4",
  "Eb5:12 -:4",
  "-:16",
  "-:16",
  "C5:4 Eb5:4 G5:8",
  "F5:14 -:2",
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

// Sub roots kept between Bb1 and F2 so the line stays in the 45-90 Hz band.
const SUB_ROOT = { 5: 17, 1: 25, 3: 27, 0: 24, 10: 22 };

// Two-bar keys cell: [line, gate, velocity], relative to the chord start.
const KEYS_CELL = [[0, 5, 100], [10, 4, 82], [22, 3, 76], [28, 4, 88]];

export function arrange(timeline, M) {
  const rng = createRng(95);
  const human = (velocity, spread = 4) => Math.max(1, Math.min(128, Math.round(velocity + (rng() * 2 - 1) * spread)));
  const sectionOf = (bar) => SECTIONS.find((section) => bar >= section.start && bar < section.start + section.bars).key;
  const isDrop = (bar) => ["drop1", "drop2"].includes(sectionOf(bar));
  const freq = (hz) => (hz / 14000) * 0x8000;

  // --- Modulation ------------------------------------------------------------
  timeline.ctl("mod", 0, { track: 0, module: M.reeseLfo, controller: "setPhase", value: 0 });
  // Drum bus low-pass: closed in the intro, opening over bars 8-16; muffled in the breakdown.
  const drumCutoff = (bar) => {
    if (bar < 8) return 500;
    if (bar < 16) return 500 * (28 ** ((bar - 8) / 8));
    if (bar >= 32 && bar < 44) return 2400;
    if (bar >= 44 && bar < 48) return 2400 * (5.8 ** ((bar - 44) / 4));
    return 14000;
  };
  for (let line = 0; line < TOTAL_LINES; line += 2) {
    const bar = line / LPB;
    const previous = drumCutoff(Math.max(0, bar - 2 / LPB));
    const value = drumCutoff(bar);
    if (line === 0 || Math.abs(value - previous) > 1) {
      timeline.ctl("mod", line, { track: 1, module: M.drumFilter, controller: "freq", value: freq(value) });
    }
  }
  // Risers into each drop: band-passed pink noise sweeping up over 4 bars.
  for (const startBar of [12, 44]) {
    timeline.note("mod", startBar * LPB, { track: 2, note: "C5", module: M.riser, velocity: 90, gate: 4 * LPB - 1 });
    for (let line = startBar * LPB; line < (startBar + 4) * LPB; line += 2) {
      const t = (line - startBar * LPB) / (4 * LPB);
      timeline.ctl("mod", line, { track: 3, module: M.riserVcf, controller: "freq", value: freq(300 + 7700 * t * t) });
    }
  }
  // Impacts on the downbeat of each drop and the outro.
  for (const bar of [16, 48, 64]) {
    timeline.note("mod", bar * LPB, { track: 4, note: "C5", module: M.crash, velocity: 110 });
    timeline.note("mod", bar * LPB, { track: 5, note: "C2", module: M.boom, velocity: 120 });
  }

  // --- Drums -----------------------------------------------------------------
  for (let bar = 8; bar < 68; bar += 1) {
    const section = sectionOf(bar);
    const base = bar * LPB;
    const kickOn = section !== "break" && bar >= 12 || (bar >= 44 && bar < 48);
    const fill = bar === 15 || bar === 31 || bar === 47 || bar === 63;
    if (kickOn && !(bar === 47)) {
      const kicks = bar % 4 === 3 ? [0, 10, 13] : [0, 10];
      for (const line of kicks) {
        if (fill && line > 8) continue;
        timeline.note("drums", base + line, { track: 0, note: "C3", module: M.kick, velocity: human(line === 0 ? 124 : 112, 3) });
      }
    }
    // Two-step snare on beats 2 and 4, with ghost notes either side.
    const snareOn = bar >= 16 || bar >= 12 && bar < 16;
    if (snareOn && !(section === "break" && bar < 40)) {
      for (const line of [4, 12]) {
        if (fill && line === 12) continue;
        timeline.note("drums", base + line, { track: 1, note: "C5", module: M.snareNoise, velocity: human(118, 3) });
        timeline.note("drums", base + line, { track: 2, note: "A3", module: M.snareBody, velocity: human(112, 3) });
      }
      if (isDrop(bar) || section === "outro") {
        for (const line of [7, 9, 15]) {
          if (fill && line > 8) continue;
          if (line === 9 && bar % 2 === 0) continue;
          timeline.note("drums", base + line, { track: 3, note: "C5", module: M.snareNoise, velocity: human(48, 6) });
        }
      }
    }
    if (fill) {
      // Snare fill over the last half bar.
      [8, 10, 11, 12, 13, 14, 15].forEach((line, index) => {
        timeline.note("drums", base + line, { track: 1, note: "C5", module: M.snareNoise, velocity: 70 + index * 8 });
        timeline.note("drums", base + line, { track: 2, note: ["G3", "A3", "A3", "B3", "C4", "D4", "E4"][index], module: M.snareBody, velocity: 64 + index * 8 });
      });
    }
    // Hats on the off-beat 8ths, shaker on 16ths with an accent shape.
    for (let step = 0; step < LPB; step += 1) {
      const offbeat = step % 4 === 2;
      const eighth = step % 2 === 0;
      if (offbeat || (eighth && isDrop(bar))) {
        timeline.note("drums", base + step, { track: 4, note: "C5", module: M.hat, velocity: human(offbeat ? 104 : 70, 6) });
      }
      const shaker = bar >= 8 && (section !== "break" || bar >= 36);
      if (shaker && !(fill && step >= 8)) {
        const accent = [100, 52, 70, 52][step % 4];
        timeline.note("drums", base + step, { track: 5, note: "C5", module: M.shaker, velocity: human(accent, 8) });
      }
    }
  }
  // Breakdown pulse: a soft kick on every second bar to keep the floor.
  for (let bar = 32; bar < 40; bar += 2) timeline.note("drums", bar * LPB, { track: 0, note: "C3", module: M.kick, velocity: 70 });
  // Outro: last kick and snare land on bar 68.
  timeline.note("drums", 68 * LPB, { track: 0, note: "C3", module: M.kick, velocity: 118 });

  // --- Bass ------------------------------------------------------------------
  for (let bar = 16; bar < 70; bar += 1) {
    const chord = chordAtBar(bar);
    const root = SUB_ROOT[chord.rootPc];
    const section = sectionOf(bar);
    const base = bar * LPB;
    if (section === "break" && bar < 40) continue;
    if (section === "break" || bar >= 68) {
      // Long held roots, one per chord.
      if (bar % 2 === 0) timeline.note("bass", base, { track: 0, note: root, module: M.subIn, velocity: section === "break" ? 92 : 110, gate: 2 * LPB - 2 });
      continue;
    }
    if (bar % 2 === 0) {
      timeline.note("bass", base, { track: 0, note: root, module: M.subIn, velocity: human(116, 3), gate: 9 });
      timeline.note("bass", base + 10, { track: 0, note: root, module: M.subIn, velocity: human(108, 3), gate: 6 });
    } else {
      timeline.note("bass", base, { track: 0, note: root, module: M.subIn, velocity: human(112, 3), gate: 6 });
      timeline.note("bass", base + 6, { track: 0, note: root + 7, module: M.subIn, velocity: human(100, 3), gate: 3 });
      timeline.note("bass", base + 10, { track: 0, note: root + 12, module: M.subIn, velocity: human(104, 3), gate: 3 });
      timeline.note("bass", base + 13, { track: 0, note: root + 10, module: M.subIn, velocity: human(96, 3), gate: 3 });
    }
    // Reese layer one octave up, on the drops only: one long note per chord.
    if (isDrop(bar) && bar % 2 === 0) {
      timeline.note("bass", base, { track: 1, note: root + 12, module: M.reeseIn, velocity: 100, gate: 2 * LPB - 1 });
    }
  }

  // --- Pad (bowed FMX saws) --------------------------------------------------
  const padVoicer = createVoicer(50, 74);
  for (let bar = 0; bar < TOTAL_BARS; bar += 2) {
    const chord = chordAtBar(bar);
    const voicing = padVoicer(chord);
    const section = sectionOf(bar);
    const velocity = section === "break" ? 116 : isDrop(bar) ? 80 : 104;
    const gate = bar === TOTAL_BARS - 2 ? 2 * LPB - 4 : 2 * LPB - 1;
    voicing.forEach((note, index) => {
      timeline.note("pad", bar * LPB, { track: index, note, module: M.padIn, velocity: human(velocity, 2), gate });
    });
    if (section === "break" || bar >= 70) {
      timeline.note("pad", bar * LPB, { track: 4, note: chord.rootPc + 36, module: M.padIn, velocity: human(velocity - 10, 2), gate });
    }
  }

  // --- Keys (FM tine piano) --------------------------------------------------
  const keysVoicer = createVoicer(53, 74);
  for (let bar = 0; bar < TOTAL_BARS; bar += 2) {
    const chord = chordAtBar(bar);
    const voicing = keysVoicer(chord);
    const section = sectionOf(bar);
    const strum = (index) => 1 + index * 3;
    if (section === "intro" || section === "break" || bar >= 68) {
      // Sustained, rolled chords.
      const gate = bar >= 70 ? 2 * LPB - 4 : 2 * LPB - 2;
      voicing.forEach((note, index) => {
        timeline.note("keys", bar * LPB, { track: index, note, module: M.keys, velocity: human(section === "break" ? 92 : 100, 3), gate, delay: strum(index) });
      });
      if (section === "intro" && bar >= 8) {
        voicing.forEach((note, index) => {
          timeline.note("keys", bar * LPB + 22, { track: index, note, module: M.keys, velocity: human(70, 3), gate: 6 });
        });
      }
      continue;
    }
    for (const [line, gate, velocity] of KEYS_CELL) {
      voicing.forEach((note, index) => {
        timeline.note("keys", bar * LPB + line, { track: index, note, module: M.keys, velocity: human(velocity, 3), gate, delay: index ? strum(index) : undefined });
      });
    }
  }

  // --- Lead ------------------------------------------------------------------
  const lead = [...parseLine(LEAD_BREAK, 40), ...parseLine(LEAD_DROP, 48), ...parseLine(LEAD_OUTRO, 64)];
  lead.forEach((entry, index) => {
    const next = lead[index + 1];
    const legato = next && next.line === entry.line + entry.length;
    const quiet = entry.line < 48 * LPB;
    timeline.note("lead", entry.line, {
      track: 0, note: entry.note, module: M.leadIn, velocity: human(quiet ? 92 : entry.length >= 8 ? 112 : 104, 3),
      gate: legato ? undefined : entry.length - (entry.length > 4 ? 1 : 0),
    });
  });
}

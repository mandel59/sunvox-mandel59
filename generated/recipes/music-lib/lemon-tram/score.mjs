// @ts-check
// Score for "Lemon Tram" (#101): upbeat J-fusion in Bb major at 150 BPM on
// the Confirmation progression (コンファメ進行), a descending chain of II-V's:
//   IM7 | VIIm7b5 III7 | VIm7 Vm7 I7 | IVM7 | IVm7 bVII7 | IIIm7 VI7 | IIm7 V7 | turnaround
// 56 bars, one line is a 16th note. The melody is original.

import { createRng } from "../../../../tools/sample-synth.mjs";
import { noteNumber } from "../../../../tools/sunvox-song-builder.mjs";

export const BPM = 150;
export const LPB = 16;
export const TOTAL_BARS = 56;
export const TOTAL_LINES = TOTAL_BARS * LPB;

export const SECTIONS = Object.freeze([
  { key: "intro", name: "Intro", start: 0, bars: 4 },
  { key: "a1", name: "A1", start: 4, bars: 8 },
  { key: "a2", name: "A2", start: 12, bars: 8 },
  { key: "bridge", name: "Bridge", start: 20, bars: 8 },
  { key: "a3", name: "A3", start: 28, bars: 8 },
  { key: "solo", name: "Solo", start: 36, bars: 8 },
  { key: "a4", name: "A4", start: 44, bars: 8 },
  { key: "ending", name: "Ending", start: 52, bars: 4 },
]);

// ---------------------------------------------------------------------------
// Harmony. One string per bar; "Sym" or "Sym:beats", split evenly by default.

const A_BARS = ["BbM7", "Am7b5 D7", "Gm7:2 Fm7:1 Bb7:1", "EbM7", "Ebm7 Ab7", "Dm7 G7", "Cm7 F7"];
const TURNAROUND = "Dm7 G7 Cm7 F7";
const CHART = [
  "Ebm7 Ab7", "Dm7 G7", "Cm7 F7", TURNAROUND, // intro
  ...A_BARS, TURNAROUND, // A1
  ...A_BARS, "BbM7", // A2
  "Fm7 Bb7", "EbM7", "Abm7 Db7", "GbM7", "Cm7", "F7", "Dm7 G7", "Cm7 F7", // bridge
  ...A_BARS, TURNAROUND, // A3
  ...A_BARS, TURNAROUND, // solo
  ...A_BARS, "BbM7 G7", // A4
  "Cm7 F7", "Cm7 B7", "Bb69", "Bb69", // ending
];
if (CHART.length !== TOTAL_BARS) throw new Error(`Chart covers ${CHART.length} bars`);

// tones: chord tones for melody/solo; voicing: rootless left-hand voicing (stacked upward).
const QUALITIES = {
  M7: { tones: [0, 4, 7, 11, 14], voicing: [4, 7, 11, 14] },
  m7: { tones: [0, 3, 7, 10, 14], voicing: [3, 7, 10, 14] },
  7: { tones: [0, 4, 7, 10], voicing: [4, 9, 10, 14] },
  m7b5: { tones: [0, 3, 6, 10], voicing: [0, 3, 6, 10] },
  69: { tones: [0, 4, 7, 9, 14], voicing: [4, 7, 9, 14] },
};

function parseChord(symbol) {
  const match = /^([A-G][b#]?)(M7|m7b5|m7|7|69)$/u.exec(symbol);
  if (!match) throw new Error(`Unsupported chord: ${symbol}`);
  return { symbol, rootPc: noteNumber(`${match[1]}4`) % 12, ...QUALITIES[match[2]] };
}

/** Chord segments over the whole song: { line, length, chord }. */
export const SEGMENTS = CHART.flatMap((bar, barIndex) => {
  const tokens = bar.split(/\s+/u).map((token) => {
    const [symbol, beats] = token.split(":");
    return { chord: parseChord(symbol), beats: beats ? Number(beats) : undefined };
  });
  const free = tokens.filter((token) => token.beats === undefined);
  const fixed = tokens.reduce((sum, token) => sum + (token.beats ?? 0), 0);
  let line = barIndex * LPB;
  return tokens.map((token) => {
    const length = (token.beats ?? (4 - fixed) / free.length) * 4;
    const segment = { line, length, chord: token.chord };
    line += length;
    return segment;
  });
});

const segmentAt = (line) => SEGMENTS.findLast((segment) => segment.line <= line);

const pcOf = (note) => ((note % 12) + 12) % 12;

/** Voicing nearest the previous one, choosing among inversions of the given pitch-class order. */
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
      if (notes.at(-1) > high || notes.at(-1) - notes[0] > 12) continue;
      const mean = notes.reduce((a, b) => a + b, 0) / notes.length;
      let cost = Math.abs(mean - (low + high) / 2) * 0.35;
      if (previous) notes.forEach((note, index) => { cost += Math.abs(note - previous[index]); });
      if (cost < bestCost) {
        bestCost = cost;
        best = notes;
      }
    }
    if (!best) throw new Error(`No voicing for ${chord.symbol} in ${low}..${high}`);
    previous = best;
    return best;
  };
}

// ---------------------------------------------------------------------------
// Melodies, "Note:16ths" tokens, one string per bar.

const THEME = [
  "-:2 F5:2 D5:2 F5:2 A5:4 G5:2 F5:2",
  "G5:3 Eb5:1 C5:2 A4:2 F#5:2 A5:2 C6:3 A5:1",
  "Bb5:6 A5:2 Ab5:2 C6:2 D6:2 Ab5:2",
  "G5:8 -:2 Bb5:2 D6:2 Eb6:2",
  "Db6:3 Bb5:1 Gb5:2 Eb5:2 C6:2 Ab5:2 Gb5:2 Eb5:2",
  "F5:3 A5:1 C6:2 A5:2 B5:2 D6:2 F6:2 D6:2",
  "Eb6:6 D6:2 C6:2 A5:2 F5:2 Eb5:2",
];
const THEME_TURN = "D5:2 F5:2 B4:2 D5:2 C5:2 Eb5:2 A4:2 F4:2";
const THEME_HOME = "D5:6 C5:2 Bb4:8";
const THEME_LAST = "D5:6 C5:2 B4:4 D5:4";

const BRIDGE = [
  "C6:4 Ab5:2 F5:2 D6:4 Ab5:4",
  "G5:6 F5:2 G5:2 Bb5:2 D6:4",
  "Eb6:4 Cb6:2 Ab5:2 F6:4 Cb6:4",
  "Bb5:6 Ab5:2 Bb5:2 Db6:2 F6:4",
  "Eb6:4 D6:2 C6:2 G5:4 Bb5:4",
  "A5:6 G5:2 F5:2 Eb5:2 C5:4",
  "F5:2 A5:2 C6:2 D6:2 B5:2 G5:2 F5:2 D5:2",
  "Eb5:4 G5:4 A5:4 C6:4",
];

// Ending "kime": the whole band hits these lines in bars 52-53.
const KIME = [0, 3, 6, 10, 12];
const ENDING = ["G5:3 G5:3 Bb5:4 A5:2 C6:4", "Eb6:3 Eb6:3 G5:4 D#6:2 F#6:4"];

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

const themeAt = (startBar, last) => parseLine([...THEME, last], startBar);

/**
 * Bebop-flavoured 8th-note solo: chord tones on the beats, chromatic or
 * scale-step approach notes on the off-beats, phrases of six beats with a
 * two-beat breath, direction changes at the range limits.
 */
function soloLine(startBar, bars, rng) {
  const notes = [];
  let previous = noteNumber("F5");
  let direction = 1;
  const start = startBar * LPB;
  const end = (startBar + bars) * LPB;
  const nearestTone = (line, from, dir) => {
    const { chord } = segmentAt(line);
    for (let step = 1; step <= 6; step += 1) {
      const candidate = from + dir * step;
      if (chord.tones.some((tone) => pcOf(chord.rootPc + tone) === pcOf(candidate))) return candidate;
    }
    return from + dir * 2;
  };
  for (let beat = 0; beat < (end - start) / 4; beat += 1) {
    const line = start + beat * 4;
    const phraseBeat = beat % 8;
    if (phraseBeat >= 6 && beat < (end - start) / 4 - 2) continue;
    if (previous > noteNumber("D6")) direction = -1;
    else if (previous < noteNumber("D5")) direction = 1;
    else if (rng() < 0.22) direction = -direction;
    const target = nearestTone(line, previous, direction);
    notes.push({ line, length: 2, note: target });
    // Off-beat: approach the next beat's chord tone from a half step or a whole step.
    const next = nearestTone(line + 4, target, direction);
    const approach = next + (rng() < 0.6 ? -direction : -2 * direction);
    const last = phraseBeat === 5 || beat === (end - start) / 4 - 1;
    notes.push({ line: line + 2, length: last ? 4 : 2, note: last ? next : approach });
    previous = target;
    if (last) previous = next;
  }
  return notes;
}

// ---------------------------------------------------------------------------

// Bass roots kept between Bb1 and A2.
const bassRoot = (pc) => 22 + ((pc - 10 + 12) % 12);

export function arrange(timeline, M) {
  const rng = createRng(101);
  const human = (velocity, spread = 4) => Math.max(1, Math.min(128, Math.round(velocity + (rng() * 2 - 1) * spread)));
  const sectionOf = (bar) => SECTIONS.find((section) => bar >= section.start && bar < section.start + section.bars);
  const isA = (key) => ["a1", "a2", "a3", "solo", "a4"].includes(key);
  const kimeBar = (bar) => bar === 52 || bar === 53;
  const finalLine = 54 * LPB;

  // --- FX: crashes on section downbeats -------------------------------------
  for (const bar of [4, 12, 20, 28, 36, 44, 54]) {
    timeline.note("mod", bar * LPB, { track: 0, note: "C5", module: M.crash, velocity: bar === 4 ? 96 : 112 });
  }
  for (const line of KIME.map((l) => 52 * LPB + l).concat(KIME.map((l) => 53 * LPB + l))) {
    if (line % LPB === 0) timeline.note("mod", line, { track: 0, note: "C5", module: M.crash, velocity: 104 });
  }

  // --- Drums -----------------------------------------------------------------
  const fill = (bar, fromLine) => {
    for (let line = fromLine; line < LPB; line += 1) {
      const t = (line - fromLine) / (LPB - fromLine);
      timeline.note("drums", bar * LPB + line, { track: 1, note: "C5", module: M.snareNoise, velocity: Math.round(70 + 50 * t) });
      timeline.note("drums", bar * LPB + line, { track: 2, note: 50 + Math.round(t * 7), module: M.snareBody, velocity: Math.round(72 + 48 * t) });
    }
  };
  for (let bar = 0; bar < 52; bar += 1) {
    const section = sectionOf(bar);
    const base = bar * LPB;
    const lastOfSection = bar === section.start + section.bars - 1;
    if (section.key === "intro") {
      for (let step = 0; step < LPB; step += 2) {
        timeline.note("drums", base + step, { track: 3, note: "C5", module: M.hat, velocity: human(step % 4 === 0 ? 96 : 70, 5) });
      }
      if (bar === 3) fill(bar, 8);
      continue;
    }
    const bridge = section.key === "bridge";
    const soft = section.key === "a1";
    const kicks = bar % 2 ? [0, 6, 10, 14] : [0, 6, 10];
    for (const line of kicks) {
      if (lastOfSection && line > 8) continue;
      timeline.note("drums", base + line, { track: 0, note: "C3", module: M.kick, velocity: human(line === 0 ? 122 : 108, 3) });
    }
    for (const line of [4, 12]) {
      if (lastOfSection && line === 12) continue;
      timeline.note("drums", base + line, { track: 1, note: "C5", module: M.snareNoise, velocity: human(bridge ? 92 : 114, 3) });
      timeline.note("drums", base + line, { track: 2, note: "C4", module: M.snareBody, velocity: human(bridge ? 88 : 108, 3) });
    }
    // Ghost notes.
    for (const line of [7, 9, 15]) {
      if (lastOfSection && line > 8) continue;
      if (line === 15 && bar % 2 === 0) continue;
      timeline.note("drums", base + line, { track: 1, note: "C5", module: M.snareNoise, velocity: human(soft ? 34 : 42, 5) });
    }
    if (lastOfSection) fill(bar, 10);
    // Hats on 16ths (ride 8ths in the bridge), open hat on the "and" of 4.
    for (let step = 0; step < LPB; step += 1) {
      if (bridge) {
        if (step % 2 === 0) timeline.note("drums", base + step, { track: 4, note: "C5", module: M.ride, velocity: human(step % 4 === 0 ? 104 : 80, 5) });
        continue;
      }
      if (step === 14 && !soft) {
        if (!lastOfSection) timeline.note("drums", base + step, { track: 4, note: "C5", module: M.openHat, velocity: human(92, 4) });
        continue;
      }
      if (lastOfSection && step >= 10) continue;
      const accent = [104, 58, 78, 62][step % 4];
      timeline.note("drums", base + step, { track: 3, note: "C5", module: M.hat, velocity: human(soft ? accent - 12 : accent, 6) });
    }
  }
  // Kime and the final hit.
  for (const bar of [52, 53]) {
    for (const line of KIME) {
      timeline.note("drums", bar * LPB + line, { track: 0, note: "C3", module: M.kick, velocity: 122 });
      timeline.note("drums", bar * LPB + line, { track: 1, note: "C5", module: M.snareNoise, velocity: 116 });
      timeline.note("drums", bar * LPB + line, { track: 2, note: "C4", module: M.snareBody, velocity: 110 });
    }
  }
  fill(53, 14);
  timeline.note("drums", finalLine, { track: 0, note: "C3", module: M.kick, velocity: 124 });

  // --- Bass (FM slap with chromatic approach notes) ---------------------------
  for (const [index, segment] of SEGMENTS.entries()) {
    const bar = Math.floor(segment.line / LPB);
    if (bar >= 54) break;
    const root = bassRoot(segment.chord.rootPc);
    const next = SEGMENTS[index + 1];
    const nextRoot = next ? bassRoot(next.chord.rootPc) : root;
    const approach = nextRoot + (rng() < 0.6 ? -1 : 1);
    const put = (offset, note, velocity, gate) => {
      timeline.note("bass", segment.line + offset, { track: 0, note, module: M.bass, velocity: human(velocity, 3), gate });
    };
    if (kimeBar(bar)) {
      for (const line of KIME) {
        if (line >= segment.line % LPB && line < segment.line % LPB + segment.length) put(line - (segment.line % LPB), root, 120, 2);
      }
      continue;
    }
    if (bar < 3) {
      // Intro: held roots under the Rhodes, entering on the turnaround.
      continue;
    }
    if (sectionOf(bar).key === "bridge") {
      // Bridge: half-time feel, roots and fifths.
      put(0, root, 116, segment.length >= 8 ? 6 : 3);
      if (segment.length >= 8) put(segment.length - 2, approach, 96, 2);
      if (segment.length === 16) put(8, root + 7, 104, 4);
      continue;
    }
    if (segment.length === 16) {
      put(0, root, 120, 3); put(3, root + 12, 126, 1); put(6, root + 7, 104, 2);
      put(8, root, 112, 2); put(10, root + 12, 124, 1); put(12, root + 10, 104, 2); put(14, approach, 100, 2);
    } else if (segment.length === 8) {
      put(0, root, 120, 3); put(3, root + 12, 126, 1); put(4, root + 7, 104, 2); put(6, approach, 98, 2);
    } else {
      put(0, root, 118, 2); put(2, approach, 96, 2);
    }
  }
  timeline.note("bass", finalLine, { track: 0, note: bassRoot(10), module: M.bass, velocity: 124, gate: 24 });

  // --- Keys (FM Rhodes, rootless voicings) ------------------------------------
  const keysVoicer = createVoicer(51, 70);
  for (const segment of SEGMENTS) {
    const bar = Math.floor(segment.line / LPB);
    const section = sectionOf(bar);
    const voicing = keysVoicer(segment.chord);
    const hit = (offset, gate, velocity) => {
      voicing.forEach((note, index) => {
        timeline.note("keys", segment.line + offset, { track: index, note, module: M.keys, velocity: human(velocity, 3), gate, delay: index ? index : undefined });
      });
    };
    if (bar >= 54) {
      if (segment.line === finalLine) {
        voicing.forEach((note, index) => {
          timeline.note("keys", finalLine, { track: index, note, module: M.keys, velocity: 104, gate: 28, delay: 1 + index * 3 });
        });
      }
      continue;
    }
    if (kimeBar(bar)) {
      for (const line of KIME) {
        if (line >= segment.line % LPB && line < segment.line % LPB + segment.length) hit(line - (segment.line % LPB), 2, 100);
      }
      continue;
    }
    if (section.key === "intro" || section.key === "bridge") {
      hit(0, segment.length - 1, section.key === "bridge" ? 86 : 96);
      if (segment.length === 16) hit(10, 4, 72);
      continue;
    }
    const base = section.key === "a1" ? 84 : 96;
    if (segment.length === 16) { hit(0, 3, base); hit(6, 2, base - 14); hit(10, 4, base - 6); } else if (segment.length === 8) { hit(0, 3, base); hit(6, 2, base - 14); } else hit(0, 3, base - 4);
  }

  // --- Brass (hits) and strings (bridge / last A) ------------------------------
  const brassVoicer = createVoicer(55, 74);
  const padVoicer = createVoicer(50, 69);
  for (const segment of SEGMENTS) {
    const bar = Math.floor(segment.line / LPB);
    const section = sectionOf(bar);
    const brass = brassVoicer(segment.chord);
    const pad = padVoicer(segment.chord);
    const local = bar - section.start;
    const play = (module, voicing, offset, gate, velocity, lane) => {
      voicing.forEach((note, index) => {
        timeline.note(lane, segment.line + offset, { track: index, note, module, velocity: human(velocity, 3), gate });
      });
    };
    if (kimeBar(bar)) {
      for (const line of KIME) {
        if (line >= segment.line % LPB && line < segment.line % LPB + segment.length) play(M.brass, brass, line - (segment.line % LPB), line === 12 ? 4 : 2, 108, "brass");
      }
      continue;
    }
    if (segment.line === finalLine) {
      play(M.brass, brass, 0, 24, 112, "brass");
      play(M.strings, pad, 0, 30, 110, "pad");
      continue;
    }
    if (bar >= 54) continue;
    if (section.key === "intro" && bar === 3) play(M.brass, brass, 0, 2, 110, "brass");
    if (["a2", "a3", "a4"].includes(section.key) && (local === 3 || local === 7) && segment.line % LPB === 0) {
      play(M.brass, brass, 0, 2, 114, "brass");
      if (segment.length === 16) play(M.brass, brass, 3, 4, 104, "brass");
    }
    if (section.key === "bridge") play(M.brass, brass, 0, segment.length - 1, 62, "brass");
    if (section.key === "bridge" || section.key === "a4") play(M.strings, pad, 0, segment.length, section.key === "bridge" ? 86 : 88, "pad");
  }

  // --- Lead: saw lead and whistle ---------------------------------------------
  const writeLead = (notes, module, track, { transpose = 0, velocity = 108, lastGate } = {}) => {
    notes.forEach((entry, index) => {
      const next = notes[index + 1];
      const legato = next && next.line === entry.line + entry.length;
      const gate = index === notes.length - 1 && lastGate ? lastGate : legato ? entry.length : Math.max(1, entry.length - 1);
      timeline.note("lead", entry.line, { track, note: entry.note + transpose, module, velocity: human(entry.line % 4 === 2 ? velocity + 6 : velocity, 3), gate });
    });
  };
  writeLead(themeAt(4, THEME_TURN), M.whistle, 1, { velocity: 104 });
  writeLead(themeAt(12, THEME_HOME), M.lead, 0);
  writeLead(parseLine(BRIDGE, 20), M.lead, 0, { velocity: 104 });
  writeLead(themeAt(28, THEME_TURN), M.lead, 0);
  writeLead(themeAt(28, THEME_TURN), M.whistle, 1, { transpose: 12, velocity: 80 });
  writeLead(soloLine(36, 8, rng), M.lead, 0, { velocity: 104 });
  writeLead(themeAt(44, THEME_LAST), M.lead, 0);
  writeLead(themeAt(44, THEME_LAST), M.whistle, 1, { transpose: 12, velocity: 80 });
  const ending = [...parseLine(ENDING, 52), { line: finalLine, length: 24, note: noteNumber("F6") }];
  writeLead(ending, M.lead, 0, { velocity: 112, lastGate: 24 });
  writeLead(ending, M.whistle, 1, { velocity: 86, lastGate: 24 });
}

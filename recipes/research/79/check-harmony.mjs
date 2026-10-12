#!/usr/bin/env node
// @ts-check
// Scans the built project for lead notes that sit a minor 2nd / minor 9th
// above a simultaneously sounding accompaniment note (the harshest rub),
// weighted by overlap. Reconstructs note spans per supertrack lane.
// Usage: node recipes/research/79/check-harmony.mjs [minOverlapLines]

import { buildMidnightLoopLineDocument } from "../../../generated/recipes/music/midnight-loop-line.mjs";
import { noteName, noteNumber } from "../../../tools/sunvox-song-builder.mjs";

const minOverlap = Number(process.argv[2] ?? 2);
const document = await buildMidnightLoopLineDocument();
const nameOf = (index) => document.modules[index]?.name;
const LEADS = new Set(["Loop Line Lead", "Twin Lead", "Platform Whistle"]);
const ACCOMPANIMENT = new Set(["Loop Line Tines", "Afterglow Strings", "Shuto Brass", "Cutting (open)", "Lately Pop Bass"]);

const spans = [];
const active = new Map();
const events = document.patterns.flatMap((pattern) =>
  (pattern.events ?? []).map((event) => ({ ...event, abs: pattern.position.x + event.line, lane: pattern.position.y })),
);
events.sort((a, b) => a.abs - b.abs);
const close = (key, line) => {
  const span = active.get(key);
  if (span) {
    span.end = line;
    spans.push(span);
    active.delete(key);
  }
};
for (const event of events) {
  if (event.note === undefined) continue;
  const key = `${event.lane}:${event.track}`;
  close(key, event.abs);
  if (event.note !== "noteOff") {
    active.set(key, { start: event.abs, note: noteNumber(event.note), module: nameOf(event.module) });
  }
}
for (const key of [...active.keys()]) close(key, Number.POSITIVE_INFINITY);

const leads = spans.filter((span) => LEADS.has(span.module));
const accompaniment = spans.filter((span) => ACCOMPANIMENT.has(span.module));
let total = 0;
for (const lead of leads) {
  for (const other of accompaniment) {
    const overlap = Math.min(lead.end, other.end) - Math.max(lead.start, other.start);
    if (overlap < minOverlap) continue;
    const diff = lead.note - other.note;
    if (diff > 0 && diff % 12 === 1) {
      total += overlap;
      const bar = Math.floor(lead.start / 16);
      console.log(
        `bar ${String(bar).padStart(2)}.${String(lead.start % 16).padStart(2)} ${noteName(lead.note).padEnd(4)} over ${other.module} ${noteName(other.note)} (${diff === 1 ? "m2" : "m9"}) overlap ${overlap}`,
      );
    }
  }
}
console.log(`total clash overlap: ${total} lines`);

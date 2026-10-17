#!/usr/bin/env bash
# Stem loudness check (#95): renders each part solo and prints the first
# audio-review line (integrated loudness) next to the full mix.
set -euo pipefail
song=${1:-var/95/glass-tide.sunvox}
out=var/95/stems
mkdir -p "$out"
declare -A groups=(
  [kick]="Kick" [snare]="Snare Noise,Snare Body" [hats]="Hat,Shaker"
  [sub]="Sub In" [reese]="Reese In,Reese LFO 2 bars" [keys]="Glass Tines" [pad]="Pad In"
  [lead]="Lead In" [fx]="Riser Noise,Crash,Impact Boom"
)
node tools/sunvox-render-audio.mjs --duration 104 --out "$out/mix.wav" "$song" >/dev/null
printf '%-6s %s\n' mix "$(node tools/audio-review.mjs --png /dev/null --report /dev/stdout "$out/mix.wav" | sed -n 1p)"
for name in kick snare hats sub reese keys pad lead fx; do
  node tools/sunvox-render-audio.mjs --solo "${groups[$name]}" --duration 104 --out "$out/$name.wav" "$song" >/dev/null
  printf '%-6s %s\n' "$name" "$(node tools/audio-review.mjs --png /dev/null --report /dev/stdout "$out/$name.wav" | sed -n 1p)"
done

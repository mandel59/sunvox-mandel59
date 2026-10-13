#!/usr/bin/env bash
# Stem loudness check (#90): renders each part solo (with the macro and its
# own modulators) and prints integrated LUFS next to the full mix.
set -euo pipefail
song=${1:-var/90/voltage-garden.sunvox}
out=var/90/stems
mkdir -p "$out"
declare -A groups=(
  [kick]="Kick" [snare]="Snare Noise,Snare Body" [hats]="Closed Hat,Open Hat"
  [bass]="Bass In" [seq]="Seq In,Sweep LFO 4 bars" [pad]="Pad VCO"
  [pluck]="Pluck VCO,Random 1 line" [lead]="Lead In" [riser]="Riser Noise"
)
node tools/sunvox-render-audio.mjs --duration 60 --out "$out/mix.wav" "$song" >/dev/null
printf '%-6s %s\n' mix "$(node tools/audio-review.mjs --png /dev/null --report /dev/stdout "$out/mix.wav" | sed -n 1p)"
for name in kick snare hats bass seq pad pluck lead riser; do
  node tools/sunvox-render-audio.mjs --solo "${groups[$name]},Voltage Macro" --duration 60 --out "$out/$name.wav" "$song" >/dev/null
  printf '%-6s %s\n' "$name" "$(node tools/audio-review.mjs --png /dev/null --report /dev/stdout "$out/$name.wav" | sed -n 1p)"
done

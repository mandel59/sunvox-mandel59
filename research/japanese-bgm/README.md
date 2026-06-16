# Japanese-Style BGM Research

Issue: https://github.com/mandel59/sunvox-mandel59/issues/32

Tag: `research:japanese-bgm`

## Unified Recipes

```sh
npm run sunvox:edit-recipe -- generated/recipes/sunvox-edit/wa-instruments.mjs
npm run sunvox:music-recipe -- generated/recipes/music/wa-bgm-sketch.mjs
```

Committed generated artifacts:

- `generated/instruments/Wa Koto Pluck.sunsynth`
- `generated/instruments/Wa Shamisen Twang.sunsynth`
- `generated/instruments/Wa Shakuhachi Breath.sunsynth`
- `generated/instruments/Wa Taiko Ensemble.sunsynth`
- `generated/music/wa-bgm-sketch.sunvox`

The BGM project is still assembled through SunVox Lib at recipe runtime because
this path reliably saves playable patterns and runtime tempo. The checked-in
music recipe fixes pattern icons after parsing so the generated `.sunvox` file
can be reproduced byte-for-byte.

## Musical Ideas

- D-centered in-sen / hirajoshi-adjacent scale: D, D#, G, A, C.
- Koto: FMX pluck plus a short violet-noise nail click.
- Shamisen: square/saw twang through a light saturation stage.
- Shakuhachi: hsin tone, pink breath noise, Vocal filter, and slow vibrato.
- Taiko: Kicker body, skin noise, rim click, saturation, and short room reverb.
- Arrangement leaves `ma` gaps and adds a separate taiko-heavy stinger pattern.

## Verification

```sh
npm run sunvox:outline -- --events 12 generated/music/wa-bgm-sketch.sunvox
npm run sunvox:render-debug -- --duration 12 generated/music/wa-bgm-sketch.sunvox
```

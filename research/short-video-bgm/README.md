# Short-Video BGM Research

Issue: https://github.com/mandel59/sunvox-mandel59/issues/30

## Trend Notes

Checked on 2026-06-06 JST.

- TikTok Creative Center Trends exposes songs by time frame, Popular/Breakout
  tabs, analytics, region, and "Approved for business use"; business-approved
  songs are treated as royalty-free inside that context.
  https://ads.us.tiktok.com/help/article/how-to-use-trends?lang=en
- YouTube ranks Top Songs on Shorts by the number of Shorts created with the
  song, which means reusable audio identity and creator adoption matter as much
  as ordinary listening counts.
  https://support.google.com/youtube/answer/9014376?hl=en-EN
- YouTube Shorts creation tools increasingly align clips to the beat
  automatically, so clear transients and a steady grid make a BGM more useful
  for edits.
  https://blog.youtube/news-and-events/new-creation-tools-youtube-shorts-2025/
- Recent soundtrack-generation research notes that creators need fast
  comparison, mood fit, and context-aware review, not just one generated track.
  https://arxiv.org/abs/2601.12180

Working assumptions for this repo:

- Do not depend on platform-licensed trending songs for reusable assets.
- Make original, non-vocal, loopable cues that can survive reposting across
  platforms.
- Put a recognizable sound in the first second.
- Keep a steady beat grid for automatic or manual beat-synced editing.
- Leave enough mix headroom for voiceover, captions, and platform loudness
  normalization.
- Generate variants and objective summaries so candidates can be compared
  quickly.

## Theme Set: Short Hook Loops

Unified recipe:

```sh
npm run sunvox:music-recipe -- generated/recipes/music/short-video-bgm.mjs
```

Generated artifacts:

- `generated/music/first-hook-loop.sunvox`
- `generated/music/narration-lofi-bed.sunvox`
- `generated/music/tech-demo-stinger.sunvox`
- `var/music-recipe/first-hook-loop.summary.json`
- `var/music-recipe/narration-lofi-bed.summary.json`
- `var/music-recipe/tech-demo-stinger.summary.json`
- `var/music-recipe/short-video-bgm.summary.json` when the recipe file is
  executed directly.

The `.sunvox` files are now committed research artifacts under `generated/`.
They are still research output, not deploy-ready music assets.

Shared design:

- 128 BPM, 128 lines, roughly 15 seconds.
- 12-track pattern with kick, acid bass, layered pad, glass bell, FMX pluck,
  FMX tines, and PWM organ.
- Every theme starts with a recognizable non-vocal identity cue.
- Kick/bass patterns keep a stable beat grid for short-video edits.
- Pad, bell, pluck, tines, and organ provide a musical bed that should stay
  usable under captions or narration better than a lead-vocal track.
- The mix graph keeps kick/bass focused in the center, spreads pad/bell/pluck,
  tines, and organ with per-part Amplifiers, then sends the music bed through a
  short stereo Delay, light Reverb, and a master Compressor.
- Node positions are generated from part lanes and signal-flow columns so the
  graph reads left-to-right, ending with `Mix Master Glue -> Output`.
- The patterns are intended to loop, with no long intro.

Themes:

| Theme | Intent | Events | Peak | RMS | Side/Mid | Quiet parts |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `first-hook-loop` | Bright all-purpose hook loop with an immediate bell identity. | 336 | 0.7116 | 0.1282 | 0.647 | none |
| `narration-lofi-bed` | Lower-density half-time feel with more room for voiceover and captions. | 168 | 0.4315 | 0.0724 | 0.528 | none |
| `tech-demo-stinger` | Clean product-demo cue with a stronger first-second hook and more motion. | 394 | 0.6530 | 0.0999 | 0.519 | none |

Current `short-video-bgm.summary.json` excerpt from the direct analysis path:

```json
{
  "outputDir": "generated/music",
  "renderSeconds": 16,
  "themes": [
    {
      "id": "first-hook-loop",
      "bpm": 128,
      "nonEmptyEvents": 336,
      "peak": 0.7116361856460571,
      "rms": 0.1281971910009897,
      "clippedSamples": 0,
      "quietParts": []
    },
    {
      "id": "narration-lofi-bed",
      "bpm": 128,
      "nonEmptyEvents": 168,
      "peak": 0.431465208530426,
      "rms": 0.07237894809498031,
      "clippedSamples": 0,
      "quietParts": []
    },
    {
      "id": "tech-demo-stinger",
      "bpm": 128,
      "nonEmptyEvents": 394,
      "peak": 0.6530043482780457,
      "rms": 0.09987831571540151,
      "clippedSamples": 0,
      "quietParts": []
    }
  ]
}
```

Reload verification:

```sh
npm run sunvox:validate -- "generated/music/first-hook-loop.sunvox"
npm run sunvox:validate -- "generated/music/narration-lofi-bed.sunvox"
npm run sunvox:validate -- "generated/music/tech-demo-stinger.sunvox"
npm run sunvox:render-debug -- --duration 16 --json "generated/music/first-hook-loop.sunvox"
npm run sunvox:render-debug -- --duration 16 --json "generated/music/narration-lofi-bed.sunvox"
npm run sunvox:render-debug -- --duration 16 --json "generated/music/tech-demo-stinger.sunvox"
```

Observed reload stats:

| Theme | Reload peak | Reload RMS | Validation |
| --- | ---: | ---: | --- |
| `first-hook-loop` | 0.7114 | 0.1282 | no issues |
| `narration-lofi-bed` | 0.4307 | 0.0724 | no issues |
| `tech-demo-stinger` | 0.6523 | 0.0999 | no issues |

The saved `.sunvox` files keep the mix graph, node layout, and headroom
adjustment after reload.

## Mix Graph

The script now creates these saved SunVox modules after the instruments:

- `Mix Kick Center`: mono-focused kick trim.
- `Mix Bass Focus`: narrow center bass trim.
- `Mix Pad Wide`, `Mix Bell Air`, `Mix Pluck Motion`, `Mix Tines Lift`, and
  `Mix Organ Stabs`: per-part balance and stereo-width trims.
- `Mix Music Width Bus`: shared music-bed width stage for pad, bell, pluck,
  tines, and organ.
- `Mix Music Space Delay`: short L/R millisecond delay for movement and depth.
- `Mix Music Air Room`: light reverb after the delay.
- `Mix Master Glue`: RMS compressor before `Output`.

The generated themes report `sideToMidRms` around `0.52` to `0.65` and
correlation around `0.41` to `0.58`, which is wider than a centered mono bed
while keeping kick and bass focused.

## Node Layout

The project graph layout is generated from two axes:

- Part lanes: kick, bass, pad, bell, pluck, tines, and organ are stacked in
  stable rows.
- Signal columns: source instruments, per-part trims, shared music bus, delay,
  room, master, and output are placed left-to-right.

This keeps per-part processing visually aligned and puts `Output` at
`x=1664, y=476`, directly to the right of `Mix Master Glue` at `x=1424, y=476`.

## Part Balance Check

The script now renders the full mix plus seven solo passes from the saved
project:

- full mix
- kick solo
- bass solo
- pad solo
- bell solo
- pluck solo
- tines solo
- organ solo

Each solo pass reloads the saved `.sunvox`, mutes the other instrument modules
at runtime, and records peak/RMS/active ratio plus stereo spread. The summary
also compares each part's RMS to the loudest part and marks it as:

- `dominant`: near the loudest part
- `present`: audible relative to the loudest part
- `quiet`: likely masked or too low

Current result after the theme pass:

| Theme | Dominant parts | Lowest present part | Quiet parts |
| --- | --- | --- | --- |
| `first-hook-loop` | bass, bell | tines, 0.386 vs max RMS | none |
| `narration-lofi-bed` | bass, pad | pluck, 0.385 vs max RMS | none |
| `tech-demo-stinger` | kick | tines, 0.406 vs max RMS | none |

This keeps all parts above the `present` threshold after routing through the
mix graph. The lo-fi theme intentionally leaves more headroom and lower density,
while the tech theme raises rhythmic motion without clipping.

## Findings

- A short BGM prototype can be generated today with the existing SunVox Lib
  bridge plus the structured codec.
- The first focused script has been migrated to `sunvox:music-recipe`, so the
  reproducible source now lives under `generated/recipes/music/`.
- Runtime-only `sv_set_module_ctl_value()` changes were not sufficient as a
  saved asset workflow; the script now saves the project, edits persistent
  `MetaModule` volumes and mix-module controller values through the codec,
  rebuilds the `.sunvox`, reloads it, and renders the final saved state.
- The generated theme set meets the technical audio target of no clipping at
  full project volume.
- The generated theme set meets the part-balance target: every part is at least
  `present` in the solo RMS comparison.
- The arrangement pass adds a second-half pluck arpeggio, bell response, and
  final bass fill while keeping reload peak below `0.9`.
- The mix graph pass adds a saved routing circuit for center focus, stereo
  width, shared space, and master glue while keeping clipped samples at `0`.
- The idea pass adds tines pickups, organ stabs, kick ghost pickups, and bass
  turnarounds while keeping all seven parts at least `present`.
- The node layout pass replaces scattered fixed positions with lane/column
  placement and moves `Output` to the right of the master module.
- The theme pass adds `narration-lofi-bed` and `tech-demo-stinger` alongside
  `first-hook-loop`, plus `short-video-bgm.summary.json` for quick comparison
  when the recipe file is executed directly.
- It still needs subjective listening and loop-boundary review before promotion.

## Next Experiments

- Add one more high-energy transition cue and one calmer tutorial bed.
- Use the part balance check as a gate before generating more variants.
- Export or render preview audio for quick listening.
- Add loop-boundary analysis or render the seam twice to catch clicks/tails.
- Port the alternate palette and polyrhythm/vocoder keep refs into the same
  music recipe contract before generating more variants.

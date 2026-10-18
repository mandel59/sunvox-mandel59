# Generated Music Promotion

`main` is deployed publicly. A music file is eligible for
`generated/music/` only after its track or small coherent pack completes a
focused promotion Issue. Draft location alone must never imply distribution
approval.

## Path Boundary

- Research recipe: `recipes/research/<issue>/`
- Research output and reports: `var/<issue>/`
- Promoted recipe: `generated/recipes/music/`
- Promoted distribution entry: `generated/manifest.json`
- Rebuilt output: `generated/music/` (untracked)

The default site-data roots include `generated/music/`, but do not include
`recipes/research/` or `var/`. Research-only work therefore remains outside the
public deployment until an explicit promotion change adds selected manifest
entries.

## Required Evidence

The focused promotion Issue must record all of the following before a recipe
and its manifest entries move to promoted paths:

1. **Deterministic regeneration:** the checked-in recipe reproduces every
   proposed `.sunvox` file with the SHA-256 and byte size recorded in
   `generated/manifest.json`. Record the exact regeneration command and result;
   `npm run generated:build` verifies these approved bytes.
2. **Structural validation:** codec validation and the relevant recipe tests
   pass. Link any exception to a focused diagnostic Issue.
3. **Render verification:** record duration, peak, RMS, non-zero frames,
   clipped samples, and leading silence. Required-audio tracks must not be
   silent; clipping and leading-silence limits must be explicit.
4. **Listening review:** name the reviewed track/version and summarize audible
   defects, arrangement fit, loop or ending behavior, and the review outcome.
5. **Provenance:** each output resolves by its complete repository-relative
   path to exactly one recipe and the focused source Issue.
6. **Distribution approval:** record an explicit decision that the track may
   appear on the public site and in distributed repository artifacts.

Promotion should contain one track or a small pack with one purpose. Split the
Issue when tracks need different listening decisions, provenance, or release
timing. Store long render logs and temporary audio under `var/<issue>/`; keep
only commands, summaries, decisions, and durable artifact links in the Issue.

## Current Inventory

The following 21 files predate this gate and remain publicly deployed while
their continued distribution is re-reviewed. `Pending` is not approval.

| Review unit | Outputs | Source recipes | Source research | Promotion | Status |
| --- | ---: | --- | --- | --- | --- |
| Aurora Pulse | 1 | `aurora-pulse.mjs` | Not yet identified | Not yet assigned | Pending |
| Short-video pack | 9 | `short-video-bgm.mjs`, `short-video-alt-palette.mjs`, `short-video-poly-vocoder.mjs` | #30 | #55 | Pending |
| Podcast pack | 5 | `podcast-bed-loop.mjs`, `podcast-purpose-pack.mjs` | #38 | #56 | Pending |
| Neon Razor Drift | 1 | `neon-razor-drift.mjs` | Not yet identified | #57 | Pending |
| Pitch-bend sketch | 1 | `pitch-bend-sketch.mjs` | #45 | #58 | Pending |
| Japanese-style BGM | 1 | `wa-bgm-sketch.mjs` | #32 | #59 | Pending |
| 43-EDO studies | 3 | `microtonal-43edo-studies.mjs` | #42 | #60 | Pending |

Files promoted through this gate:

| Review unit | Outputs | Source recipes | Source research | Promotion | Status |
| --- | ---: | --- | --- | --- | --- |
| Midnight Loop Line | 1 | `midnight-loop-line.mjs` (modules in `music-lib/midnight-loop-line/`) | #79 | #80 | Approved for distribution by the owner (2026-10-12) |
| Voltage Garden | 1 | `voltage-garden.mjs` (score in `music-lib/voltage-garden/`) | #90 | #91 | Approved for distribution by the owner (2026-10-13) |
| Glass Tide | 1 | `glass-tide.mjs` (score in `music-lib/glass-tide/`) | #95 | #96 | Approved for distribution by the owner (2026-10-19) |

Inventory counts must match the music entries in `generated/manifest.json`.
When a promotion Issue closes, update its row with the
decision and link the commit or PR that either retains or removes the files.

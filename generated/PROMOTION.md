# Generated Music Promotion

`main` is deployed publicly. A music file is eligible for
`generated/music/` only after its track or small coherent pack completes a
focused promotion Issue. Draft location alone must never imply distribution
approval.

## Path Boundary

- Research recipe: `recipes/research/<issue>/`
- Research output and reports: `var/<issue>/`
- Promoted recipe: `generated/recipes/music/`
- Promoted output: `generated/music/`

The default site-data roots include `generated/music/`, but do not include
`recipes/research/` or `var/`. Research-only work therefore remains outside the
public deployment until an explicit promotion change moves selected files.

## Required Evidence

The focused promotion Issue must record all of the following before the files
move to a promoted path:

1. **Deterministic regeneration:** the checked-in recipe reproduces every
   proposed `.sunvox` file byte-for-byte. Record the exact command and result.
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

The following 20 files predate this gate and remain publicly deployed while
their continued distribution is re-reviewed. `Pending` is not approval.

| Review unit | Outputs | Source recipes | Source research | Promotion | Status |
| --- | ---: | --- | --- | --- | --- |
| Short-video pack | 9 | `short-video-bgm.mjs`, `short-video-alt-palette.mjs`, `short-video-poly-vocoder.mjs` | #30 | #55 | Pending |
| Podcast pack | 5 | `podcast-bed-loop.mjs`, `podcast-purpose-pack.mjs` | #38 | #56 | Pending |
| Neon Razor Drift | 1 | `neon-razor-drift.mjs` | Not yet identified | #57 | Pending |
| Pitch-bend sketch | 1 | `pitch-bend-sketch.mjs` | #45 | #58 | Pending |
| Japanese-style BGM | 1 | `wa-bgm-sketch.mjs` | #32 | #59 | Pending |
| 43-EDO studies | 3 | `microtonal-43edo-studies.mjs` | #42 | #60 | Pending |

Inventory counts must match the tracked `.sunvox` files under
`generated/music/`. When a promotion Issue closes, update its row with the
decision and link the commit or PR that either retains or removes the files.

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

## Promotion Records

Keep one [promotion record](promotions/) per track or small pack. Use the
track or pack name for the filename. Record the output paths from
`generated/manifest.json`, the source recipes, the source and promotion Issues,
and the current review status. When a promotion Issue closes, update its
record with the decision and link the commit or PR that retains or removes
the files.

Records for tracks already distributed when the gate was adopted document
their continued-distribution review.

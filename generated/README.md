# Generated SunVox Assets

This directory contains committed recipes and a distribution manifest.
Selected `.sunsynth` and `.sunvox` outputs are rebuilt locally and in CI;
the binaries in `generated/instruments/` and `generated/music/` are ignored
by Git. Keep temporary drafts, render reports and experiments in `var/`.
Human-authored recipes belong under `recipes/`.

- `manifest.json`: recipe path, output ID, public path, SHA-256 and byte size
  for each distributed binary.
- `recipes/sunvox-edit/`: reproducible instrument recipes, including outputs
  that are intentionally absent from the distribution list.
- `recipes/music/`: promoted music recipes.
- `recipes/music-lib/`: song-specific helper modules imported by music recipes;
  these are not scanned as recipes.
- `instruments/` and `music/`: rebuilt distribution outputs.

```sh
npm run generated:build
npm run generated:build -- --if-missing
# After reviewing an intentional change to approved bytes:
npm run generated:build -- --update-manifest
```

The build runs only manifest-listed outputs, builds instruments before music,
and checks all hashes in temporary staging before publishing outputs. It also
removes stale distribution binaries. `--if-missing` verifies existing bytes
and restores missing outputs; a mismatch fails and requires review.
`--update-manifest` updates hashes and sizes for the explicit distribution
list; it never discovers or promotes files automatically.

To add an approved output, add its recipe, output ID and public path to the
manifest with the reviewed SHA-256 and byte size, then run the normal build.
The existing public bytes seeded this manifest and rebuild without changes.
The six experimental SuperSaw variants are intentionally not distributed.

Generated music promotion is governed by [PROMOTION.md](PROMOTION.md).
Research recipes belong under `recipes/research/<issue>/` and research
outputs under `var/<issue>/`; neither is part of the deployment roots.
Adding a recipe to `generated/recipes/music/` and a distribution entry to the
manifest is a reviewed promotion step.

The synth demo's `packages/sunvox-synth/assets/scratch-fmx-tines.sunsynth`
remains a committed package fixture. Removing or replacing that bundled copy
is a separate package decision; it is outside this generated distribution list.

The files in this directory should not be described as hand-authored by
Ryusei Yamaguchi (@mandel59) unless they were authored separately from the
generation workflow. Recipes may be produced with Codex or Claude Code.

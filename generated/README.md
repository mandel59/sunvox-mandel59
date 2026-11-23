# Generated SunVox Assets

This directory contains committed recipes and per-output distribution records.
Selected `.sunsynth` and `.sunvox` outputs are rebuilt locally and in CI;
the binaries in `generated/instruments/` and `generated/music/` are ignored
by Git. Keep temporary drafts, render reports and experiments in `var/`.
Human-authored recipes belong under `recipes/`.

- `manifests/instruments/` and `manifests/music/` each contain one JSON file per
  distributed output. Each file records the recipe path, output ID, public path,
  SHA-256 and byte size. Music records can also include a `createdOn` date in
  `YYYY-MM-DD` format, which the Files browser uses for sorting.
- `recipes/sunvox-edit/`: reproducible instrument recipes, including outputs
  that are intentionally absent from the distribution list.
- `recipes/music/`: promoted music recipes.
- `recipes/music-lib/`: song-specific helper modules imported by music recipes;
  these are not scanned as recipes.
- `instruments/` and `music/`: rebuilt distribution outputs.

The distributed files in `generated/instruments/` and `generated/music/` are
released under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

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
list. It rewrites only records whose digest or size changes.

To add an approved output, create its JSON record in the corresponding
`manifests/` subdirectory. Use the output filename with `.json` as its extension,
and include the reviewed SHA-256 and byte size. Then run the normal build.
The site build combines the records into `dist/generated/manifest.json`.
When integrating a branch that still edits the old aggregate, move that
branch's changed output records into their individual JSON files.
The existing public bytes seeded this manifest and rebuild without changes.
The six experimental SuperSaw variants are intentionally not distributed.

Generated music promotion follows [PROMOTION.md](PROMOTION.md). Each track or
pack has its own [promotion record](promotions/).
Research recipes belong under `recipes/research/<issue>/` and research
outputs under `var/<issue>/`; neither is part of the deployment roots.
Adding a recipe to `generated/recipes/music/` and its output record to
`generated/manifests/music/` is a reviewed promotion step.

The synth demo's `packages/sunvox-synth/assets/scratch-fmx-tines.sunsynth`
remains a committed package fixture. Removing or replacing that bundled copy
is a separate package decision; it is outside this generated distribution list.

The files in this directory should not be described as hand-authored by
Ryusei Yamaguchi (@mandel59) unless they were authored separately from the
generation workflow. Recipes may be produced with Codex and/or Claude Code.

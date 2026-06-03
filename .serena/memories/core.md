# Core

- SunVox/SunSynth tooling repo plus GitHub Pages inspector/player.
- Source map:
  - `src/`: Vite/React inspector UI, project graph rendering, styles.
  - `js/`: classic SunVox JS/WASM player bridge used by browser playback.
  - `tools/`: Node CLI/tools, SunVox codec, DB inspectors, render/debug helpers, recipe tooling.
  - `tools/sunvox-db/`: machine-readable SunVox knowledge DB and schema.
  - `test/`: Node test suite for codec, DB, frontend data, recipes, render probes.
  - `music/`, `instruments/`: human-authored distributed SunVox/SunSynth assets.
  - `generated/`: committed generated recipes/assets; keep separate from human-authored assets.
  - `var/`: untracked scratch data, downloaded SunVox archive, extracted source fixture.
  - `sunvox_lib/`: runtime JS/WASM and license files extracted from pinned SunVox Lib archive.
- Read `mem:tech_stack` for runtime/build pins and `mem:suggested_commands` for command forms.
- Read `mem:conventions` before changing codec/DB/frontend structure.
- Read `mem:task_completion` before finishing coding tasks.
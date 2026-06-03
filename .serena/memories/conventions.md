# Conventions

- Commit in small work units; use `jj commit`. For multi-line messages, pass multiple `-m` options instead of literal newlines.
- Keep generated and human-authored assets separate:
  - human music/instruments: `music/`, `instruments/`
  - committed generated assets: `generated/music/`, `generated/instruments/`
  - generated recipes/examples: `generated/recipes/`
  - human recipes: `recipes/`
  - scratch/untracked IO: `var/`
- Codec text representation: `_...` properties are auxiliary and must be removable without breaking round-trip; round-trip-critical fields must not be hidden under `_`.
- SunVox API behavior must be source-audited against `var/sunvox_lib/sunvox_lib/headers/sunvox.h` and `var/sunvox_lib/sunvox_lib/main/sunvox_lib.cpp`; do not infer API argument semantics from audio observations alone.
- Shared Node SunVox runtime logic belongs in `tools/sunvox-node.mjs`; tools should not duplicate slot setup, memory transfer, time-map lookup, or offline render loops.
- DB-backed SunVox knowledge belongs in `tools/sunvox-db/database.json` plus schema/docs/tests when it is stable and source-derived.
- Frontend inspector is React under `src/`; SunVox player bridge remains a small classic script under `js/`.
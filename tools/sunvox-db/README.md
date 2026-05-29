# SunVox Codec Database

This directory contains machine-readable codec knowledge extracted from the
SunVox library source. The database is intentionally declarative so the codec
can either interpret it directly or generate conversion code from it later.

## MVP Scope

- `chunks`: maps chunk IDs to labels, scopes, and payload types.
  Reviewed chunks may also include `sourceType`, `valueKind`, `sourceSymbol`,
  and `signedRoundTrip` so source-code storage details do not disappear during
  codec work.
- `enums`: maps stored numeric values to editable names.
- `bitfields`: describes packed integer fields such as `CMID`.
- `bitflags`: maps stored flag bits to sparse named objects.
- `structs`: describes fixed-size record arrays such as pattern notes and MIDI
  bindings. Pattern notes also declare the editable text layout used for
  `patterns[].events`: sparse semantic event objects with explicit `line` and
  `track` fields, backed by a line-major tuple layout for binary round-trips.
  Their `fieldSemantics` entries drive note names, one-based module references,
  packed controller/effect values, and editable aliases such as `parameter`.
- `grammar`: maps semantic object paths to chunk IDs and emit order.
- `moduleDataChunkGrammar`: describes the `CHNK` / `CHNM` / `CHDT`
  sequence and optional metadata chunks such as `CHFF` and `CHFR`.
- `runtimeConstraints`: records SunVox Lib runtime/save compatibility warnings
  that are useful during editing but are not hard build errors by default.
- `modules`: describes module-specific controller layouts and data chunk
  layouts. Controller definitions can use `path` for nested semantic output and
  `repeat` for repeated layouts such as FMX operators.

The database covers the chunk labels already used by the codec,
project/pattern/module chunk order, project/pattern/module flag bits, `CMID`
MIDI binding bitfields, `SVPR` visualizer parameter bitfields, MIDI output
channel names, signed MIDI output settings, signed project editor state fields,
signed clone parent/sample rate metadata, all 42 module catalog defaults
(`color`, `inputs`, `outputs`, `flags`, and available `flags2`), and all 42
module controller layouts currently detected from
`var/sunvox_lib/lib_sunvox/psynth/psynths_*.cpp`. It also identifies the
first `MetaModule` data chunk as an embedded SunVox container, allowing the
codec to recurse into it instead of keeping that payload as opaque base64.
Additional `MetaModule` data chunk definitions describe user controller links,
options, and custom controller names through reusable layout types such as
`packedUInt32Array`, `struct`, `recordArray`, and `string`; the codec joins
that metadata with CVAL chunks so user controller values appear under
`controllers.user`, with auxiliary target module/controller names resolved
from embedded MetaModule projects when possible. FMX uses a repeated operator
template so the editable text
contains an `operators` array instead of a long raw controller list. Module data
chunk layouts now cover sampled curves, compact option structures, and Sampler
instrument/sample/envelope records. Analog generator and Sampler option chunks
also record the original chunk byte length as `dataSize` so SunVox's
trailing-zero trimming can round-trip exactly. Sampler PCM payloads are treated
as known byte payloads with decoded chunk flags and sample rates; the raw bytes
remain in `bytesBase64` until a higher-level audio sample representation is
added. Module link slot chunks (`SLnK` and `SLnk`) declare which link array they
annotate and which semantic path they populate, so graph tooling can avoid
treating slot arrays as separate links. The codec maps those parallel arrays to
editable `inputs` / `outputs` link objects with local `slot`, target `module`,
and peer `peerSlot` fields.

## DB / Codec Boundary

The DB should hold declarative SunVox knowledge. The codec should hold generic
mechanics for reading bytes, walking chunk streams, applying DB plans, and
running transformations that are easier to express as code.

Move knowledge into the DB when it is stable, source-derived, or useful outside
one function:

- chunk IDs, labels, scopes, payload storage types, and signedness
- chunk order, terminators, and small chunk-sequence grammars
- structs, fixed record layouts, bitfields, bitflags, enums, and value aliases
- module catalog data, controller definitions, data chunk layouts, and link
  relations
- runtime constraints or save-normalization rules once they can be tested
  against SunVox Lib behavior

Keep logic in code when it is mechanical, algorithmic, or still experimental:

- binary parsing and writing primitives
- generic DB interpreters such as scope emitters, struct decoders, and indexed
  payload sequence handlers
- transforms that require calculation, lookup context, or cross-object joins,
  such as note names, module references, embedded MetaModule traversal, and
  auxiliary display names
- SunVox Lib compatibility probes and checks
- one-off discoveries that are not yet confirmed enough to become schema

Reducing codec line count is a secondary goal. A DB migration is worthwhile
when it makes the text representation more correct, testable, inspectable, or
reusable. Code should get shorter through shared interpreters and compiled DB
plans after similar structures appear more than once; avoid adding a broad
abstraction for a single special case.

## Inspection Tool

Use `tools/sunvox-db-inspect.mjs` to make codec/DB coverage work repeatable.

```sh
npm run sunvox:inspect -- coverage
npm run sunvox:inspect -- coverage --details
npm run sunvox:inspect -- coverage --json
npm run sunvox:coverage:check
npm run sunvox:fixtures:generate
npm run sunvox:lib:check
npm run sunvox:metrics
npm run sunvox:inspect -- metrics --json
npm run sunvox:inspect -- report
npm run sunvox:inspect -- report --json
npm run sunvox:controller-diff
npm run sunvox:inspect -- controller-diff
npm run sunvox:inspect -- controller-diff --json
npm run sunvox:inspect -- scaffold "Distortion"
npm run sunvox:inspect -- check
npm run sunvox:validate -- music/2022-04-17.sunvox
npm run sunvox:validate:all
npm run sunvox:verify:all
```

- `coverage` decodes checked-in sample and fixture `.sunvox` and `.sunsynth`
  files, including embedded MetaModule projects, and reports module types,
  missing DB module definitions, STYP-less output/empty module slots, raw
  controller arrays, controller extras, extra chunks, opaque data chunks, plus
  DB module definitions that are not exercised by the current corpus.
- `coverage --details` includes per-module paths for raw or opaque data.
- `report` scans `var/sunvox_lib/lib_sunvox/psynth/psynths_*.cpp`, compares
  source module/controller declaration counts with the DB, and summarizes
  source module catalog fields such as default color, input/output counts, and
  module flags.
- `controller-diff` compares controller ranges, units, scales, display offsets,
  and source enum value sets against the DB. It is a triage report for deciding
  which declarative source facts should be copied into `database.json`; CI
  expects this report to have no mismatches.
- `coverage --json`, `report --json`, and `controller-diff --json` emit
  machine-readable metrics for future CI or frontend tooling.
- `metrics` summarizes coverage, source/DB consistency, controller metadata
  drift, chunk storage review coverage, module data chunk layout review
  coverage, and gate status in one compact report for progress tracking.
- `sunvox:coverage:check` runs the coverage report as a CI gate. It fails on
  parse errors, missing DB module types, unexpected missing-STYP modules, raw
  controller arrays, controller extras, module extra chunks, or opaque data
  chunks. Output and empty module slots without `STYP` are reported separately
  and do not fail the gate.
- `sunvox:verify:all` recursively verifies every checked-in `.sunvox` and
  `.sunsynth` sample under `music/`, `instruments/`, and
  `test/fixtures/sunvox/`.
- `sunvox:fixtures:generate` regenerates the synthetic coverage fixture used to
  keep every DB module type represented in the default coverage corpus.
- `sunvox:lib:check` loads checked-in `.sunvox` projects with
  `sv_load_from_memory()` and `.sunsynth` modules with
  `sv_load_module_from_memory()` through the bundled SunVox JS/WASM library. The
  synthetic fixture also verifies that SunVox exposes the expected module slots
  and types, not just that the codec can round-trip the bytes. The check also
  builds small codec-edited variants and verifies through SunVox Lib that edited
  project/module/pattern names, representative controller values, module links,
  and pattern note/controller events are exposed as expected. Edited `.sunvox`
  variants are also saved through SunVox Lib and reloaded to catch runtime
  normalization issues. DB `runtimeConstraints` with `observedBehavior` are
  also probed by writing the documented value, saving through SunVox Lib, and
  checking the saved structured value. Representative controller range probes
  verify that out-of-range controller values are preserved when SunVox Lib does
  not clamp them on load/save. The command prints a compact coverage summary so
  missing edit-behavior checks are visible in the local and CI logs.
- `sunvox:validate` reports DB-driven runtime compatibility warnings for a
  binary SunVox file or decoded JSON document. The first rules cover positive
  project tempo values, module name byte budgets, semantic link targets, and
  controller values outside DB-declared ranges or enum values.
- `sunvox:validate:all` applies the same validation to every checked-in
  `.sunvox` and `.sunsynth` sample, and treats any warning or error as a quality
  gate failure.
- `scaffold <module>` emits a best-effort DB JSON draft for direct
  `psynth_register_ctl()` declarations in the SunVox source. Review unresolved
  expressions and enum names before inserting the output into `database.json`.
- `check` validates structural DB mistakes such as duplicate controller
  indexes, missing enum/bitfield/bitflags references, bitfield field references,
  grammar references to
  missing chunks, source/DB chunk ID drift, data chunk index collisions across
  explicit chunks and ranges, and simple source/DB controller-count mismatches.

## Local Quality Loop

Run the combined quality loop before committing codec or DB changes:

```sh
npm run quality
```

The command runs license notice checks, fixture regeneration, SunVox JS/WASM
compatibility, Node tests, metrics, DB structure checks, coverage and controller
metadata gates, sample round-trip verification, the frontend build, and
`git diff --check`.

## Round-Trip Policy

The database may add names and structure, but it must not be the only copy of
unknown data. The structured text keeps `extraChunks` and module `dataChunks`
where needed, so unknown or not-yet-modeled chunks can still round-trip without
loss.
Modeled properties are emitted without a leading underscore. Leading underscore
properties are reserved for auxiliary comments, labels, and source metadata that
do not affect the generated binary.
Any value required for exact binary reconstruction must be a normal property,
not an auxiliary one. The test suite enforces this by deleting every `_`-prefixed
property from structured documents and verifying that all checked-in SunVox
samples still round-trip byte-for-byte.

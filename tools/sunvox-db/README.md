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
- `patternEffectParameters`: describes source-backed packed `parameter` layouts
  for standard pattern effects. The codec decodes only values whose bits are
  fully covered by a declared layout; values with unknown bits stay numeric for
  round-trip safety. Conditional effects can use ordered `variants`, such as
  effect `0F` selecting speed, timeline-grid, or BPM semantics by stored value.
  Packed fields can also declare scaled values and stored sentinel bytes that
  should be omitted from the editable form.
- `patternEffectRanges`: describes manual/source-backed effect code ranges
  where the effect code itself carries a value, such as `40..5F` event delays
  represented as `delayEvent` with `delayLine32nds`.
- `parameterlessPatternEffects`: records source-backed effects that do not read
  the stored parameter value, so metrics can distinguish them from missing
  parameter schemas and the codec can warn when editable events carry an
  ignored nonzero `value`.
- `bitfields`: describes packed integer fields such as `CMID`.
- `bitflags`: maps stored flag bits to sparse named objects.
- `structs`: describes fixed-size record arrays such as pattern notes and MIDI
  bindings. Pattern notes also declare the editable text layout used for
  `patterns[].events`: sparse semantic event objects with explicit `line` and
  `track` fields, backed by DB-declared grid paths and a line-major tuple
  layout for binary round-trips. Their `fieldSemantics` entries drive note
  names, one-based module references, packed controller/effect values via
  `packedFields`, source-backed effect names, and editable aliases such as
  `parameter`.
- `grammar`: maps semantic object paths to chunk IDs and emit order.
- `moduleDataChunkGrammar`: describes the `CHNK` / `CHNM` / `CHDT`
  sequence and optional metadata chunks such as `CHFF` and `CHFR`.
- `runtimeConstraints`: records SunVox Lib runtime/save compatibility warnings
  and errors that are useful during editing before a build or runtime probe
  fails. These include project/module checks as well as pattern effect
  parameter values that SunVox accepts in the file but clamps at runtime.
- `knowledgeScopes`: records source-backed knowledge that is intentionally in
  or out of codec scope. The first policy tracks `PS_CMD_GET_INFO` module help
  strings as source/user-facing information that should not be copied into the
  codec DB until frontend/manual tooling needs a separate help-text database.
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
template so the editable text contains an `operators` array instead of a long
raw controller list; its custom waveform chunk is decoded as a 256-value
`float32Array`. Module data chunk layouts now cover sampled curves, compact
option structures, and Sampler instrument/sample/envelope records. Analog
generator and Sampler option chunks also record the original chunk byte length
as `dataSize` so SunVox's trailing-zero trimming can round-trip exactly.
Sampler PCM and Vorbis player OGG payloads are treated as known byte payloads
with decoded chunk flags and sample rates where applicable; the raw bytes
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
- fixed-size text budgets such as `SNAM` through both grammar `textSize` and a
  matching `maxUtf8Bytes` runtime constraint

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

Source-aware commands expect the SunVox Lib source fixture at
`var/sunvox_lib/lib_sunvox/psynth/`. Run `sh scripts/install_sunvox_lib.sh` from
the repository root to create it locally. CI uses the same script after restoring
the pinned `var/sunvox_lib-2.1.4d.zip` cache, so local and CI checks inspect the
same archive contents.

```sh
npm run sunvox:inspect -- coverage
npm run sunvox:inspect -- coverage --details
npm run sunvox:inspect -- coverage --json
npm run sunvox:coverage:check
npm run sunvox:fixtures:generate
npm run sunvox:lib:check
npm run sunvox:diff -- before.sunvox after.sunvox
npm run sunvox:metrics
npm run sunvox:inspect -- metrics --json
npm run sunvox:inspect -- report
npm run sunvox:inspect -- report --json
npm run sunvox:enums
npm run sunvox:inspect -- enums --json
npm run sunvox:controller-diff
npm run sunvox:inspect -- controller-diff
npm run sunvox:inspect -- controller-diff --json
npm run sunvox:inspect -- scaffold "Distortion"
npm run sunvox:inspect -- check
npm run sunvox:validate -- music/2022-04-17.sunvox
npm run sunvox:validate:all
npm run sunvox:verify:all
npm run code:metrics
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
  module flags. It also reports `PS_CMD_GET_INFO` source coverage and
  `*_change_ctl_limits()` coverage so dynamic controller range rules stay tied
  back to source declarations.
- `enums` extracts semicolon-delimited enum string candidates from
  `psynth_strings.cpp` and normalizes value names with the same rules used by
  the scaffold generator. The JSON output can be copied into DB review notes or
  used as input for future enum/code generation.
- `controller-diff` compares controller ranges, units, scales, display offsets,
  and source enum value sets against the DB. It is a triage report for deciding
  which declarative source facts should be copied into `database.json`; CI
  expects this report to have no mismatches.
- Controller metadata may include `dynamicLimits` when SunVox source changes a
  controller range based on another controller value, such as Delay/Echo/Loop
  length limits and LFO/Vibrato frequency limits by unit. Static `min`/`max`
  remain aligned with `psynth_register_ctl()`; validation applies the dynamic
  effective range. `dynamicLimits.source` should name the corresponding
  `*_change_ctl_limits()` source function, and `check` fails if source and DB
  drift apart.
- `coverage --json`, `report --json`, and `controller-diff --json` emit
  machine-readable metrics for future CI or frontend tooling.
- `metrics` summarizes coverage, source/DB consistency, controller metadata
  drift, chunk storage review coverage, module data chunk layout review
  coverage, dynamic controller limit source coverage, source-backed pattern
  effect name coverage, source-derived chunk semantic review, validation issue
  counts, and gate status in one compact report for progress tracking. Unnamed
  pattern effect codes are listed as hex values with source line numbers so the
  remaining numeric event fields can be triaged directly from the report.
- `sunvox:coverage:check` runs the coverage report as a CI gate. It fails on
  parse errors, missing DB module types, unexpected missing-STYP modules, raw
  controller arrays, controller extras, module extra chunks, or opaque data
  chunks. Output and empty module slots without `STYP` are reported separately
  and do not fail the gate.
- `sunvox:verify:all` recursively verifies every checked-in `.sunvox` and
  `.sunsynth` sample under `music/`, `instruments/`, `generated/music/`,
  `generated/instruments/`, and `test/fixtures/sunvox/`.
- `sunvox:fixtures:generate` regenerates the synthetic coverage fixture used to
  keep every DB module type represented in the default coverage corpus.
- `sunvox:lib:check` loads checked-in `.sunvox` projects with
  `sv_load_from_memory()` and `.sunsynth` modules with
  `sv_load_module_from_memory()` through the bundled SunVox JS/WASM library. The
  synthetic fixture also verifies that SunVox exposes the expected module slots
  and types, not just that the codec can round-trip the bytes. The check also
  builds small codec-edited variants and verifies through SunVox Lib that edited
  project/module/pattern names, representative controller values, module links,
  and pattern note/controller/effect events are exposed as expected. Edited `.sunvox`
  variants are also saved through SunVox Lib and reloaded to catch runtime
  normalization issues. DB `runtimeConstraints` with `observedBehavior` are
  also probed by writing the documented value, saving through SunVox Lib, and
  checking the saved structured value. Representative controller range probes
  verify that out-of-range controller values are preserved when SunVox Lib does
  not clamp them on load/save. The command prints a compact coverage summary so
  missing edit-behavior checks are visible in the local and CI logs.
- `sunvox:diff` compares two SunVox binaries or decoded JSON documents after
  converting them to structured text. `_...` auxiliary helper fields are ignored
  by default so the output focuses on round-trip-relevant edits. Text output
  groups changes by project, named modules, controller/link sections, module
  data chunks, and named pattern events.
- Typical diff output is grouped by review target:

  ```text
  Module #0 Amp [Amplifier] controllers
    ~ modules[0].controllers.volume: 256 -> 300

  Module #0 Amp [Amplifier] input links
    ~ modules[0].inputs[0].module: 1 -> 2

  Pattern #1 Lead events
    ~ patterns[1].events[3].note: "C4" -> "D4"
  ```

- `sunvox:validate` reports DB-driven runtime compatibility warnings for a
  binary SunVox file or decoded JSON document, including embedded MetaModule
  containers. The first rules cover positive project tempo values, module name
  byte budgets, semantic link targets, controller values outside DB-declared
  ranges or enum values, pattern events that cannot be encoded through the
  DB-declared `textLayout`, and pattern event module references that point
  outside the module list. Validation issues also carry a `trackingIssue` number
  so newly detected warnings can be routed back to the relevant source/DB gap or
  quality tracking issue.
- A clean validation run prints `no validation issues`. Warning paths point to
  editable document fields, so an out-of-range pattern effect parameter is
  reported at a path such as `patterns[0].events[0].parameter.bpm` rather than
  as an opaque chunk offset.
- `sunvox:validate:all` applies the same validation to every checked-in
  `.sunvox` and `.sunsynth` sample, and treats any warning or error as a quality
  gate failure.
- `scaffold <module>` emits a best-effort DB JSON draft for direct
  `psynth_register_ctl()` declarations in the SunVox source. Review unresolved
  expressions and enum names before inserting the output into `database.json`.
- `check` validates structural DB mistakes such as duplicate controller
  indexes, missing enum/bitfield/bitflags references, bitfield field references,
  grammar references to missing chunks or chunks from the wrong scope, invalid
  text layout tuple/position fields, packed text field range overlap, source/DB
  chunk ID drift, data chunk
  index collisions across explicit chunks and ranges, fixed-size text grammar
  fields without matching runtime constraints, source-backed pattern effect enum
  values that no longer appear in `sunvox_handle_command()`, known chunk
  semantic mappings from source review such as `PATN`/`PATT`/`PATL`,
  `SLnK`/`SLnk`, `SVPR`, and `SMI*`, and simple source/DB controller-count
  mismatches.

## Local Quality Loop

Run the combined quality loop before committing codec or DB changes:

```sh
npm run quality
```

The command runs license notice checks, fixture regeneration, GitHub Pages
project-index regeneration, SunVox JS/WASM compatibility, Node tests, SunVox
project metrics, code metrics, DB structure checks, coverage and controller
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

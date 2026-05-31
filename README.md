# SunVox files

## SunVox text codec

The repository includes a reversible JSON codec for `.sunvox` and `.sunsynth`
files. It writes structured documents for `SVOX` and `SSYN` containers:
projects are grouped into `project`, `patterns`, and `modules`; synth files are
grouped into a single `module`. The normal representation uses semantic fields
such as `controllers`, `midiBindings`, `events`, `dataChunks`, and `extraChunks`
instead of retaining a full low-level chunk list in every section. Auxiliary
fields such as `_sourceName`, `_label`, `_comments`, and `_comment` are ignored
when decoding, so notes can be kept in the text file without changing the
generated binary.

The codec uses the machine-readable database under
[tools/sunvox-db](tools/sunvox-db/) to translate module controllers, enums, and
packed bitfields into editable names, and to emit chunks in the canonical order
for each structured scope. The database currently covers all module controller
layouts detected from the bundled SunVox source. MetaModule project payloads
are decoded recursively when they contain an embedded SunVox container;
MetaModule user controller links, options, custom controller names, and user
controller values are decoded into named fields. Those controller links keep
their numeric module/controller references and add auxiliary target module and
controller names when the embedded project makes them available.
Repeated controller layouts can be represented as nested structures; for
example, FMX operators are decoded into an `operators` array instead of a raw
controller list. MultiCtl output slots and response curves are also decoded
when present. MultiSynth, WaveShaper, SpectraVoice, Generator, and Analog
generator module data chunks are decoded into typed arrays or named option
fields where the SunVox source layout is known. Sampler instrument, sample,
option, and envelope chunks are decoded into structured records; sample PCM
bytes remain reversible as `bytesBase64` with decoded format flags. Sound2Ctl
controller values and options are decoded into named fields. Pattern note data
is emitted as sparse `line` / `track` event objects with note names and
auxiliary module names, while the dense binary grid remains round-trip safe.
Module graph links are emitted as editable `inputs` / `outputs` objects with
local `slot`, target `module`, and optional peer `peerSlot` fields instead of
raw parallel link arrays. `inputSlotCount` / `outputSlotCount` are kept only
when needed to preserve empty or trailing SunVox link slots exactly.

```sh
npm run sunvox:encode -- music/2022-04-17.sunvox var/2022-04-17.sunvox.json
npm run sunvox:decode -- var/2022-04-17.sunvox.json var/2022-04-17.sunvox
npm run sunvox:verify -- music/2022-04-17.sunvox
npm run sunvox:outline -- music/2022-04-17.sunvox
npm run sunvox:diff -- before.sunvox after.sunvox
npm run sunsynth:characterize -- instruments/mandel59\ SuperSaw.sunsynth
npm run sunsynth:generate -- --json generated/recipes/sunsynth/supersaw-variants.mjs
npm run sunvox:fixtures:generate
npm run sunvox:metrics
npm run sunvox:enums
npm run site:data:generate
npm run code:metrics
```

`sunvox:outline` prints a human-readable outline of a SunVox/SunSynth file:
project settings, module slots, graph links, patterns, and embedded MetaModule
containers. Link slot metadata is shown as `fromSlot` / `toSlot` so SunVox's
peer slot chunks are not mistaken for extra edges. Use `--json` for
machine-readable output, `--events <count>` to control pattern event previews,
or `--no-embedded` to keep the report shallow.

Example outline excerpt:

```text
SunVox Outline: music\2022-04-17.sunvox

Project
  Name: 2022-04-17 03-24
  BPM/Speed: 125 / 6
  Patterns: 1
  Modules: 9
  Graph: active=9 edges=10 dangling=0

Modules
  #1 SuperSaw [MetaModule] ... dataChunks=15 embedded=1 userControllers=7
  #8 MultiCtl [MultiCtl] ... dataChunks=4

Patterns
  #0 lines=32 tracks=3 events=28 pos=(0,0)
    L000 T0 note=C4 module=#2 DrumSynth
```

`sunvox:diff` compares two SunVox binaries or decoded JSON documents at the
structured text level. By default it ignores `_...` auxiliary helper fields so
the output focuses on round-trip-relevant edits. Text output groups changes by
project, named module/controller/link sections, and named pattern events; use
`--json` for machine-readable change records or `--include-aux` when helper
text should be included.

Example diff excerpt:

```text
SunVox semantic diff
Changes: 3

Module #0 Amp [Amplifier] controllers
  ~ modules[0].controllers.volume: 256 -> 300

Module #0 Amp [Amplifier] input links
  ~ modules[0].inputs[0].module: 1 -> 2

Pattern #1 Lead events
  ~ patterns[1].events[3].note: "C4" -> "D4"
```

`sunsynth:characterize` renders `.sunsynth` files through SunVox Lib with a
fixed probe note and prints the probe parameters together with objective timbre
features: peak/RMS loudness, crest factor, spectral centroid and rolloff,
stereo side-to-mid ratio, attack and release timing, plus coarse tags such as
`dark`, `wide`, or `slow-attack`. Use `--json` for machine-readable reports,
`--note <note|midi>` to change the probe pitch, and `--velocity <1..129>` to
change the trigger velocity. Pass `--probe <note>:<velocity>:<gateSeconds>`
multiple times to compare several input conditions in one run.

`sunsynth:generate` applies JavaScript recipes to `.sunsynth` templates and
writes generated variants. Recipes can use object shorthand for simple edits,
or use the lab API directly for more expressive experiments:
`synth.module("Filter Pro").set(...)`,
`synth.userController("Release").set(...)`, and `sweep(...)` for parameter
grids. This keeps synth experiments scriptable while still writing ordinary
`.sunsynth` files that can be opened by SunVox. Generated drafts and throwaway
experiments should normally go under `var/synth-lab/`. Generated files that are
reviewed and intentionally committed should go under `generated/instruments/`
or `generated/music/`, so they stay separate from human-authored distribution
assets under `instruments/` and `music/`. Human-authored recipes live under
`recipes/`; machine-generated recipes live under `generated/recipes/`. The
bundled
[supersaw-variants recipe](generated/recipes/sunsynth/supersaw-variants.mjs)
shows the function recipe and sweep style.
The [scratch-analog recipe](generated/recipes/sunsynth/scratch-analog.mjs)
shows how to create a small `.sunsynth` from an empty MetaModule project.
The [scratch-layered-pad recipe](generated/recipes/sunsynth/scratch-layered-pad.mjs)
shows a larger scratch-built patch with multiple generators, filter, delay,
compressor, and exposed user controllers.
The
[scratch-assorted-instruments recipe](generated/recipes/sunsynth/scratch-assorted-instruments.mjs)
collects small scratch-built bass, bell, organ, and kick experiments.

The repository uses these data locations:

- `music/`: human-authored `.sunvox` music distributed from the site.
- `instruments/`: human-authored `.sunsynth` instruments distributed from the site.
- `recipes/`: human-authored generation recipes and experiments.
- `generated/recipes/`: committed machine-generated recipes or generated examples.
- `generated/music/`: committed machine-generated `.sunvox` outputs.
- `generated/instruments/`: committed machine-generated `.sunsynth` outputs.
- `var/`: untracked temporary input/output, downloaded archives, and scratch data.

`sunvox:validate` checks DB-backed editability and runtime compatibility rules
without rebuilding the file. It reports paths into the structured document plus
the DB rule ID, source hint, and tracking issue when available. Clean samples
print `no validation issues`; warnings are used for values that can still
round-trip but may be clamped or ignored by SunVox at runtime.

`site:data:generate` builds `site-data/sunvox-projects.json` from checked-in
`.sunvox` and `.sunsynth` files. The GitHub Pages frontend uses this generated
index to show project modules, graph links, patterns, event previews, and
embedded MetaModule containers without decoding binary files in the browser.
The inspector UI is a Vite/React app under [src/](src/) while the SunVox
JS/WASM player bridge remains a small classic script under [js/](js/). Project
files with module positions also render a compact SVG module graph from the
same generated index.

Run the local quality gate before committing codec, DB, or frontend changes:

```sh
npm run quality
```

The quality gate includes SunVox Lib compatibility checks for both checked-in
sample files and small codec-edited variants, so representative text edits are
verified against the runtime API as well as byte-level round-trips. These checks
cover project, module, pattern, controller, module link, pattern note,
pattern controller, pattern effect edits, SunVox Lib save/reload compatibility,
DB-driven validation warnings, regenerated GitHub Pages project index data, and
code-size metrics across checked-in samples and local tooling.

### SunVox Lib Fixtures

Source-aware codec checks use files extracted from the pinned SunVox Lib
archive. For local development, run:

```sh
sh scripts/install_sunvox_lib.sh
```

The script downloads `sunvox_lib-2.1.4d.zip` into `var/`, verifies its SHA-256,
extracts runtime JS and license files under `sunvox_lib/`, and extracts the
source files used by DB inspection under `var/sunvox_lib/`.

CI follows the same path. GitHub Actions caches only the pinned zip archive by
version and SHA-256, then reruns the install script so extracted source files are
always regenerated from the verified archive.

## Licenses

### Instruments under [instruments/](instruments/) and [generated/instruments/](generated/instruments/)

Created or generated by Ryusei Yamaguchi (@mandel59).

Distributed under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

### Music under [music/](music/) and [generated/music/](generated/music/)

Music by or generated by Ryusei Yamaguchi (@mandel59).

Distributed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

### The SunVox Library

This repository contains the SunVox library.

[sunvox_lib/sunvox_lib/docs/license/LICENSE.txt](sunvox_lib/sunvox_lib/docs/license/LICENSE.txt)
This license applies to the library files under
[sunvox_lib](sunvox_lib/).

> Powered by SunVox (modular synth & tracker)  
> Copyright (c) 2008 - 2026, Alexander Zolotov \<nightradio@gmail.com>, WarmPlace.ru

The GitHub Pages frontend links to the SunVox library license and the required
third-party license text files from the deployed page.

Run `npm run licenses:check` to verify that the source frontend includes the
required SunVox notice and links every TXT file under
`sunvox_lib/sunvox_lib/docs/license/`. After `npm run build`, run
`npm run licenses:check:dist` to verify that the GitHub Pages output keeps the
same notice and copied license files.

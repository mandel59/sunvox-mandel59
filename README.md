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
npm run sunvox:fixtures:generate
npm run sunvox:metrics
```

`sunvox:outline` prints a human-readable outline of a SunVox/SunSynth file:
project settings, module slots, graph links, patterns, and embedded MetaModule
containers. Link slot metadata is shown as `fromSlot` / `toSlot` so SunVox's
peer slot chunks are not mistaken for extra edges. Use `--json` for
machine-readable output, `--events <count>` to control pattern event previews,
or `--no-embedded` to keep the report shallow.

Run the local quality gate before committing codec, DB, or frontend changes:

```sh
npm run quality
```

The quality gate includes SunVox Lib compatibility checks for both checked-in
sample files and small codec-edited variants, so representative text edits are
verified against the runtime API as well as byte-level round-trips. These checks
cover project, module, pattern, controller, module link, pattern note/controller
event edits, and SunVox Lib save/reload compatibility.

## Licenses

### Instruments under [instruments/](instruments/)

Created by Ryusei Yamaguchi (@mandel59).

Distributed under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

### Music under [music/](music/)

Music by Ryusei Yamaguchi (@mandel59).

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

Run `npm run licenses:check` to verify that the frontend includes the required
SunVox notice and links every TXT file under
`sunvox_lib/sunvox_lib/docs/license/`.

# SunVox Codec Database

This directory contains machine-readable codec knowledge extracted from the
SunVox library source. The database is intentionally declarative so the codec
can either interpret it directly or generate conversion code from it later.

## MVP Scope

- `chunks`: maps chunk IDs to labels, scopes, and payload types.
- `enums`: maps stored numeric values to editable names.
- `bitfields`: describes packed integer fields such as `CMID`.
- `bitflags`: maps stored flag bits to sparse named objects.
- `structs`: describes fixed-size record arrays such as pattern notes and MIDI
  bindings.
- `grammar`: maps semantic object paths to chunk IDs and emit order.
- `modules`: describes module-specific controller layouts and data chunk
  layouts. Controller definitions can use `path` for nested semantic output and
  `repeat` for repeated layouts such as FMX operators.

The initial database covers the chunk labels already used by the codec,
project/pattern/module chunk order, project/pattern/module flag bits, `CMID`
MIDI binding bitfields, and the core
`MetaModule` controllers. It also identifies the first `MetaModule` data chunk
as an embedded SunVox container, allowing the codec to recurse into it instead
of keeping that payload as opaque base64. Additional `MetaModule` data chunk
definitions describe user controller links, options, and custom controller
names through reusable layout types such as `packedUInt32Array`, `struct`,
`recordArray`, and `string`. Controller metadata now covers common generators
and effects including FMX, Analog generator, Filter Pro, Delay, Echo, Glide,
Modulator, WaveShaper, MultiSynth, MultiCtl, Sound2Ctl, and several utility
modules. FMX uses a repeated operator template so the editable text contains an
`operators` array instead of a long raw controller list.

## Round-Trip Policy

The database may add names and structure, but it must not be the only copy of
unknown data. The structured text keeps `extraChunks` and module `dataChunks`
where needed, so unknown or not-yet-modeled chunks can still round-trip without
loss.
Modeled properties are emitted without a leading underscore. Leading underscore
properties are reserved for auxiliary comments, labels, and source metadata that
do not affect the generated binary.

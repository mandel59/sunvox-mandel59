# SunVox Codec Database

This directory contains machine-readable codec knowledge extracted from the
SunVox library source. The database is intentionally declarative so the codec
can either interpret it directly or generate conversion code from it later.

## MVP Scope

- `chunks`: maps chunk IDs to labels, scopes, and payload types.
- `enums`: maps stored numeric values to editable names.
- `bitfields`: describes packed integer fields such as `CMID`.
- `grammar`: maps semantic object paths to chunk IDs and emit order.
- `modules`: describes module-specific controller layouts.

The initial database covers the chunk labels already used by the codec,
project/pattern/module chunk order, `CMID` MIDI binding bitfields, and the core
`MetaModule` controllers. It also identifies the first `MetaModule` data chunk
as an embedded SunVox container, allowing the codec to recurse into it instead
of keeping that payload as opaque base64.

## Round-Trip Policy

The database may add names and structure, but it must not be the only copy of
unknown data. The structured text keeps `extraChunks` and module `dataChunks`
where needed, so unknown or not-yet-modeled chunks can still round-trip without
loss.
Modeled properties are emitted without a leading underscore. Leading underscore
properties are reserved for auxiliary comments, labels, and source metadata that
do not affect the generated binary.

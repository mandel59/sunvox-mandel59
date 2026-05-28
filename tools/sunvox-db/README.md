# SunVox Codec Database

This directory contains machine-readable codec knowledge extracted from the
SunVox library source. The database is intentionally declarative so the codec
can either interpret it directly or generate conversion code from it later.

## MVP Scope

- `chunks`: maps chunk IDs to labels, scopes, and payload types.
- `enums`: maps stored numeric values to editable names.
- `bitfields`: describes packed integer fields such as `CMID`.
- `modules`: describes module-specific controller layouts.

The initial database covers the chunk labels already used by the codec,
`CMID` MIDI binding bitfields, and the core `MetaModule` controllers.

## Round-Trip Policy

The database may add names and structure, but it must not be the only copy of
unknown data. The structured text keeps raw chunk entries where needed, so
unknown or not-yet-modeled chunks can still round-trip without loss.
Modeled properties are emitted without a leading underscore. Leading underscore
properties are reserved for auxiliary comments, labels, and source metadata that
do not affect the generated binary.

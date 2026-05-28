# SunVox files

## SunVox text codec

The repository includes a reversible JSON codec for `.sunvox` and `.sunsynth`
files. It writes an editable chunk list for `SVOX` and `SSYN` containers:
projects are grouped into `project`, `patterns`, and `modules`; synth files are
grouped into a single `module`. Known chunks use compact fields such as
`value`, `text`, `rgb`, `values`, `midiBindings`, and `events`; unknown binary
chunks use `base64`. Auxiliary fields such as `_sourceName`, `_label`,
`_comments`, and `_comment` are ignored when decoding, so notes can be kept in
the text file without changing the generated binary.

The codec uses the machine-readable database under
[tools/sunvox-db](tools/sunvox-db/) to translate module controllers, enums, and
packed bitfields into editable names.

```sh
npm run sunvox:encode -- music/2022-04-17.sunvox var/2022-04-17.sunvox.json
npm run sunvox:decode -- var/2022-04-17.sunvox.json var/2022-04-17.sunvox
npm run sunvox:verify -- music/2022-04-17.sunvox
```

## Licenses

### Instruments under [instruments/](instruments/)

Created by Ryusei Yamaguchi (@mandel59).

Distributed under [CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/).

### Music under [music/](music/)

Music by Ryusei Yamaguchi (@mandel59).

Distributed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/).

### The SunVox Library

This repository contains the SunVox library.

[js/sunvox_lib/license/LICENSE.txt](js/sunvox_lib/license/LICENSE.txt) This license applies to the library files under [sunvox_lib](js/sunvox_lib/).

> Powered by SunVox (modular synth & tracker)  
> Copyright (c) 2008 - 2024, Alexander Zolotov \<nightradio@gmail.com>, WarmPlace.ru

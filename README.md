# SunVox files

## Licenses

## SunVox text codec

The repository includes a reversible JSON codec for `.sunvox` and `.sunsynth`
files. It preserves the binary container as `SVOX` or `SSYN` chunks with
base64-encoded payloads and SHA-256 checksums.

```sh
npm run sunvox:encode -- music/2022-04-17.sunvox var/2022-04-17.sunvox.json
npm run sunvox:decode -- var/2022-04-17.sunvox.json var/2022-04-17.sunvox
npm run sunvox:verify -- music/2022-04-17.sunvox
```

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

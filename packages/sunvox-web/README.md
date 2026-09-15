# @mandel59/sunvox-web

ESM glue for playing SunVox projects and SunSynth instruments in web applications.
Each `createSunVoxPlayer()` owns an independent Worker, AudioContext and AudioWorklet.
Importing the package does not start audio or modify the DOM or browser globals.
Includes TypeScript declarations. No dependencies or package build step.

## Install

In this repository, `npm install` links the workspace. For another project:

```sh
npm pack --workspace @mandel59/sunvox-web
# In the consuming project, adjust the tarball path:
npm install /path/to/mandel59-sunvox-web-0.1.0.tgz
```

## Use

Supply `sunvox.js`, `sunvox_lib_loader.js` and `sunvox.wasm` in one served directory.
The SunVox runtime is not included. This repository's
`sh scripts/install_sunvox_lib.sh` installs the tested runtime, 2.1.4d.

```js
import { createSunVoxPlayer } from "@mandel59/sunvox-web";

const player = createSunVoxPlayer({
  runtimeBaseUrl: new URL("./sunvox/", location.href),
  onStateChange: (state) => console.log(state),
  onStatus: (message) => console.log(message),
});

document.querySelector("#play").addEventListener("click", async () => {
  await player.loadAndPlay("./music/example.sunvox");
});
document.querySelector("#stop").addEventListener("click", () => player.stopPlayback());
// When unmounting: player.dispose();
```

Use HTTPS or localhost, with playback initiated from a user gesture.
Requires AudioWorklet and classic Web Workers. Default worker/worklet URLs are
relative to the package module using `new URL(..., import.meta.url)`; Vite emits
both assets. For other bundlers, copy exported `@mandel59/sunvox-web/worker` and
`@mandel59/sunvox-web/worklet` to a static directory and supply their served URLs
as `workerUrl` and `workletUrl`. Keep the worker classic: it uses `importScripts`.
Serve the worker from the app origin. For unbundled ESM, serve `src/` intact and
import `src/index.js` directly.

`runtimeBaseUrl` is required. `resourceBaseUrl` defaults to the page URL and
resolves relative project/synth paths and asset overrides. Runtime and resource
hosting must be compatible with your CORS, CSP and isolation configuration.

SharedArrayBuffer is used when cross-origin isolation is enabled; otherwise
MessagePort audio chunks are used. To enable isolation serve the page with:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## API

- `initialize()` starts/resumes audio lazily; playback methods call it automatically.
- `loadAndPlay(url)`, `preloadProject(url)`, `playLoadedProject()`, `stopPlayback()`.
- `preloadSynth(url)`, `playSynthNote(url, note, velocity = 128, track = note)`,
  `stopSynthNote(note, track = note)`, `stopInstrumentNotes()`.
- `setSynthController(url, controllerIndex, value)` and
  `configureSynthControllers(url, controllers)` with `{ controllerIndex, value }`
  entries; configuration requires an initialized player.
- `setMasterVolume(value)` and `getMasterVolume()`: integer 0-256, default 256.
- `getPlayerState()` returns a snapshot; `getAudioTransportState()` reports transport.
- `dispose()` permanently releases resources. Create a new instance to restart.
- Callbacks: `onStateChange`, `onStatus`, `onLog(level, message)`, `onReady`.

Notes use zero-based semitone numbers, tracks wrap to 0-31, velocity is 1-129.
Four synth slots are cached. Boolean-returning methods return false for command
failures; initialization errors reject. `loadAndPlay` and `playLoadedProject`
reject on command failure. See `src/index.d.ts` for result types.

## Licensing and distribution

This extraction does not grant a new license to existing glue code; the package
is marked `UNLICENSED` pending an explicit distribution license. SunVox and its
third-party components have separate licenses. Retain required runtime notices
and license files when deploying, as the example site does. Packing and workspace
installation do not publish to npm.

## Verify

```sh
npm test --workspace @mandel59/sunvox-web
npm pack --workspace @mandel59/sunvox-web --dry-run
```

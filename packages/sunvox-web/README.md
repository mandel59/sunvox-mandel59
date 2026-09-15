# @mandel59/sunvox-web

ESM glue for SunVox playback and low-level engine access in web applications.
`createSunVoxEngine()` provides 83 asynchronous `sv_*` methods with native numbering.
Each Engine owns a Worker and its audio output. A Player is a high-level facade
over that Engine; it can borrow an existing Engine or create one internally.
Importing the package does not start audio or modify the DOM or browser globals.
Includes TypeScript declarations. No dependencies or package build step.

Use **Player** for URL-based playback, **Engine** for low-level operations, or
combine them by passing `{ engine }` to `createSunVoxPlayer`.

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

For the shared Engine output, SharedArrayBuffer is used when cross-origin isolation is enabled; otherwise
MessagePort audio chunks are used. To enable isolation serve the page with:

```text
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

## Player API

- `initialize()` starts/resumes audio lazily; playback methods call it automatically.
- `loadAndPlay(url)`, `preloadProject(url)`, `playLoadedProject()`, `stopPlayback()`.
- `preloadSynth(url)`, `playSynthNote(url, note, velocity = 128, track = note)`,
  `stopSynthNote(note, track = note)`, `stopInstrumentNotes()`.
- `setSynthController(url, controllerIndex, value)` and
  `configureSynthControllers(url, controllers)` with `{ controllerIndex, value }`
  entries; configuration requires an initialized player.
- `setMasterVolume(value)` and `getMasterVolume()`: integer 0-256, default 256.
- `getPlayerState()` returns a snapshot; `getAudioTransportState()` reports transport.
- `await dispose()` closes the Player-owned slots. An injected Engine survives;
  an Engine created internally by the Player is disposed with it.
- Callbacks: `onStateChange`, `onStatus`, `onLog(level, message)`, `onReady`.

Notes use zero-based semitone numbers, tracks wrap to 0-31, velocity is 1-129.
Four synth slots are cached. Boolean-returning methods return false for command
failures; initialization errors reject. `loadAndPlay` and `playLoadedProject`
reject on command failure. See `src/index.d.ts` for result types.

## Combining Player and Engine

```js
import { createSunVoxEngine, createSunVoxPlayer } from "@mandel59/sunvox-web";

const engine = createSunVoxEngine({ runtimeBaseUrl: "/sunvox/" });
const player = createSunVoxPlayer({ engine });

// In a click handler:
await player.loadAndPlay("/music/example.sunvox");
const slot = player.getProjectSlot();
await engine.sv_set_song_name(slot, "Edited in the browser");
const module = await engine.sv_new_module(slot, "Generator", "Lead", 256, 256, 0);
await engine.sv_connect_module(slot, module, 0);
const bytes = await engine.sv_save_to_memory(slot);

await player.dispose(); // closes only this Player's six slots
await engine.sv_open_slot(slot); // the same Engine remains usable
engine.dispose(); // caller owns the injected Engine and its audio output
```

For a standalone Player, the shorter form still works:

```js
const player = createSunVoxPlayer({ runtimeBaseUrl: "/sunvox/" });
const engine = player.engine; // the exact Engine used by this Player
// ...mix player operations and engine editing as above...
await player.dispose(); // also disposes its internally created Engine
```

### Slot and resource ownership

- One Player per Engine. Await Player disposal before attaching a replacement.
- `slotBase` defaults to 0 and must be 0..10. The Player reserves six consecutive
  slots: project, staging, and four cached instruments. `getSlotLayout()` returns
  their numbers. Slots open lazily on initialization; overlap with already open
  Engine slots is rejected without closing the existing slots.
- `getProjectSlot()` returns the designated project slot. After `preloadSynth(url)`,
  `await getSynthSlot(url)` returns `{ slot, moduleIndex }` or null. Cached synth
  references can become stale on eviction/replacement; query again after loading
  other instruments. Returned objects are snapshots.
- On Player slots, module/pattern edits, controllers, queries and saving are
  allowed through Engine. Opening/closing the slot, replacing the whole project,
  and transport operations (play/stop/pause/resume/rewind/autostop) are rejected;
  use Player's lifecycle/transport methods. Deleting a cached instrument's root
  module is also rejected. These checks apply to `call()` and `batch()` alike.
- Other Engine slots remain available for independent playback/editing. Call
  `engine.startAudio()` when the Engine should maintain continuous output;
  Player stop/disposal then leaves that output and other slots running.
- `player.setMasterVolume()` controls the **shared output gain**, including other
  Engine slots. Use `engine.sv_volume()` for individual slot volumes. Disposing
  an injected Player does not reset output gain or close the shared AudioContext.
- `engine.stopAudio()` disconnects all output; the next Player playback operation
  reconnects it. `engine.dispose()` invalidates the attached Player and rejects
  its pending requests. `player.dispose()` is asynchronous so callers can wait
  until slot release is complete; an in-flight Player fetch is aborted.
- Configure runtime/worker/sample-rate options on Engine when injecting it.
  Player's resource URLs inherit Engine's `resourceBaseUrl`, unless overridden.

Player preparation does not wait for autoplay permission. A suspended audio
context is retried on later calls, allowing background instrument preloading
before a user clicks to play.

## Low-level engine API

An Engine alone reserves no slots, creates no modules or connections automatically,
and does not clamp/translate note or module numbers. Attaching a Player reserves
six slots on that same Engine. High- and low-level calls then share one command
transport, runtime and audio output.

```js
import { createSunVoxEngine, NOTECMD_NOTE_OFF } from "@mandel59/sunvox-web";

const engine = createSunVoxEngine({
  runtimeBaseUrl: new URL("./sunvox/", location.href),
  sampleRate: 44100, // optional; 44100..192000
});
await engine.sv_open_slot(0); // All methods initialize lazily.
const moduleNumber = await engine.sv_new_module(0, "Generator", "Lead", 256, 256, 0);
if (moduleNumber < 0) throw new Error(`Module creation failed: ${moduleNumber}`);
await engine.sv_connect_module(0, moduleNumber, 0);

document.querySelector("#play").addEventListener("click", async () => {
  await engine.startAudio(); // call directly from a user gesture
  // Native note values: 1 = C0; event module field is module number + 1.
  await engine.sv_send_event(0, 0, 61, 128, moduleNumber + 1, 0, 0);
});
document.querySelector("#stop").addEventListener("click", async () => {
  await engine.sv_send_event(0, 0, NOTECMD_NOTE_OFF, 0, 0, 0, 0);
});
// When finished: engine.dispose();
```

The 83 methods cover slots, memory loading/saving, transport, events, song
metadata, module creation/connections/properties/controllers, samples,
MetaModule/Vorbis Player loading, curves, patterns, meters and diagnostics.
See [engine.d.ts](src/engine.d.ts) for the complete typed API and
[engine-api.js](src/engine-api.js) for its call signatures.
Native note commands, init flags, module flags and time-map flags are exported
using their `NOTECMD_*` / `SV_*` names. Init flags are reference constants;
the engine manages its own audio flags.

### Execution model: an asynchronous Worker API

This object is an RPC proxy, not a synchronous native binding. Every `sv_*` call
returns a Promise and executes in the dedicated Worker. Application code can
call it from the main thread, but synchronous code using the original library
must be adapted to `await` results:

```js
const moduleNumber = await engine.sv_new_module(0, "Generator", "Lead", 0, 0, 0);
await engine.sv_connect_module(0, moduleNumber, 0);
```

Each await-dependent call crosses the worker boundary. Use `batch()` for known,
independent arguments to reduce round trips; it cannot reference previous batch
results or execute application callbacks inside the Worker. A synchronous
in-thread binding is not included.

### Calls, errors and ownership

- Use `await engine.sv_*(...)` or `await engine.call("sv_*", ...args)`.
- Native numeric return values are preserved, including negative errors and
  lookup-not-found values. Check each function's documented result. Transport,
  argument-validation, Player ownership, initialization and allocation errors reject the Promise.
- `Uint8Array`, `Int32Array`, strings and null results are preserved. Arrays are
  snapshots, never live views of WASM memory. Input arrays are copied when the
  method is called; the caller retains ownership and may reuse them immediately.
- Calls are serialized in the Worker. Required slot locks are applied internally.
- `initialize()` returns `{ version, sampleRate, channels }`. `config` passes a
  native configuration string. No AudioContext is required for offline operations.
- `dispose()` terminates the Worker, releases its WASM instance, closes browser
  audio and rejects pending requests. Disposal and initialization failure are
  terminal; create a new engine to restart.

### Memory I/O and editing

```js
const bytes = new Uint8Array(await file.arrayBuffer());
await engine.sv_load_from_memory(0, bytes);
const pattern = await engine.sv_new_pattern(0, -1, 0, 0, 1, 16, 0, "Notes");
await engine.batch([
  { method: "sv_set_pattern_event", args: [0, pattern, 0, 0, 61, 128, moduleNumber + 1, 0, 0] },
  { method: "sv_set_pattern_name", args: [0, pattern, "Sequence"] },
]);
const saved = await engine.sv_save_to_memory(0); // Uint8Array | null
```

A batch validates all calls before executing, locks slots that require it in
ascending order, executes without render interleaving and releases locks in
`finally`. It is not a rollback transaction: earlier effects remain if a later
call throws. Negative native results remain in the results array and do not stop
the batch. Open/close slot and memory loading/saving operations must be called
outside a batch. Dependent calls that need an earlier result use separate awaits.

### Buffer operations and audio

Output-buffer methods return data instead of mutating a buffer on the main thread:

| Method | Arguments / return value |
| --- | --- |
| `sv_get_time_map(slot, start, length, flags)` | `{ result, data: Uint32Array }` |
| `sv_get_module_scope2(slot, module, channel, count)` | `{ result, data: Int16Array }`; data contains received samples |
| `sv_module_curve(slot, module, curve, buffer, length, write)` | `{ result, data: Float32Array }`; length 0 uses buffer length |
| `render(frames, { input?, latency?, time? })` | `{ result, data: Float32Array }`; interleaved stereo |

Explicit buffer lengths are limited to 1,048,576 items (render: frames); allocate
and process longer results in chunks. `render()` accepts optional interleaved
stereo Float32 input, enabling the Input module. It advances the engine's audio
state and returns PCM without sending it to the speakers. `time` uses SunVox
ticks and defaults to `sv_get_ticks()`; pass explicit timestamps for scheduled
offline events. `latency` defaults to 0.

`startAudio()` creates an AudioContext/AudioWorklet and continuously renders via
SharedArrayBuffer when isolated, or MessagePort otherwise; isolation is optional. `stopAudio()` disconnects
output without stopping/rewinding slots, so their state can then be rendered
offline. Explicit `render()` is rejected while browser audio is running. The
engine uses stereo Float32, user audio callback and one-thread flags. Other
native audio formats and direct hardware input management are not exposed;
`sv_init`, `sv_deinit`, lock/unlock and audio callbacks are managed by the engine.
For microphone capture, supply PCM through `render()`; microphone acquisition
and live input routing are not implemented.

The asset exports `@mandel59/sunvox-web/engine-worker` and `/worker` are aliases
for the same unified Worker. With other bundlers, copy either and `/worklet` to
your static directory and set Engine `workerUrl` / `workletUrl`. Vite handles
default relative asset URLs. Replace both the JS client and Worker when upgrading;
the earlier separate Worker protocol is not supported.

The engine corrects bugs in the supplied 2.1.4d JS wrapper: the lost config
pointer in `sv_init`, the missing return in `sv_set_song_name`, the missing `line`
argument in `sv_get_pattern_event`; it also calls `_sv_sampler_par` instead of the
wrapper's nonexistent `_sv_sampler_set`. Upstream files are left unchanged.

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
# From the repository root, with browser-debug dependencies installed:
node tools/browser-debug/check-engine.mjs
node tools/browser-debug/check-engine.mjs --isolation
```

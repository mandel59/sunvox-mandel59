# Browser debug package

This package keeps Playwright-based browser debugging separate from the main
site dependencies.

## Setup

```sh
npm run browser:debug:install
```

The scripts prefer Playwright's bundled Chromium, then fall back to the local
Microsoft Edge channel. Use `npx playwright install` inside this directory when
you want the bundled browser binaries.

## Commands

```sh
npm run browser:check
npm run browser:check:headed
npm run browser:check:playback
npm run browser:check:playback:headed
npm run browser:check:synth
npm run browser:check:synth:headed
npm run browser:check:synth:mobile
npm run browser:check:synth:mobile:headed
npm run browser:check:dev
```

`browser:check` serves the existing `dist/` directory with a small Node HTTP
server, opens the Pages inspector, selects `music/2022-04-17.sunvox`, and checks
the module graph, pattern list, module list, license links, browser console
errors, and representative browser synth playback paths. The playback check
covers `mandel59 shepard`, `Scratch Acid Bass`, and `Scratch FMX Tines`, and
verifies their note/controller calls against the browser SunVox wrapper.

`browser:check:dev` starts the Vite dev server in-process before running the
same checks. It is useful outside restricted sandboxes, but Vite may spawn
helper processes while loading the config.

In dev, local scratch files can be previewed without adding them to the deploy
target by opening the app with `?previewRoots=var/synth-lab`. Set
`SUNVOX_DEV_ROOTS` to a semicolon-separated list to add persistent local
preview roots.

The screenshot is written under `var/browser-debug`, which is ignored by git.

In the Codex Windows shell sandbox, Playwright may fail with `spawn EPERM`
because it launches an external browser process. Run the command outside that
sandbox when you need this package-level check. The Codex in-app Browser plugin
can still inspect localhost pages.

`check:playback` can take an optional project path argument. Omitting it defaults to
`music/2022-04-17.sunvox`. `check:synth` can take an optional `.sunsynth` path
and verifies that `preloadSynth()` + `playSynthNote()` produce non-zero
AudioWorklet output. `check:synth:mobile` opens the app with an iPhone viewport,
selects a synth through the permalink hash, taps the on-screen keyboard, and
verifies both the `playSynthNote()` call and non-zero AudioWorklet output.

To measure uninterrupted music playback, use a server with COOP/COEP (such as
`npm run cloudflare:dev`) and a bundled Firefox or Chromium installation:

```sh
node tools/browser-debug/check-audio-continuity.mjs --browser=firefox --url=http://127.0.0.1:8787/ --seconds=125 --interval-ms=16
node tools/browser-debug/check-audio-continuity.mjs --browser=chromium --url=http://127.0.0.1:8787/ --seconds=125 --interval-ms=32
node tools/browser-debug/check-audio-continuity.mjs --browser=firefox --seconds=125 --no-worker-probe
```

The default project is Midnight Loop Line; `--project=path` selects another.
The default URL is the production Cloudflare site. This probe reads shared
audio underrun/dropped-frame counters and requires audio to advance in real
time after a 250 ms startup period. It fails on any later underrun, dropped
frame or browser error. By default it leaves the Worker response unchanged
and reads only shared counters. `--worker-probe` inserts timer-gap/render-duration
instrumentation only in the test's Worker response; `--interval-ms` also enables
that instrumentation and deliberately delays the render timer. `--no-worker-probe`
explicitly disables response instrumentation (use this for production Firefox checks).
`--executable=/path/to/firefox` can select an existing Playwright-compatible
browser binary. Browser version and metrics are printed as JSON; save logs
under `var/` and avoid rebuilding the served `dist/` during the measurement.

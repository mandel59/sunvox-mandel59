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

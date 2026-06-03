# Tech Stack

- Node package, ESM (`package.json` has `type: module`).
- Frontend: Vite 7, React 19, `@vitejs/plugin-react`; Vite config is `tools/vite.config.mjs`, output is `dist/`, base is `PAGES_BASE_PATH || './'`.
- Browser SunVox runtime: classic scripts under `js/`, type declarations under `js/@types/`.
- CLI/tools/tests: Node `.mjs`, built-in `node:test`, no TypeScript compile step; `.d.ts` files document public tool/recipe APIs.
- SunVox fixture: pinned `sunvox_lib-2.1.4d.zip` downloaded to `var/` by `scripts/install_sunvox_lib.sh`; extracted source fixture under `var/sunvox_lib/`, runtime/license files under `sunvox_lib/`.
- CI uses Node 24, `npm ci`, installs SunVox Lib from original URL plus cache, then runs license, lib compatibility, tests, DB checks, verify, build, and dist license checks.
- Version control is jujutsu (`jj`), not plain git workflow.
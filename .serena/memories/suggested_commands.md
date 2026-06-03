# Suggested Commands

- Install deps: `npm ci`.
- Dev server: `npm run dev`.
- Build Pages app: `npm run build`.
- Preview built app: `npm run preview`.
- Full local quality gate: `npm run quality`.
- Full tests: `npm test`.
- Generate site index: `npm run site:data:generate`.
- SunVox codec: `npm run sunvox:encode -- <input.sunvox> <out.json>`, `npm run sunvox:decode -- <input.json> <out.sunvox>`, `npm run sunvox:verify -- <file>`.
- Outline/diff: `npm run sunvox:outline -- <file>`, `npm run sunvox:diff -- <before> <after>`.
- API audit: `npm run sunvox:api-audit -- --check`.
- Render/debug: `npm run sunvox:render-debug -- --mode both <file.sunsynth>`.
- Characterize synth: `npm run sunsynth:characterize -- <file.sunsynth>`.
- Recipe generation: `npm run sunvox:edit-recipe -- --out <dir> <recipe.mjs>`.
- SunVox Lib fixture install: `sh scripts/install_sunvox_lib.sh`.
- Windows shell: prefer PowerShell-native commands; quote jj revsets like `jj log -r '@-'` because bare `@-` is parsed by PowerShell.
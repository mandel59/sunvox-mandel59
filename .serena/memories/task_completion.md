# Task Completion

- For most code changes run `npm test` at minimum.
- For codec/DB/SunVox semantic changes also run relevant focused checks, commonly:
  - `npm run sunvox:api-audit -- --check` for API-boundary work.
  - `npm run sunvox:inspect -- check`, `npm run sunvox:controller-diff`, `npm run sunvox:coverage:check` for DB changes.
  - `npm run sunvox:verify:all` for codec round-trip changes.
  - `npm run sunvox:lib:check` for runtime compatibility changes.
- For frontend/data changes run `npm run site:data:generate`, `npm run build`, and inspect with browser tooling when visual behavior matters.
- For license/UI deployment changes run `npm run licenses:check` and after build `npm run licenses:check:dist`.
- Before final response, verify `jj status` is clean or clearly report remaining changes.
- Commit completed work with `jj commit -m ...`; do not push unless the user asks.
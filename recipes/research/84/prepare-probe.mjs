import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { gzipSync } from "node:zlib";

const directory = resolve("var/issue-84/probe");
const bytes = Buffer.from("SVOX issue 84 encoding probe\n".repeat(128));
await mkdir(resolve(directory, "assets"), { recursive: true });
await writeFile(resolve(directory, "assets/test.sunvox"), bytes);
await writeFile(resolve(directory, "assets/test.sunvox.gz"), gzipSync(bytes));
await writeFile(resolve(directory, "wrangler.json"), `${JSON.stringify({
  name: "sunvox-issue-84-encoding-probe",
  main: resolve("recipes/research/84/encoding-probe.mjs"),
  compatibility_date: "2026-10-12",
  workers_dev: true,
  preview_urls: false,
  vars: { CLIENT_ACCEPT_ENCODING_HEADER: "X-Sunvox-Client-Accept-Encoding" },
  assets: { directory: "assets", binding: "ASSETS", run_worker_first: true },
}, null, 2)}\n`);
console.log(`Prepared isolated probe config: ${resolve(directory, "wrangler.json")}`);

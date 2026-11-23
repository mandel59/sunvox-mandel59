import { cp, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";

import { writeSiteData } from "./generate-site-data.mjs";

import { buildGeneratedAssets, GENERATED_MANIFEST_DIRECTORY } from "./build-generated-assets.mjs";
import { compressSunVoxAssets } from "./compress-assets.mjs";

const root = process.cwd();
const outDir = resolve(root, "dist");
const manifestDirectory = resolve(root, GENERATED_MANIFEST_DIRECTORY);
const staticDirectories = ["js", "music", "instruments", "generated", "sunvox", "sunvox_lib", "site-data"];

const manifest = await buildGeneratedAssets({ ifMissing: true });
await writeSiteData();

await build({
  configFile: resolve(root, "tools/vite.config.mjs"),
});

await Promise.all(
  staticDirectories.map((directory) =>
    cp(resolve(root, directory), resolve(outDir, directory), {
      recursive: true,
      filter: (source) => source !== manifestDirectory,
    }),
  ),
);
await writeFile(resolve(outDir, "generated/manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

await compressSunVoxAssets(outDir);
await writeFile(resolve(outDir, "_headers"), "/*\n  Cross-Origin-Opener-Policy: same-origin\n  Cross-Origin-Embedder-Policy: require-corp\n");

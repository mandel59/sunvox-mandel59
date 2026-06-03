import { cp } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "vite";

import { writeSiteData } from "./generate-site-data.mjs";

const root = process.cwd();
const outDir = resolve(root, "dist");
const staticDirectories = ["js", "music", "instruments", "generated", "sunvox", "sunvox_lib", "site-data"];

await writeSiteData();

await build({
  configFile: resolve(root, "tools/vite.config.mjs"),
});

await Promise.all(
  staticDirectories.map((directory) =>
    cp(resolve(root, directory), resolve(outDir, directory), {
      recursive: true,
    }),
  ),
);

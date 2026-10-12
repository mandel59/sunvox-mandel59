import { readFile, readdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import { gzip } from "node:zlib";

const gzipAsync = promisify(gzip);

export async function compressSunVoxAssets(directory) {
  const results = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) results.push(...await compressSunVoxAssets(path));
    else if (/\.(sunvox|sunsynth)$/u.test(entry.name)) {
      const raw = await readFile(path);
      const compressed = await gzipAsync(raw, { level: 9 });
      if (compressed.length < raw.length) {
        await writeFile(`${path}.gz`, compressed);
        results.push({ path, bytes: raw.length, gzipBytes: compressed.length });
      } else {
        await rm(`${path}.gz`, { force: true });
      }
    }
  }
  return results;
}

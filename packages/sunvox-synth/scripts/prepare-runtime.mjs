import { cp, mkdir, access } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve, join } from "node:path";

const source = process.env.SUNVOX_LIB_DIR
  ? resolve(process.env.SUNVOX_LIB_DIR)
  : fileURLToPath(new URL("../../../sunvox_lib/sunvox_lib/", import.meta.url));
// Resolve relative to the package, not the scripts directory.
const output = fileURLToPath(new URL("../", import.meta.url));
const destination = join(output, "public", "sunvox_lib");
try {
  for (const file of ["sunvox.js", "sunvox_lib_loader.js", "sunvox.wasm"]) {
    await access(join(source, "js", "lib", file));
  }
  await access(join(source, "docs", "license", "LICENSE.txt"));
} catch {
  throw new Error("SunVox runtime not found. Run sh scripts/install_sunvox_lib.sh from the repository root, or set SUNVOX_LIB_DIR to a sunvox_lib directory containing js/lib and docs/license.");
}
await mkdir(destination, { recursive: true });
for (const file of ["sunvox.js", "sunvox_lib_loader.js", "sunvox.wasm"]) {
  await cp(join(source, "js", "lib", file), join(destination, file));
}
await cp(join(source, "docs", "license"), join(destination, "license"), { recursive: true });
console.log("Prepared SunVox runtime and license notices.");

import { readFile } from "node:fs/promises";

import { buildContainer, parseContainer } from "./sunvox-codec.mjs";

export function deterministicIconBase64(seed, salt) {
  let state = (Math.imul(seed + 1, 0x45d9f3b) ^ Math.imul(salt + 1, 0x9e3779b1)) >>> 0;
  const bytes = Buffer.alloc(32);
  for (let index = 0; index < bytes.length; index += 1) {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    bytes[index] = state & 0xff;
  }
  return bytes.toString("base64");
}

export async function readSunsynthForMusic(path, options = {}) {
  const bytes = await readFile(path);
  if (options.rootVolume === undefined) {
    return bytes;
  }

  const document = parseContainer(bytes);
  if (!document.module) {
    throw new Error(`${path} is not a SunSynth document`);
  }
  if (Array.isArray(document.module.controllers)) {
    throw new Error(`${path} has unsupported root controller storage`);
  }
  document.module.controllers ??= {};
  document.module.controllers.volume = options.rootVolume;

  let changedEmbeddedProject = false;
  for (const dataChunk of document.module.dataChunks ?? []) {
    if (dataChunk.container?.project) {
      dataChunk.container.project.globalVolume = options.rootVolume;
      changedEmbeddedProject = true;
    }
  }
  if (!changedEmbeddedProject) {
    throw new Error(`${path} has no embedded project global volume`);
  }

  return buildContainer(document);
}

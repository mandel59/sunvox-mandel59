import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { basename } from "node:path";

const TEXT_FORMAT = "sunvox-container-text-v1";
const SUPPORTED_MAGICS = new Set(["SVOX", "SSYN"]);

function usage() {
  console.error(`Usage:
  node tools/sunvox-codec.mjs encode <input.sunvox|input.sunsynth> <output.json>
  node tools/sunvox-codec.mjs decode <input.json> <output.sunvox|output.sunsynth>
  node tools/sunvox-codec.mjs verify <input.sunvox|input.sunsynth>`);
}

function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

function toAscii(buffer) {
  return buffer.toString("latin1");
}

function assertPrintableFourCc(value, label) {
  if (typeof value !== "string" || value.length !== 4) {
    throw new Error(`${label} must be a 4-byte string`);
  }
  for (const char of value) {
    const code = char.charCodeAt(0);
    if (code < 0x20 || code > 0x7e) {
      throw new Error(`${label} must contain printable ASCII bytes`);
    }
  }
}

function previewText(data) {
  if (data.length === 0 || data.length > 96) {
    return undefined;
  }

  let end = data.length;
  while (end > 0 && data[end - 1] === 0) {
    end -= 1;
  }
  const trimmed = data.subarray(0, end);
  if (trimmed.length < 2) {
    return undefined;
  }

  for (const byte of trimmed) {
    if (byte < 0x20 || byte > 0x7e) {
      return undefined;
    }
  }
  return trimmed.toString("utf8");
}

function parseContainer(buffer) {
  if (buffer.length < 8) {
    throw new Error("File is too short to be a SunVox container");
  }

  const magic = toAscii(buffer.subarray(0, 4));
  if (!SUPPORTED_MAGICS.has(magic)) {
    throw new Error(`Unsupported SunVox container magic: ${JSON.stringify(magic)}`);
  }

  const headerTail = buffer.subarray(4, 8);
  const chunks = [];
  let offset = 8;

  while (offset < buffer.length) {
    if (offset + 8 > buffer.length) {
      throw new Error(`Truncated chunk header at offset ${offset}`);
    }

    const id = toAscii(buffer.subarray(offset, offset + 4));
    assertPrintableFourCc(id, `Chunk id at offset ${offset}`);

    const size = buffer.readUInt32LE(offset + 4);
    const dataOffset = offset + 8;
    const nextOffset = dataOffset + size;

    if (nextOffset > buffer.length) {
      throw new Error(`Chunk ${id} at offset ${offset} extends past end of file`);
    }

    const data = buffer.subarray(dataOffset, nextOffset);
    chunks.push({
      id,
      offset,
      size,
      sha256: sha256(data),
      dataBase64: data.toString("base64"),
      textPreview: previewText(data),
    });

    offset = nextOffset;
  }

  return {
    format: TEXT_FORMAT,
    sourceName: undefined,
    magic,
    headerTailHex: headerTail.toString("hex"),
    size: buffer.length,
    sha256: sha256(buffer),
    chunks,
  };
}

function decodeBase64(value, label) {
  if (typeof value !== "string") {
    throw new Error(`${label} must be a base64 string`);
  }
  return Buffer.from(value, "base64");
}

function buildContainer(document) {
  if (document?.format !== TEXT_FORMAT) {
    throw new Error(`Unsupported text format: ${JSON.stringify(document?.format)}`);
  }

  assertPrintableFourCc(document.magic, "magic");
  if (!SUPPORTED_MAGICS.has(document.magic)) {
    throw new Error(`Unsupported SunVox container magic: ${JSON.stringify(document.magic)}`);
  }

  if (typeof document.headerTailHex !== "string" || !/^[0-9a-fA-F]{8}$/.test(document.headerTailHex)) {
    throw new Error("headerTailHex must contain exactly 4 bytes of hex");
  }

  if (!Array.isArray(document.chunks)) {
    throw new Error("chunks must be an array");
  }

  const parts = [Buffer.from(document.magic, "latin1"), Buffer.from(document.headerTailHex, "hex")];

  for (const [index, chunk] of document.chunks.entries()) {
    assertPrintableFourCc(chunk.id, `chunks[${index}].id`);
    const data = decodeBase64(chunk.dataBase64, `chunks[${index}].dataBase64`);

    if (chunk.size !== undefined && chunk.size !== data.length) {
      throw new Error(`chunks[${index}] size mismatch: expected ${chunk.size}, got ${data.length}`);
    }
    if (chunk.sha256 !== undefined && chunk.sha256 !== sha256(data)) {
      throw new Error(`chunks[${index}] sha256 mismatch`);
    }

    const header = Buffer.alloc(8);
    header.write(chunk.id, 0, 4, "latin1");
    header.writeUInt32LE(data.length, 4);
    parts.push(header, data);
  }

  const buffer = Buffer.concat(parts);
  if (document.size !== undefined && document.size !== buffer.length) {
    throw new Error(`Decoded size mismatch: expected ${document.size}, got ${buffer.length}`);
  }
  if (document.sha256 !== undefined && document.sha256 !== sha256(buffer)) {
    throw new Error("Decoded file sha256 mismatch");
  }
  return buffer;
}

async function encode(inputPath, outputPath) {
  const buffer = await readFile(inputPath);
  const document = parseContainer(buffer);
  document.sourceName = basename(inputPath);
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

async function decode(inputPath, outputPath) {
  const json = await readFile(inputPath, "utf8");
  const document = JSON.parse(json);
  const buffer = buildContainer(document);
  await writeFile(outputPath, buffer);
}

async function verify(inputPath) {
  const buffer = await readFile(inputPath);
  const document = parseContainer(buffer);
  const rebuilt = buildContainer(document);
  if (!rebuilt.equals(buffer)) {
    throw new Error("Round-trip verification failed");
  }
  console.log(`${inputPath}: ${document.magic}, ${document.chunks.length} chunks, ${document.size} bytes`);
}

const [command, inputPath, outputPath] = process.argv.slice(2);

try {
  if (command === "encode" && inputPath && outputPath) {
    await encode(inputPath, outputPath);
  } else if (command === "decode" && inputPath && outputPath) {
    await decode(inputPath, outputPath);
  } else if (command === "verify" && inputPath && !outputPath) {
    await verify(inputPath);
  } else {
    usage();
    process.exitCode = 2;
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}

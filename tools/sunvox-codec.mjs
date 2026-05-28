import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TEXT_FORMAT = "sunvox-structured-text-v1";
export const EDITABLE_TEXT_FORMAT = "sunvox-editable-text-v1";
export const VERBOSE_TEXT_FORMAT = "sunvox-container-text-v1";
export const SUPPORTED_MAGICS = new Set(["SVOX", "SSYN"]);

const UINT32_CHUNKS = new Set([
  "BVER",
  "VERS",
  "SFGS",
  "BPM ",
  "SPED",
  "TGRD",
  "TGD2",
  "GVOL",
  "MSCL",
  "MZOO",
  "LMSK",
  "CURL",
  "TIME",
  "REPS",
  "SELS",
  "LGEN",
  "PATN",
  "PATT",
  "PATL",
  "PCHN",
  "PLIN",
  "PYSZ",
  "PICO",
  "PPAR",
  "PPR#",
  "PFLG",
  "PFFF",
  "SFFF",
  "SSCL",
  "SVPR",
  "SMII",
  "SMIC",
  "SMIP",
  "CHNK",
  "CHNM",
  "CHFF",
  "CHFR",
  "FLGS",
  "JAMD",
]);

const INT32_CHUNKS = new Set([
  "MXOF",
  "MYOF",
  "PXXX",
  "PYYY",
  "SFIN",
  "SREL",
  "SXXX",
  "SYYY",
  "SZZZ",
  "SMIB",
  "CVAL",
]);

const INT32_ARRAY_CHUNKS = new Set(["SLNK", "SLnK", "SLNk", "SLnk"]);
const UINT32_ARRAY_CHUNKS = new Set(["CMID", "STMT"]);
const STRING_CHUNKS = new Set(["NAME", "PNME", "SNAM", "STYP", "SMIN"]);
const RGB_CHUNKS = new Set(["PFGC", "PBGC", "SCOL"]);
const PATTERN_CHUNKS = new Set([
  "PATT",
  "PATL",
  "PDTA",
  "PNME",
  "PLIN",
  "PCHN",
  "PYSZ",
  "PICO",
  "PPAR",
  "PPR#",
  "PFLG",
  "PFFF",
  "PXXX",
  "PYYY",
  "PFGC",
  "PBGC",
  "PEND",
]);
const MODULE_CHUNKS = new Set([
  "SFFF",
  "SNAM",
  "STYP",
  "SFIN",
  "SREL",
  "SXXX",
  "SYYY",
  "SZZZ",
  "SSCL",
  "SVPR",
  "SCOL",
  "SMII",
  "SMIN",
  "SMIC",
  "SMIB",
  "SMIP",
  "SLNK",
  "SLnK",
  "SLNk",
  "SLnk",
  "CVAL",
  "CMID",
  "CHNK",
  "CHNM",
  "CHDT",
  "CHFF",
  "CHFR",
  "SEND",
]);

export const SUNVOX_DB = JSON.parse(
  readFileSync(new URL("./sunvox-db/database.json", import.meta.url), "utf8"),
);

const CHUNK_DESCRIPTIONS = Object.fromEntries(
  SUNVOX_DB.chunks.map((chunk) => [chunk.id, chunk.label]),
);

function usage() {
  console.error(`Usage:
  node tools/sunvox-codec.mjs encode <input.sunvox|input.sunsynth> <output.json>
  node tools/sunvox-codec.mjs decode <input.json> <output.sunvox|output.sunsynth>
  node tools/sunvox-codec.mjs verify <input.sunvox|input.sunsynth>`);
}

export function sha256(buffer) {
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

function readInt32Array(data) {
  const values = [];
  for (let offset = 0; offset + 4 <= data.length; offset += 4) {
    values.push(data.readInt32LE(offset));
  }
  return values;
}

function readUInt32Array(data) {
  const values = [];
  for (let offset = 0; offset + 4 <= data.length; offset += 4) {
    values.push(data.readUInt32LE(offset));
  }
  return values;
}

function readUInt16Array(data) {
  const values = [];
  for (let offset = 0; offset + 2 <= data.length; offset += 2) {
    values.push(data.readUInt16LE(offset));
  }
  return values;
}

function writeInt32Array(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeInt32LE(value, index * 4));
  return buffer;
}

function writeUInt16Array(values) {
  const buffer = Buffer.alloc(values.length * 2);
  values.forEach((value, index) => buffer.writeUInt16LE(value, index * 2));
  return buffer;
}

function writeUInt32Array(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeUInt32LE(value, index * 4));
  return buffer;
}

function enumToName(enumName, value) {
  return SUNVOX_DB.enums[enumName]?.[String(value)] ?? value;
}

function enumToValue(enumName, value) {
  if (typeof value === "number") {
    return value;
  }
  const entries = Object.entries(SUNVOX_DB.enums[enumName] ?? {});
  const entry = entries.find(([, name]) => name === value);
  if (!entry) {
    throw new Error(`Unknown ${enumName} value: ${value}`);
  }
  return Number(entry[0]);
}

function bitMask(bits) {
  return bits === 32 ? 0xffffffff : (2 ** bits) - 1;
}

function unpackBitfield(bitfieldName, value) {
  const definition = SUNVOX_DB.bitfields[bitfieldName];
  if (!definition) {
    throw new Error(`Unknown bitfield: ${bitfieldName}`);
  }
  const result = {};
  for (const field of definition.fields) {
    const rawValue = (value >>> field.shift) & bitMask(field.bits);
    result[field.name] = field.enum ? enumToName(field.enum, rawValue) : rawValue;
  }
  return result;
}

function packBitfield(bitfieldName, value) {
  const definition = SUNVOX_DB.bitfields[bitfieldName];
  if (!definition) {
    throw new Error(`Unknown bitfield: ${bitfieldName}`);
  }
  let packed = 0;
  for (const field of definition.fields) {
    const rawFieldValue = value?.[field.name] ?? 0;
    const fieldValue = field.enum ? enumToValue(field.enum, rawFieldValue) : rawFieldValue;
    packed |= (fieldValue & bitMask(field.bits)) << field.shift;
  }
  return packed >>> 0;
}

function decodeBitflags(bitflagName, value) {
  const definition = SUNVOX_DB.bitflags?.[bitflagName] ?? [];
  const result = {};
  for (const flag of definition) {
    result[flag.name] = Boolean(value & (1 << flag.bit));
  }
  return result;
}

function encodeBitflags(bitflagName, value) {
  if (typeof value === "number") {
    return value >>> 0;
  }
  const definition = SUNVOX_DB.bitflags?.[bitflagName] ?? [];
  let result = 0;
  for (const flag of definition) {
    if (value?.[flag.name]) {
      result |= 1 << flag.bit;
    }
  }
  return result >>> 0;
}

function decodeMidiBinding(midiPars1, midiPars2) {
  return {
    ...unpackBitfield("midi_pars1", midiPars1),
    ...unpackBitfield("midi_pars2", midiPars2),
  };
}

function encodeMidiBinding(binding) {
  if (Array.isArray(binding)) {
    return binding;
  }
  if (binding?.midiPars1 !== undefined || binding?.midiPars2 !== undefined) {
    return [binding.midiPars1 ?? 0, binding.midiPars2 ?? 0];
  }
  return [
    packBitfield("midi_pars1", binding),
    packBitfield("midi_pars2", binding),
  ];
}

function decodeCString(data) {
  const nul = data.indexOf(0);
  const end = nul >= 0 ? nul : data.length;
  const trimmed = data.subarray(0, end);
  if (trimmed.length === 0) {
    return "";
  }
  const text = trimmed.toString("utf8");
  if (text.includes("\ufffd")) {
    return undefined;
  }
  for (const char of text) {
    const code = char.charCodeAt(0);
    if (code < 0x20) {
      return undefined;
    }
  }
  return text;
}

function decodePatternNotes(data) {
  if (data.length % 8 !== 0) {
    return undefined;
  }

  const events = [];
  let nonEmptyEvents = 0;
  for (let offset = 0; offset < data.length; offset += 8) {
    const event = {
      note: data.readUInt8(offset),
      velocity: data.readUInt8(offset + 1),
      module: data.readUInt16LE(offset + 2),
      controller: data.readUInt16LE(offset + 4),
      value: data.readUInt16LE(offset + 6),
    };
    if (event.note || event.velocity || event.module || event.controller || event.value) {
      nonEmptyEvents += 1;
    }
    events.push(event);
  }

  return {
    eventSize: 8,
    events,
    eventCount: events.length,
    nonEmptyEventCount: nonEmptyEvents,
  };
}

function encodePatternNotes(pattern) {
  const events = pattern?.events;
  if (!Array.isArray(events)) {
    throw new Error("pattern.events must be an array");
  }

  const buffer = Buffer.alloc(events.length * 8);
  events.forEach((event, index) => {
    const values = Array.isArray(event)
      ? event
      : [event.note, event.velocity, event.module, event.controller, event.value];
    if (values.length !== 5) {
      throw new Error(`pattern.events[${index}] must contain 5 values`);
    }
    const offset = index * 8;
    buffer.writeUInt8(values[0], offset);
    buffer.writeUInt8(values[1], offset + 1);
    buffer.writeUInt16LE(values[2], offset + 2);
    buffer.writeUInt16LE(values[3], offset + 4);
    buffer.writeUInt16LE(values[4], offset + 6);
  });
  return buffer;
}

export function decodeChunkData(id, data) {
  const decoded = {};
  if (CHUNK_DESCRIPTIONS[id]) {
    decoded._description = CHUNK_DESCRIPTIONS[id];
  }

  if (STRING_CHUNKS.has(id)) {
    const text = decodeCString(data);
    if (text !== undefined) {
      return { ...decoded, kind: "string", value: text };
    }
  }

  if (RGB_CHUNKS.has(id) && data.length === 3) {
    return {
      ...decoded,
      kind: "rgb",
      value: {
        r: data[0],
        g: data[1],
        b: data[2],
        hex: `#${data.toString("hex")}`,
      },
    };
  }

  if (id === "PDTA") {
    const pattern = decodePatternNotes(data);
    if (pattern) {
      return { ...decoded, kind: "patternNotes", value: pattern };
    }
  }

  if (id === "CMID" && data.length % 8 === 0) {
    const bindings = [];
    for (let offset = 0; offset < data.length; offset += 8) {
      bindings.push(decodeMidiBinding(data.readUInt32LE(offset), data.readUInt32LE(offset + 4)));
    }
    return { ...decoded, kind: "midiBindings", value: bindings };
  }

  if (INT32_ARRAY_CHUNKS.has(id) && data.length % 4 === 0) {
    return { ...decoded, kind: "int32Array", value: readInt32Array(data) };
  }

  if (UINT32_ARRAY_CHUNKS.has(id) && data.length % 4 === 0) {
    return { ...decoded, kind: "uint32Array", value: readUInt32Array(data) };
  }

  if (data.length === 0) {
    decoded.kind = "empty";
    return decoded;
  }

  if (INT32_CHUNKS.has(id) && data.length === 4) {
    return { ...decoded, kind: "int32", value: data.readInt32LE(0) };
  }

  if (UINT32_CHUNKS.has(id) && data.length === 4) {
    return { ...decoded, kind: "uint32", value: data.readUInt32LE(0) };
  }

  const text = decodeCString(data);
  if (text !== undefined && text.length >= 2 && data.length <= 96) {
    return { ...decoded, kind: "stringPreview", value: text };
  }

  return Object.keys(decoded).length ? decoded : undefined;
}

function makeChunk(id, offset, data) {
  const chunk = {
    id,
    offset,
    size: data.length,
    sha256: sha256(data),
    dataBase64: data.toString("base64"),
  };
  const decoded = decodeChunkData(id, data);
  if (decoded) {
    chunk._decoded = decoded;
  }
  return chunk;
}

function compactPatternNotes(pattern) {
  return {
    events: pattern.events.map((event) => [
      event.note,
      event.velocity,
      event.module,
      event.controller,
      event.value,
    ]),
  };
}

function makeEditableChunk(id, data) {
  const chunk = { id };
  const decoded = decodeChunkData(id, data);

  if (decoded?._description) {
    chunk._label = decoded._description;
  }

  switch (decoded?.kind) {
    case "empty":
      return chunk;
    case "string": {
      chunk.text = decoded.value;
      const expectedSize = Buffer.byteLength(decoded.value, "utf8") + 1;
      if (data.length !== expectedSize) {
        chunk.textSize = data.length;
      }
      return chunk;
    }
    case "rgb":
      chunk.rgb = decoded.value.hex;
      return chunk;
    case "int32":
    case "uint32":
      chunk.value = decoded.value;
      return chunk;
    case "int32Array":
    case "uint32Array":
      chunk.values = decoded.value;
      return chunk;
    case "midiBindings":
      chunk.midiBindings = decoded.value;
      return chunk;
    case "patternNotes":
      chunk.pattern = compactPatternNotes(decoded.value);
      return chunk;
    default:
      chunk.base64 = data.toString("base64");
      return chunk;
  }
}

function encodeTextChunk(chunk) {
  const text = chunk.text ?? "";
  const textBuffer = Buffer.from(text, "utf8");
  const size = chunk.textSize ?? textBuffer.length + 1;
  if (size < textBuffer.length) {
    throw new Error(`${chunk.id} textSize is smaller than the encoded text`);
  }
  const buffer = Buffer.alloc(size);
  textBuffer.copy(buffer);
  return buffer;
}

function encodeRgbChunk(chunk) {
  if (typeof chunk.rgb !== "string" || !/^#[0-9a-fA-F]{6}$/.test(chunk.rgb)) {
    throw new Error(`${chunk.id} rgb must use #rrggbb`);
  }
  return Buffer.from(chunk.rgb.slice(1), "hex");
}

function editableChunkData(chunk, index) {
  if (chunk.base64 !== undefined) {
    return decodeBase64(chunk.base64, `chunks[${index}].base64`);
  }
  if (STRING_CHUNKS.has(chunk.id) && chunk.text !== undefined) {
    return encodeTextChunk(chunk);
  }
  if (RGB_CHUNKS.has(chunk.id) && chunk.rgb !== undefined) {
    return encodeRgbChunk(chunk);
  }
  if ((INT32_CHUNKS.has(chunk.id) || UINT32_CHUNKS.has(chunk.id)) && chunk.value !== undefined) {
    const buffer = Buffer.alloc(4);
    if (INT32_CHUNKS.has(chunk.id)) {
      buffer.writeInt32LE(chunk.value, 0);
    } else {
      buffer.writeUInt32LE(chunk.value, 0);
    }
    return buffer;
  }
  if (INT32_ARRAY_CHUNKS.has(chunk.id) && Array.isArray(chunk.values)) {
    return writeInt32Array(chunk.values);
  }
  if (UINT32_ARRAY_CHUNKS.has(chunk.id) && Array.isArray(chunk.values)) {
    return writeUInt32Array(chunk.values);
  }
  if (chunk.id === "CMID" && Array.isArray(chunk.midiBindings)) {
    const buffer = Buffer.alloc(chunk.midiBindings.length * 8);
    chunk.midiBindings.forEach((binding, bindingIndex) => {
      const values = encodeMidiBinding(binding);
      const offset = bindingIndex * 8;
      buffer.writeUInt32LE(values[0], offset);
      buffer.writeUInt32LE(values[1], offset + 4);
    });
    return buffer;
  }
  if (chunk.id === "PDTA" && chunk.pattern !== undefined) {
    return encodePatternNotes(chunk.pattern);
  }
  if (chunk.value === undefined && chunk.text === undefined && chunk.rgb === undefined && chunk.values === undefined && chunk.pattern === undefined) {
    return Buffer.alloc(0);
  }
  throw new Error(`chunks[${index}] cannot be encoded for chunk id ${chunk.id}`);
}

function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function firstChunk(chunks, id) {
  return chunks.find((chunk) => chunk.id === id);
}

function chunksOf(chunks, id) {
  return chunks.filter((chunk) => chunk.id === id);
}

function chunkText(chunks, id) {
  return firstChunk(chunks, id)?.text;
}

function chunkValue(chunks, id) {
  return firstChunk(chunks, id)?.value;
}

function chunkValues(chunks, id) {
  return firstChunk(chunks, id)?.values;
}

function chunkRgb(chunks, id) {
  return firstChunk(chunks, id)?.rgb;
}

function scopeGrammar(scopeName) {
  const grammar = SUNVOX_DB.grammar?.scopes?.[scopeName];
  if (!grammar) {
    throw new Error(`Unknown grammar scope: ${scopeName}`);
  }
  return grammar;
}

function getPath(object, path) {
  let current = object;
  for (const segment of path.split(".")) {
    if (current == null || typeof current !== "object") {
      return undefined;
    }
    current = current[segment];
  }
  return current;
}

function setPath(object, path, value) {
  if (value === undefined) {
    return;
  }
  const segments = path.split(".");
  let current = object;
  for (const segment of segments.slice(0, -1)) {
    current[segment] ??= {};
    current = current[segment];
  }
  current[segments.at(-1)] = value;
}

function chunkSemanticValue(chunk, field) {
  if (field === "pattern.events") {
    return chunk.pattern?.events;
  }
  return chunk[field];
}

function assignChunkSemanticValue(chunk, field, value) {
  if (field === "pattern.events") {
    chunk.pattern = { events: value };
  } else {
    chunk[field] = value;
  }
}

function chunkLabel(id) {
  return CHUNK_DESCRIPTIONS[id];
}

function makeSemanticChunk(chunkId, field, value, options = {}) {
  const chunk = { id: chunkId };
  const label = chunkLabel(chunkId);
  if (label) {
    chunk._label = label;
  }
  assignChunkSemanticValue(chunk, field, value);
  if (field === "text" && options.textSize !== undefined) {
    chunk.textSize = options.textSize;
  }
  return chunk;
}

function consumeScopeFields(scopeName, chunks, target, used) {
  const grammar = scopeGrammar(scopeName);
  for (const field of grammar.fields) {
    const index = chunks.findIndex((chunk, chunkIndex) => !used.has(chunkIndex) && chunk.id === field.chunk);
    if (index < 0) {
      continue;
    }
    const value = chunkSemanticValue(chunks[index], field.field);
    if (value !== undefined) {
      setPath(target, field.path, value);
      used.add(index);
    }
  }
}

function consumeTerminator(scopeName, chunks, used) {
  const terminator = scopeGrammar(scopeName).terminator;
  if (!terminator) {
    return;
  }
  chunks.forEach((chunk, index) => {
    if (chunk.id === terminator) {
      used.add(index);
    }
  });
}

function remainingChunks(chunks, used) {
  return chunks
    .filter((_, index) => !used.has(index))
    .map(cloneJson);
}

function emitScopeField(scopeName, object, chunkId) {
  const field = scopeGrammar(scopeName).fields.find((candidate) => candidate.chunk === chunkId);
  if (!field) {
    return undefined;
  }
  const value = getPath(object, field.path);
  if (value === undefined) {
    return undefined;
  }
  return makeSemanticChunk(chunkId, field.field, value, field);
}

function moduleDefinition(type) {
  return type ? SUNVOX_DB.modules[type] : undefined;
}

function moduleDataDefinition(type, index) {
  const definition = moduleDefinition(type);
  return (
    definition?.dataChunks?.find((chunk) => chunk.index === index) ??
    definition?.dataChunkRanges?.find((chunk) => index >= chunk.start && index <= chunk.end)
  );
}

function decodeMetaModuleControllerLinks(data, count) {
  const links = [];
  for (let offset = 0, index = 0; offset + 4 <= data.length; offset += 4, index += 1) {
    const value = data.readUInt32LE(offset);
    if (value === 0) {
      continue;
    }
    links.push({
      index,
      module: value & 0xffff,
      controller: (value >>> 16) & 0xffff,
    });
  }
  return {
    count: count ?? Math.floor(data.length / 4),
    links,
  };
}

function encodeMetaModuleControllerLinks(dataChunk) {
  const count = dataChunk.count ?? 96;
  const buffer = Buffer.alloc(count * 4);
  for (const link of dataChunk.links ?? []) {
    const index = link.index;
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw new Error(`Invalid MetaModule controller link index: ${index}`);
    }
    const value = ((link.controller ?? 0) << 16) | (link.module ?? 0);
    buffer.writeUInt32LE(value >>> 0, index * 4);
  }
  return buffer;
}

function decodeMetaModuleOptions(data, flagsName) {
  return {
    userControllers: data.readUInt8(0),
    arpeggiator: Boolean(data.readUInt8(1)),
    useVelocity: Boolean(data.readUInt8(2)),
    eventOutput: !Boolean(data.readUInt8(3)),
    flags: decodeBitflags(flagsName, data.length >= 8 ? data.readUInt32LE(4) : 0),
  };
}

function encodeMetaModuleOptions(dataChunk, flagsName) {
  const options = dataChunk.options ?? {};
  const buffer = Buffer.alloc(8);
  buffer.writeUInt8(options.userControllers ?? 0, 0);
  buffer.writeUInt8(options.arpeggiator ? 1 : 0, 1);
  buffer.writeUInt8(options.useVelocity ? 1 : 0, 2);
  buffer.writeUInt8(options.eventOutput === false ? 1 : 0, 3);
  buffer.writeUInt32LE(encodeBitflags(flagsName, options.flags ?? 0), 4);
  return buffer;
}

function decodeMetaModuleControllerName(text) {
  const match = /^@([0-9a-fA-F])(.*)$/u.exec(text);
  if (match) {
    return {
      group: Number.parseInt(match[1], 16),
      label: match[2],
    };
  }
  return { label: text };
}

function encodeMetaModuleControllerName(dataChunk) {
  const text =
    dataChunk.text ??
    (dataChunk.group !== undefined
      ? `@${Number(dataChunk.group).toString(16)}${dataChunk.label ?? ""}`
      : dataChunk.label ?? "");
  return Buffer.from(`${text}\0`, "utf8");
}

function decodeMultiCtlOutputSlots(data, count) {
  const slots = [];
  const slotCount = Math.floor(data.length / 32);
  for (let index = 0; index < slotCount; index += 1) {
    const offset = index * 32;
    const slot = {
      index,
      min: data.readInt32LE(offset),
      max: data.readInt32LE(offset + 4),
      controller: data.readInt32LE(offset + 8),
      flags: data.readUInt32LE(offset + 12),
      futureUse: [
        data.readInt32LE(offset + 16),
        data.readInt32LE(offset + 20),
        data.readInt32LE(offset + 24),
        data.readInt32LE(offset + 28),
      ],
    };
    const isDefault =
      slot.min === 0 &&
      slot.max === 32768 &&
      slot.controller === 0 &&
      slot.flags === 0 &&
      slot.futureUse.every((value) => value === 0);
    if (!isDefault) {
      if (slot.min === 0) delete slot.min;
      if (slot.max === 32768) delete slot.max;
      if (slot.controller === 0) delete slot.controller;
      if (slot.flags === 0) delete slot.flags;
      if (slot.futureUse.every((value) => value === 0)) delete slot.futureUse;
      slots.push(slot);
    }
  }
  return {
    count: count ?? slotCount,
    slots,
  };
}

function encodeMultiCtlOutputSlots(dataChunk) {
  const count = dataChunk.count ?? 16;
  const buffer = Buffer.alloc(count * 32);
  for (let index = 0; index < count; index += 1) {
    const offset = index * 32;
    buffer.writeInt32LE(0, offset);
    buffer.writeInt32LE(32768, offset + 4);
  }
  for (const slot of dataChunk.slots ?? []) {
    const index = slot.index;
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw new Error(`Invalid MultiCtl output slot index: ${index}`);
    }
    const offset = index * 32;
    buffer.writeInt32LE(slot.min ?? 0, offset);
    buffer.writeInt32LE(slot.max ?? 32768, offset + 4);
    buffer.writeInt32LE(slot.controller ?? 0, offset + 8);
    buffer.writeUInt32LE(slot.flags ?? 0, offset + 12);
    const futureUse = slot.futureUse ?? [];
    for (let futureIndex = 0; futureIndex < 4; futureIndex += 1) {
      buffer.writeInt32LE(futureUse[futureIndex] ?? 0, offset + 16 + futureIndex * 4);
    }
  }
  return buffer;
}

function decodeSound2CtlOptions(data) {
  return {
    recordValues: Boolean(data.readUInt8(0)),
    sendChangesOnly: Boolean(data.readUInt8(1)),
  };
}

function encodeSound2CtlOptions(dataChunk) {
  const options = dataChunk.options ?? {};
  const buffer = Buffer.alloc(2);
  buffer.writeUInt8(options.recordValues ? 1 : 0, 0);
  buffer.writeUInt8(options.sendChangesOnly ? 1 : 0, 1);
  return buffer;
}

function decodeModuleDataChunk(type, index, chunk) {
  const definition = moduleDataDefinition(type, index);
  const dataChunk = { index };
  if (definition?.name) {
    dataChunk.name = definition.name;
  }
  if (definition?.indexOffset !== undefined) {
    dataChunk.controller = index - definition.indexOffset;
  }

  if (chunk.base64 !== undefined) {
    const data = decodeBase64(chunk.base64, `module data chunk ${index}`);
    const magic = data.length >= 4 ? toAscii(data.subarray(0, 4)) : undefined;
    if (
      definition?.type === "container" &&
      SUPPORTED_MAGICS.has(magic) &&
      (!definition.magic || definition.magic.includes(magic))
    ) {
      dataChunk.container = parseContainer(data);
    } else if (definition?.type === "metamoduleControllerLinks" && data.length % 4 === 0) {
      Object.assign(dataChunk, decodeMetaModuleControllerLinks(data, definition.count));
    } else if (definition?.type === "metamoduleOptions" && data.length >= 4) {
      dataChunk.options = decodeMetaModuleOptions(data, definition.flags);
    } else if (definition?.type === "metamoduleControllerName") {
      const text = decodeCString(data);
      if (text !== undefined) {
        Object.assign(dataChunk, decodeMetaModuleControllerName(text));
      } else {
        dataChunk.base64 = chunk.base64;
      }
    } else if (definition?.type === "multictlOutputSlots" && data.length % 32 === 0) {
      Object.assign(dataChunk, decodeMultiCtlOutputSlots(data, definition.count));
    } else if (definition?.type === "uint16Array" && data.length % 2 === 0) {
      dataChunk.count = definition.count ?? data.length / 2;
      dataChunk.values = readUInt16Array(data);
    } else if (definition?.type === "sound2ctlOptions" && data.length >= 2) {
      dataChunk.options = decodeSound2CtlOptions(data);
    } else {
      dataChunk.base64 = chunk.base64;
    }
    return dataChunk;
  }

  dataChunk.chunk = cloneJson(chunk);
  return dataChunk;
}

function decodeControllerValue(definition, value) {
  if (definition?.type === "enum") {
    return enumToName(definition.enum, value);
  }
  return value;
}

function encodeControllerValue(definition, value) {
  if (definition?.type === "enum") {
    return enumToValue(definition.enum, value);
  }
  return value;
}

function decodeModuleControllers(type, controllerValues) {
  const definition = moduleDefinition(type);
  if (!definition?.controllers || controllerValues.length === 0) {
    return controllerValues.length ? controllerValues : undefined;
  }
  const controllers = {};
  const knownIndexes = new Set();
  for (const controller of definition.controllers) {
    knownIndexes.add(controller.index);
    if (controllerValues[controller.index] !== undefined) {
      controllers[controller.name] = decodeControllerValue(controller, controllerValues[controller.index]);
    }
  }
  for (let index = 0; index < controllerValues.length; index += 1) {
    if (!knownIndexes.has(index) && controllerValues[index] !== undefined) {
      controllers.extra ??= {};
      controllers.extra[index] = controllerValues[index];
    }
  }
  return Object.keys(controllers).length ? controllers : undefined;
}

function syncModuleControllers(type, controllers, controllerChunks) {
  if (Array.isArray(controllers)) {
    controllerChunks.forEach((chunk, index) => {
      if (controllers[index] !== undefined) {
        chunk.value = controllers[index];
      }
    });
    return;
  }
  const definition = moduleDefinition(type);
  if (!definition?.controllers || !controllers || typeof controllers !== "object") {
    return;
  }
  for (const controller of definition.controllers) {
    const value = controllers[controller.name];
    const chunk = controllerChunks[controller.index];
    if (value !== undefined && chunk) {
      chunk.value = encodeControllerValue(controller, value);
    }
  }
  if (controllers.extra && typeof controllers.extra === "object") {
    for (const [indexText, value] of Object.entries(controllers.extra)) {
      const index = Number(indexText);
      const chunk = controllerChunks[index];
      if (Number.isInteger(index) && chunk) {
        chunk.value = value;
      }
    }
  }
}

function controllerValuesFromObject(type, controllers) {
  if (Array.isArray(controllers)) {
    return controllers;
  }
  const definition = moduleDefinition(type);
  if (!definition?.controllers || !controllers || typeof controllers !== "object") {
    return undefined;
  }
  const values = [];
  for (const controller of definition.controllers) {
    const value = controllers[controller.name];
    if (value !== undefined) {
      values[controller.index] = encodeControllerValue(controller, value);
    }
  }
  if (controllers.extra && typeof controllers.extra === "object") {
    for (const [indexText, value] of Object.entries(controllers.extra)) {
      const index = Number(indexText);
      if (Number.isInteger(index) && index >= 0) {
        values[index] = value;
      }
    }
  }
  return values.length ? values : undefined;
}

function makeControllerChunks(type, controllers) {
  const values = controllerValuesFromObject(type, controllers);
  if (!values) {
    return [];
  }
  const chunks = [];
  for (let index = 0; index < values.length; index += 1) {
    chunks.push(makeSemanticChunk("CVAL", "value", values[index] ?? 0));
  }
  return chunks;
}

function setChunkField(chunks, id, field, value) {
  const chunk = firstChunk(chunks, id);
  if (!chunk || value === undefined) {
    return;
  }
  chunk[field] = value;
}

function consumeModuleDataChunks(chunks, target, used, type) {
  const dataChunks = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (used.has(index)) {
      continue;
    }
    if (chunk.id === "CHNK") {
      if (chunk.value !== undefined) {
        target.dataChunkCount = chunk.value;
      }
      used.add(index);
      continue;
    }
    if (chunk.id !== "CHNM") {
      continue;
    }

    const dataChunk = { index: chunk.value ?? dataChunks.length };
    used.add(index);

    const data = chunks[index + 1];
    if (data?.id === "CHDT" && !used.has(index + 1)) {
      Object.assign(dataChunk, decodeModuleDataChunk(type, dataChunk.index, data));
      used.add(index + 1);
      index += 1;
    }

    while (index + 1 < chunks.length) {
      const next = chunks[index + 1];
      if (next.id === "CHFF" && !used.has(index + 1)) {
        dataChunk.flags = next.value;
        used.add(index + 1);
        index += 1;
      } else if (next.id === "CHFR" && !used.has(index + 1)) {
        dataChunk.sampleRate = next.value;
        used.add(index + 1);
        index += 1;
      } else {
        break;
      }
    }
    dataChunks.push(dataChunk);
  }
  if (dataChunks.length) {
    target.dataChunks = dataChunks;
  }
}

function makeModuleDataChunks(module) {
  const dataChunks = module?.dataChunks;
  const declaredCount = module?.dataChunkCount ?? dataChunks?.length;
  if (declaredCount === undefined && !Array.isArray(dataChunks)) {
    return [];
  }

  const chunks = [makeSemanticChunk("CHNK", "value", declaredCount ?? 0)];
  for (const dataChunk of dataChunks ?? []) {
    const definition = moduleDataDefinition(module?.type, dataChunk.index);
    chunks.push(makeSemanticChunk("CHNM", "value", dataChunk.index ?? 0));
    if (dataChunk.chunk) {
      chunks.push(cloneJson(dataChunk.chunk));
    } else if (dataChunk.container) {
      chunks.push({
        id: "CHDT",
        _label: chunkLabel("CHDT"),
        base64: buildContainer(dataChunk.container).toString("base64"),
      });
    } else if (dataChunk.links) {
      chunks.push({
        id: "CHDT",
        _label: chunkLabel("CHDT"),
        base64: encodeMetaModuleControllerLinks(dataChunk).toString("base64"),
      });
    } else if (dataChunk.options && definition?.type === "metamoduleOptions") {
      chunks.push({
        id: "CHDT",
        _label: chunkLabel("CHDT"),
        base64: encodeMetaModuleOptions(dataChunk, definition?.flags).toString("base64"),
      });
    } else if (dataChunk.options && definition?.type === "sound2ctlOptions") {
      chunks.push({
        id: "CHDT",
        _label: chunkLabel("CHDT"),
        base64: encodeSound2CtlOptions(dataChunk).toString("base64"),
      });
    } else if (dataChunk.label !== undefined || dataChunk.text !== undefined) {
      chunks.push({
        id: "CHDT",
        _label: chunkLabel("CHDT"),
        base64: encodeMetaModuleControllerName(dataChunk).toString("base64"),
      });
    } else if (dataChunk.slots) {
      chunks.push({
        id: "CHDT",
        _label: chunkLabel("CHDT"),
        base64: encodeMultiCtlOutputSlots(dataChunk).toString("base64"),
      });
    } else if (dataChunk.values) {
      chunks.push({
        id: "CHDT",
        _label: chunkLabel("CHDT"),
        base64: writeUInt16Array(dataChunk.values).toString("base64"),
      });
    } else {
      chunks.push({
        id: "CHDT",
        _label: chunkLabel("CHDT"),
        base64: dataChunk.base64 ?? "",
      });
    }
    if (dataChunk.flags !== undefined) {
      chunks.push(makeSemanticChunk("CHFF", "value", dataChunk.flags));
    }
    if (dataChunk.sampleRate !== undefined) {
      chunks.push(makeSemanticChunk("CHFR", "value", dataChunk.sampleRate));
    }
  }
  return chunks;
}

function makeProject(chunks) {
  const project = {};
  const used = new Set();
  consumeScopeFields("project", chunks, project, used);
  const extraChunks = remainingChunks(chunks, used);
  if (extraChunks.length) {
    project.extraChunks = extraChunks;
  }
  return project;
}

function makePattern(chunks) {
  const pattern = {};
  const used = new Set();
  consumeScopeFields("pattern", chunks, pattern, used);
  consumeTerminator("pattern", chunks, used);
  const extraChunks = remainingChunks(chunks, used);
  if (extraChunks.length) {
    pattern.extraChunks = extraChunks;
  }
  return pattern;
}

function makeModule(chunks) {
  const controllerValues = chunksOf(chunks, "CVAL").map((chunk) => chunk.value);
  const type = chunkText(chunks, "STYP");
  const module = {};
  const used = new Set();
  consumeScopeFields("module", chunks, module, used);
  chunks.forEach((chunk, index) => {
    if (chunk.id === "CVAL") {
      used.add(index);
    }
  });
  const controllers = decodeModuleControllers(type, controllerValues);
  if (controllers !== undefined) {
    module.controllers = controllers;
  }
  const midiIndex = chunks.findIndex((chunk, index) => !used.has(index) && chunk.id === "CMID");
  if (midiIndex >= 0) {
    module.midiBindings = chunks[midiIndex].midiBindings;
    used.add(midiIndex);
  }
  consumeModuleDataChunks(chunks, module, used, type);
  consumeTerminator("module", chunks, used);
  const extraChunks = remainingChunks(chunks, used);
  if (extraChunks.length) {
    module.extraChunks = extraChunks;
  }
  return module;
}

function isPatternStart(chunks, index) {
  const id = chunks[index]?.id;
  if (!PATTERN_CHUNKS.has(id)) {
    return false;
  }
  if (id !== "PATT" && id !== "PATL") {
    return true;
  }
  for (let cursor = index; cursor < chunks.length; cursor += 1) {
    if (chunks[cursor].id === "PEND") {
      return true;
    }
    if (cursor > index && MODULE_CHUNKS.has(chunks[cursor].id)) {
      return false;
    }
  }
  return false;
}

function groupStructuredDocument(document) {
  const chunks = document.chunks.map(cloneJson);
  const sourceName = document._sourceName ?? document.sourceName;

  if (document.magic === "SSYN") {
    const moduleStart = chunks.findIndex((chunk) => MODULE_CHUNKS.has(chunk.id));
    const preludeChunks = moduleStart > 0 ? chunks.slice(0, moduleStart) : [];
    const moduleChunks = moduleStart >= 0 ? chunks.slice(moduleStart) : chunks;
    return {
      format: TEXT_FORMAT,
      _sourceName: sourceName,
      magic: document.magic,
      headerTailHex: document.headerTailHex,
      _comments: [],
      preludeChunks,
      module: makeModule(moduleChunks),
    };
  }

  const projectChunks = [];
  const patterns = [];
  const modules = [];
  const trailingChunks = [];

  for (let index = 0; index < chunks.length; ) {
    const chunk = chunks[index];
    if (isPatternStart(chunks, index)) {
      const patternChunks = [];
      while (index < chunks.length) {
        const current = chunks[index++];
        patternChunks.push(current);
        if (current.id === "PEND") {
          break;
        }
      }
      patterns.push(makePattern(patternChunks));
      continue;
    }
    if (MODULE_CHUNKS.has(chunk.id)) {
      const moduleChunks = [];
      while (index < chunks.length) {
        const current = chunks[index++];
        moduleChunks.push(current);
        if (current.id === "SEND") {
          break;
        }
      }
      modules.push(makeModule(moduleChunks));
      continue;
    }
    if (patterns.length || modules.length) {
      trailingChunks.push(chunk);
    } else {
      projectChunks.push(chunk);
    }
    index += 1;
  }

  return {
    format: TEXT_FORMAT,
    _sourceName: sourceName,
    magic: document.magic,
    headerTailHex: document.headerTailHex,
    _comments: [],
    project: makeProject(projectChunks),
    patterns,
    modules,
    trailingChunks,
  };
}

function syncLegacyProject(project) {
  const chunks = project?.chunks?.map(cloneJson) ?? [];
  setChunkField(chunks, "NAME", "text", project?.name);
  setChunkField(chunks, "BPM ", "value", project?.bpm);
  setChunkField(chunks, "SPED", "value", project?.speed);
  setChunkField(chunks, "GVOL", "value", project?.globalVolume);
  setChunkField(chunks, "MSCL", "value", project?.view?.moduleScale);
  setChunkField(chunks, "MZOO", "value", project?.view?.moduleZoom);
  setChunkField(chunks, "MXOF", "value", project?.view?.xOffset);
  setChunkField(chunks, "MYOF", "value", project?.view?.yOffset);
  return chunks;
}

function syncLegacyPattern(pattern) {
  const chunks = pattern?.chunks?.map(cloneJson) ?? [];
  setChunkField(chunks, "PNME", "text", pattern?.name);
  setChunkField(chunks, "PXXX", "value", pattern?.position?.x);
  setChunkField(chunks, "PYYY", "value", pattern?.position?.y);
  setChunkField(chunks, "PCHN", "value", pattern?.tracks);
  setChunkField(chunks, "PLIN", "value", pattern?.lines);
  setChunkField(chunks, "PYSZ", "value", pattern?.ySize);
  setChunkField(chunks, "PFGC", "rgb", pattern?.foreground);
  setChunkField(chunks, "PBGC", "rgb", pattern?.background);
  setChunkField(chunks, "PPAR", "value", pattern?.parent);
  setChunkField(chunks, "PFFF", "value", pattern?.flags);
  const data = firstChunk(chunks, "PDTA");
  if (data && pattern?.events) {
    data.pattern = { events: pattern.events };
  }
  return chunks;
}

function syncLegacyModule(module) {
  const chunks = module?.chunks?.map(cloneJson) ?? [];
  setChunkField(chunks, "SNAM", "text", module?.name);
  setChunkField(chunks, "STYP", "text", module?.type);
  setChunkField(chunks, "SXXX", "value", module?.position?.x);
  setChunkField(chunks, "SYYY", "value", module?.position?.y);
  setChunkField(chunks, "SZZZ", "value", module?.position?.z);
  setChunkField(chunks, "SCOL", "rgb", module?.color);
  setChunkField(chunks, "SFFF", "value", module?.flags);
  setChunkField(chunks, "SFIN", "value", module?.finetune);
  setChunkField(chunks, "SREL", "value", module?.relativeNote);
  setChunkField(chunks, "SSCL", "value", module?.scale);
  setChunkField(chunks, "SLNK", "values", module?.inputLinks);
  setChunkField(chunks, "SLNk", "values", module?.outputLinks);
  const controllerChunks = chunksOf(chunks, "CVAL");
  syncModuleControllers(module?.type, module?.controllers, controllerChunks);
  const midi = firstChunk(chunks, "CMID");
  if (midi && module?.midiBindings) {
    midi.midiBindings = module.midiBindings;
  }
  return chunks;
}

function syncProject(project) {
  if (Array.isArray(project?.chunks)) {
    return syncLegacyProject(project);
  }
  const chunks = [];
  for (const token of scopeGrammar("project").order) {
    if (token === "extraChunks") {
      chunks.push(...(project?.extraChunks ?? []).map(cloneJson));
      continue;
    }
    const chunk = emitScopeField("project", project, token);
    if (chunk) {
      chunks.push(chunk);
    }
  }
  return chunks;
}

function syncPattern(pattern) {
  if (Array.isArray(pattern?.chunks)) {
    return syncLegacyPattern(pattern);
  }
  const chunks = [];
  const terminator = scopeGrammar("pattern").terminator;
  for (const token of scopeGrammar("pattern").order) {
    if (token === "extraChunks") {
      chunks.push(...(pattern?.extraChunks ?? []).map(cloneJson));
      continue;
    }
    if (token === terminator) {
      chunks.push({ id: terminator, _label: chunkLabel(terminator) });
      continue;
    }
    const chunk = emitScopeField("pattern", pattern, token);
    if (chunk) {
      chunks.push(chunk);
    }
  }
  return chunks;
}

function makeMidiBindingsChunk(module) {
  if (!Array.isArray(module?.midiBindings)) {
    return undefined;
  }
  return makeSemanticChunk("CMID", "midiBindings", module.midiBindings);
}

function syncModule(module) {
  if (Array.isArray(module?.chunks)) {
    return syncLegacyModule(module);
  }
  const chunks = [];
  const terminator = scopeGrammar("module").terminator;
  for (const token of scopeGrammar("module").order) {
    if (token === "controllers") {
      chunks.push(...makeControllerChunks(module?.type, module?.controllers));
      continue;
    }
    if (token === "midiBindings") {
      const midi = makeMidiBindingsChunk(module);
      if (midi) {
        chunks.push(midi);
      }
      continue;
    }
    if (token === "dataChunks") {
      chunks.push(...makeModuleDataChunks(module));
      continue;
    }
    if (token === "extraChunks") {
      chunks.push(...(module?.extraChunks ?? []).map(cloneJson));
      continue;
    }
    if (token === terminator) {
      chunks.push({ id: terminator, _label: chunkLabel(terminator) });
      continue;
    }
    const chunk = emitScopeField("module", module, token);
    if (chunk) {
      chunks.push(chunk);
    }
  }
  return chunks;
}

function flattenStructuredDocument(document) {
  if (document.magic === "SSYN") {
    return [
      ...(document.preludeChunks ?? []).map(cloneJson),
      ...syncModule(document.module),
      ...(document.trailingChunks ?? []).map(cloneJson),
    ];
  }
  return [
    ...syncProject(document.project),
    ...(document.patterns ?? []).flatMap(syncPattern),
    ...(document.modules ?? []).flatMap(syncModule),
    ...(document.trailingChunks ?? []).map(cloneJson),
  ];
}

export function parseEditableContainer(buffer) {
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

    chunks.push(makeEditableChunk(id, buffer.subarray(dataOffset, nextOffset)));
    offset = nextOffset;
  }

  return {
    format: EDITABLE_TEXT_FORMAT,
    _sourceName: undefined,
    magic,
    headerTailHex: headerTail.toString("hex"),
    _comments: [],
    chunks,
  };
}

export function parseContainer(buffer) {
  return groupStructuredDocument(parseEditableContainer(buffer));
}

export function parseVerboseContainer(buffer) {
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

    chunks.push(makeChunk(id, offset, buffer.subarray(dataOffset, nextOffset)));
    offset = nextOffset;
  }

  return {
    format: VERBOSE_TEXT_FORMAT,
    _sourceName: undefined,
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

export function buildContainer(document) {
  if (
    document?.format !== TEXT_FORMAT &&
    document?.format !== EDITABLE_TEXT_FORMAT &&
    document?.format !== VERBOSE_TEXT_FORMAT
  ) {
    throw new Error(`Unsupported text format: ${JSON.stringify(document?.format)}`);
  }

  assertPrintableFourCc(document.magic, "magic");
  if (!SUPPORTED_MAGICS.has(document.magic)) {
    throw new Error(`Unsupported SunVox container magic: ${JSON.stringify(document.magic)}`);
  }

  if (typeof document.headerTailHex !== "string" || !/^[0-9a-fA-F]{8}$/.test(document.headerTailHex)) {
    throw new Error("headerTailHex must contain exactly 4 bytes of hex");
  }

  const chunks = document.format === TEXT_FORMAT ? flattenStructuredDocument(document) : document.chunks;

  if (!Array.isArray(chunks)) {
    throw new Error("chunks must be an array");
  }

  const parts = [Buffer.from(document.magic, "latin1"), Buffer.from(document.headerTailHex, "hex")];

  for (const [index, chunk] of chunks.entries()) {
    assertPrintableFourCc(chunk.id, `chunks[${index}].id`);
    const data =
      document.format === VERBOSE_TEXT_FORMAT
        ? decodeBase64(chunk.dataBase64, `chunks[${index}].dataBase64`)
        : editableChunkData(chunk, index);

    if (document.format === VERBOSE_TEXT_FORMAT && chunk.size !== undefined && chunk.size !== data.length) {
      throw new Error(`chunks[${index}] size mismatch: expected ${chunk.size}, got ${data.length}`);
    }
    if (document.format === VERBOSE_TEXT_FORMAT && chunk.sha256 !== undefined && chunk.sha256 !== sha256(data)) {
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

export async function encode(inputPath, outputPath) {
  const buffer = await readFile(inputPath);
  const document = parseContainer(buffer);
  document._sourceName = basename(inputPath);
  await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, "utf8");
}

export async function decode(inputPath, outputPath) {
  const json = await readFile(inputPath, "utf8");
  const document = JSON.parse(json);
  const buffer = buildContainer(document);
  await writeFile(outputPath, buffer);
}

export async function verify(inputPath) {
  const buffer = await readFile(inputPath);
  const document = parseContainer(buffer);
  const rebuilt = buildContainer(document);
  if (!rebuilt.equals(buffer)) {
    throw new Error("Round-trip verification failed");
  }
  const chunkCount =
    document.format === TEXT_FORMAT
      ? flattenStructuredDocument(document).length
      : document.chunks.length;
  console.log(`${inputPath}: ${document.magic}, ${chunkCount} chunks, ${buffer.length} bytes`);
}

async function runCli() {
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
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  await runCli();
}

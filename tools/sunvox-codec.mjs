import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { basename, resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const TEXT_FORMAT = "sunvox-structured-text-v1";
export const EDITABLE_TEXT_FORMAT = "sunvox-editable-text-v1";
export const VERBOSE_TEXT_FORMAT = "sunvox-container-text-v1";
export const SUPPORTED_MAGICS = new Set(["SVOX", "SSYN"]);

export const SUNVOX_DB = JSON.parse(
  readFileSync(new URL("./sunvox-db/database.json", import.meta.url), "utf8"),
);

const CHUNKS_BY_ID = new Map(SUNVOX_DB.chunks.map((chunk) => [chunk.id, chunk]));
const CHUNK_DESCRIPTIONS = Object.fromEntries(
  SUNVOX_DB.chunks.map((chunk) => [chunk.id, chunk.label]),
);
const PATTERN_CHUNKS = scopedChunkSet("pattern");
const MODULE_CHUNKS = scopedChunkSet("module");

function chunkDefinition(id) {
  return CHUNKS_BY_ID.get(id);
}

function chunkType(id) {
  return chunkDefinition(id)?.type;
}

function scopedChunkSet(scope) {
  return new Set(SUNVOX_DB.chunks.filter((chunk) => chunk.scope === scope).map((chunk) => chunk.id));
}

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
  const type = chunkType(id);
  if (CHUNK_DESCRIPTIONS[id]) {
    decoded._description = CHUNK_DESCRIPTIONS[id];
  }

  if (type === "string") {
    const text = decodeCString(data);
    if (text !== undefined) {
      return { ...decoded, kind: "string", value: text };
    }
  }

  if (type === "rgb24" && data.length === 3) {
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

  if (type === "structArray:sunvox_note") {
    const pattern = decodePatternNotes(data);
    if (pattern) {
      return { ...decoded, kind: "patternNotes", value: pattern };
    }
  }

  if (type === "structArray:midi_binding" && data.length % 8 === 0) {
    const bindings = [];
    for (let offset = 0; offset < data.length; offset += 8) {
      bindings.push(decodeMidiBinding(data.readUInt32LE(offset), data.readUInt32LE(offset + 4)));
    }
    return { ...decoded, kind: "midiBindings", value: bindings };
  }

  if (type === "int32Array" && data.length % 4 === 0) {
    return { ...decoded, kind: "int32Array", value: readInt32Array(data) };
  }

  if (type === "uint32Array" && data.length % 4 === 0) {
    return { ...decoded, kind: "uint32Array", value: readUInt32Array(data) };
  }

  if (data.length === 0) {
    decoded.kind = "empty";
    return decoded;
  }

  if (type === "int32" && data.length === 4) {
    return { ...decoded, kind: "int32", value: data.readInt32LE(0) };
  }

  if (type === "uint32" && data.length === 4) {
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
  const type = chunkType(chunk.id);
  if (chunk.base64 !== undefined) {
    return decodeBase64(chunk.base64, `chunks[${index}].base64`);
  }
  if (type === "string" && chunk.text !== undefined) {
    return encodeTextChunk(chunk);
  }
  if (type === "rgb24" && chunk.rgb !== undefined) {
    return encodeRgbChunk(chunk);
  }
  if ((type === "int32" || type === "uint32") && chunk.value !== undefined) {
    const buffer = Buffer.alloc(4);
    if (type === "int32") {
      buffer.writeInt32LE(chunk.value, 0);
    } else {
      buffer.writeUInt32LE(chunk.value, 0);
    }
    return buffer;
  }
  if (type === "int32Array" && Array.isArray(chunk.values)) {
    return writeInt32Array(chunk.values);
  }
  if (type === "uint32Array" && Array.isArray(chunk.values)) {
    return writeUInt32Array(chunk.values);
  }
  if (type === "structArray:midi_binding" && Array.isArray(chunk.midiBindings)) {
    const buffer = Buffer.alloc(chunk.midiBindings.length * 8);
    chunk.midiBindings.forEach((binding, bindingIndex) => {
      const values = encodeMidiBinding(binding);
      const offset = bindingIndex * 8;
      buffer.writeUInt32LE(values[0], offset);
      buffer.writeUInt32LE(values[1], offset + 4);
    });
    return buffer;
  }
  if (type === "structArray:sunvox_note" && chunk.pattern !== undefined) {
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

const BINARY_TYPES = {
  bool8: { size: 1, read: "readUInt8", write: "writeUInt8" },
  int32: { size: 4, read: "readInt32LE", write: "writeInt32LE" },
  uint8: { size: 1, read: "readUInt8", write: "writeUInt8" },
  uint16: { size: 2, read: "readUInt16LE", write: "writeUInt16LE" },
  uint32: { size: 4, read: "readUInt32LE", write: "writeUInt32LE" },
};

function binaryType(field) {
  const type = BINARY_TYPES[field.type];
  if (!type) {
    throw new Error(`Unsupported binary field type: ${field.type}`);
  }
  return type;
}

function binaryFieldSize(field) {
  return binaryType(field).size * (field.count ?? 1);
}

function readBinaryScalar(data, field, offset) {
  let value = data[binaryType(field).read](offset);
  if (field.type === "bool8") {
    value = Boolean(value);
    return field.invert ? !value : value;
  }
  if (field.bitflags) {
    return decodeBitflags(field.bitflags, value);
  }
  if (field.enum) {
    return enumToName(field.enum, value);
  }
  return value;
}

function writeBinaryScalar(buffer, field, offset, value) {
  let binaryValue = value;
  if (field.type === "bool8") {
    binaryValue = field.invert ? !Boolean(value) : Boolean(value);
  } else if (field.bitflags) {
    binaryValue = encodeBitflags(field.bitflags, value ?? 0);
  } else if (field.enum) {
    binaryValue = enumToValue(field.enum, value ?? 0);
  }

  buffer[binaryType(field).write](field.type === "bool8" ? (binaryValue ? 1 : 0) : (binaryValue ?? 0), offset);
}

function readBinaryField(data, field, baseOffset = 0) {
  const offset = baseOffset + field.offset;
  if (offset + binaryFieldSize(field) > data.length) {
    return cloneJson(field.default);
  }
  if (!field.count) {
    return readBinaryScalar(data, field, offset);
  }
  const values = [];
  const itemSize = binaryFieldSize({ ...field, count: 1 });
  for (let index = 0; index < field.count; index += 1) {
    values.push(readBinaryScalar(data, field, offset + index * itemSize));
  }
  return values;
}

function writeBinaryField(buffer, field, object, baseOffset = 0) {
  const offset = baseOffset + field.offset;
  const value = object?.[field.name] ?? cloneJson(field.default);
  if (!field.count) {
    writeBinaryScalar(buffer, field, offset, value);
    return;
  }
  const values = Array.isArray(value) ? value : [];
  const defaults = Array.isArray(field.default) ? field.default : [];
  const itemSize = binaryFieldSize({ ...field, count: 1 });
  for (let index = 0; index < field.count; index += 1) {
    writeBinaryScalar(buffer, field, offset + index * itemSize, values[index] ?? defaults[index] ?? 0);
  }
}

function binaryLayoutSize(fields) {
  return Math.max(0, ...fields.map((field) => field.offset + binaryFieldSize(field)));
}

function valuesEqual(left, right) {
  if (Array.isArray(left) || Array.isArray(right)) {
    return JSON.stringify(left ?? []) === JSON.stringify(right ?? []);
  }
  return left === right;
}

function decodeStructData(data, definition) {
  const object = {};
  for (const field of definition.fields ?? []) {
    const value = readBinaryField(data, field);
    if (value !== undefined) {
      object[field.name] = value;
    }
  }
  if (!definition.path) {
    return object;
  }
  const result = {};
  setPath(result, definition.path, object);
  return result;
}

function encodeStructData(dataChunk, definition) {
  const object = definition.path ? getPath(dataChunk, definition.path) : dataChunk;
  if (!object || typeof object !== "object") {
    return undefined;
  }
  const buffer = Buffer.alloc(definition.size ?? binaryLayoutSize(definition.fields ?? []));
  for (const field of definition.fields ?? []) {
    writeBinaryField(buffer, field, object);
  }
  return buffer;
}

function decodePackedUInt32Array(data, definition) {
  if (data.length % 4 !== 0) {
    return undefined;
  }
  const values = [];
  for (let offset = 0, index = 0; offset + 4 <= data.length; offset += 4, index += 1) {
    const packed = data.readUInt32LE(offset);
    if (definition.omitZero && packed === 0) {
      continue;
    }
    const value = { [definition.indexField ?? "index"]: index };
    for (const field of definition.fields ?? []) {
      value[field.name] = (packed >>> field.shift) & bitMask(field.bits);
    }
    values.push(value);
  }
  return {
    count: definition.count ?? Math.floor(data.length / 4),
    [definition.path]: values,
  };
}

function encodePackedUInt32Array(dataChunk, definition) {
  const values = getPath(dataChunk, definition.path);
  if (!Array.isArray(values)) {
    return undefined;
  }
  const count = dataChunk.count ?? definition.count ?? values.length;
  const buffer = Buffer.alloc(count * 4);
  for (const value of values) {
    const index = value[definition.indexField ?? "index"];
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw new Error(`Invalid ${definition.name} index: ${index}`);
    }
    let packed = 0;
    for (const field of definition.fields ?? []) {
      packed |= ((value[field.name] ?? 0) & bitMask(field.bits)) << field.shift;
    }
    buffer.writeUInt32LE(packed >>> 0, index * 4);
  }
  return buffer;
}

function decodeRecordArray(data, definition) {
  const recordSize = definition.recordSize ?? binaryLayoutSize(definition.fields ?? []);
  if (recordSize <= 0 || data.length % recordSize !== 0) {
    return undefined;
  }
  const records = [];
  const count = Math.floor(data.length / recordSize);
  for (let index = 0; index < count; index += 1) {
    const record = { [definition.indexField ?? "index"]: index };
    let hasNonDefault = false;
    for (const field of definition.fields ?? []) {
      const value = readBinaryField(data, field, index * recordSize);
      const defaultValue = cloneJson(field.default);
      if (!valuesEqual(value, defaultValue)) {
        hasNonDefault = true;
        record[field.name] = value;
      } else if (!definition.omitDefaults) {
        record[field.name] = value;
      }
    }
    if (!definition.omitDefaultRecords || hasNonDefault) {
      records.push(record);
    }
  }
  return {
    count: definition.count ?? count,
    [definition.path]: records,
  };
}

function encodeRecordArray(dataChunk, definition) {
  const records = getPath(dataChunk, definition.path);
  if (!Array.isArray(records)) {
    return undefined;
  }
  const count = dataChunk.count ?? definition.count ?? records.length;
  const recordSize = definition.recordSize ?? binaryLayoutSize(definition.fields ?? []);
  const buffer = Buffer.alloc(count * recordSize);
  const emptyRecord = {};
  for (const field of definition.fields ?? []) {
    emptyRecord[field.name] = cloneJson(field.default);
  }
  for (let index = 0; index < count; index += 1) {
    for (const field of definition.fields ?? []) {
      writeBinaryField(buffer, field, emptyRecord, index * recordSize);
    }
  }
  for (const record of records) {
    const index = record[definition.indexField ?? "index"];
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw new Error(`Invalid ${definition.name} index: ${index}`);
    }
    for (const field of definition.fields ?? []) {
      writeBinaryField(buffer, field, record, index * recordSize);
    }
  }
  return buffer;
}

function decodeStringData(data, definition) {
  const text = decodeCString(data);
  if (text === undefined) {
    return undefined;
  }
  if (definition.format === "metamoduleControllerName") {
    return decodeMetaModuleControllerName(text);
  }
  return { [definition.path ?? "text"]: text };
}

function encodeStringData(dataChunk, definition) {
  if (definition.format === "metamoduleControllerName") {
    if (dataChunk.text === undefined && dataChunk.label === undefined) {
      return undefined;
    }
    return encodeMetaModuleControllerName(dataChunk);
  }
  const text = getPath(dataChunk, definition.path ?? "text");
  return text === undefined ? undefined : Buffer.from(`${text}\0`, "utf8");
}

const MODULE_DATA_CODECS = {
  container: {
    decode(data, definition) {
      const magic = data.length >= 4 ? toAscii(data.subarray(0, 4)) : undefined;
      if (!SUPPORTED_MAGICS.has(magic) || (definition.magic && !definition.magic.includes(magic))) {
        return undefined;
      }
      return { container: parseContainer(data) };
    },
    encode(dataChunk) {
      return dataChunk.container ? buildContainer(dataChunk.container) : undefined;
    },
  },
  packedUInt32Array: {
    decode: decodePackedUInt32Array,
    encode: encodePackedUInt32Array,
  },
  recordArray: {
    decode: decodeRecordArray,
    encode: encodeRecordArray,
  },
  string: {
    decode: decodeStringData,
    encode: encodeStringData,
  },
  struct: {
    decode: decodeStructData,
    encode: encodeStructData,
  },
  uint16Array: {
    decode(data, definition) {
      if (data.length % 2 !== 0) {
        return undefined;
      }
      return {
        count: definition.count ?? data.length / 2,
        values: readUInt16Array(data),
      };
    },
    encode(dataChunk) {
      return Array.isArray(dataChunk.values) ? writeUInt16Array(dataChunk.values) : undefined;
    },
  },
};

function decodeModuleDataPayload(definition, data) {
  return definition ? MODULE_DATA_CODECS[definition.type]?.decode?.(data, definition) : undefined;
}

function encodeModuleDataPayload(dataChunk, definition) {
  const encoded = definition ? MODULE_DATA_CODECS[definition.type]?.encode?.(dataChunk, definition) : undefined;
  if (encoded !== undefined) {
    return encoded;
  }
  if (dataChunk.container) {
    return buildContainer(dataChunk.container);
  }
  if (dataChunk.label !== undefined || dataChunk.text !== undefined) {
    return encodeMetaModuleControllerName(dataChunk);
  }
  if (Array.isArray(dataChunk.values)) {
    return writeUInt16Array(dataChunk.values);
  }
  return dataChunk.base64 === undefined ? Buffer.alloc(0) : decodeBase64(dataChunk.base64, "module data chunk");
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
    const decoded = decodeModuleDataPayload(definition, data);
    if (decoded) {
      Object.assign(dataChunk, decoded);
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
    } else {
      chunks.push({
        id: "CHDT",
        _label: chunkLabel("CHDT"),
        base64: encodeModuleDataPayload(dataChunk, definition).toString("base64"),
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

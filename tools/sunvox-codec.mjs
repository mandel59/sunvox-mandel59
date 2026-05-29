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
const MODULE_CONTROLLER_CACHE = new Map();
let MODULE_LINK_RELATIONS;
const PATTERN_CHUNKS = scopedChunkSet("pattern");
const MODULE_CHUNKS = scopedChunkSet("module");
const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

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
  node tools/sunvox-codec.mjs verify <input.sunvox|input.sunsynth>
  node tools/sunvox-codec.mjs validate <input.sunvox|input.sunsynth|input.json>`);
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

function readInt8Array(data) {
  const values = [];
  for (let offset = 0; offset < data.length; offset += 1) {
    values.push(data.readInt8(offset));
  }
  return values;
}

function readUInt8Array(data) {
  return [...data];
}

function writeInt32Array(values) {
  const buffer = Buffer.alloc(values.length * 4);
  values.forEach((value, index) => buffer.writeInt32LE(value, index * 4));
  return buffer;
}

function writeUInt8Array(values) {
  return Buffer.from(values.map((value) => value & 0xff));
}

function writeInt8Array(values) {
  const buffer = Buffer.alloc(values.length);
  values.forEach((value, index) => buffer.writeInt8(value, index));
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

function tryEnumToValue(enumName, value) {
  try {
    return enumToValue(enumName, value);
  } catch {
    return undefined;
  }
}

function bitMask(bits) {
  return bits === 32 ? 0xffffffff : (2 ** bits) - 1;
}

function unpackBitfield(bitfieldName, value, options = {}) {
  const definition = SUNVOX_DB.bitfields[bitfieldName];
  if (!definition) {
    throw new Error(`Unknown bitfield: ${bitfieldName}`);
  }
  const result = {};
  for (const field of definition.fields) {
    const rawValue = (value >>> field.shift) & bitMask(field.bits);
    const decodedValue = decodeBitfieldField(field, rawValue);
    if (options.omitDefaults) {
      const defaultValue = defaultBitfieldFieldValue(field);
      if (sameJsonValue(decodedValue, defaultValue)) {
        continue;
      }
    }
    result[field.name] = decodedValue;
  }
  return result;
}

function packBitfield(bitfieldName, value) {
  const definition = SUNVOX_DB.bitfields[bitfieldName];
  if (!definition) {
    throw new Error(`Unknown bitfield: ${bitfieldName}`);
  }
  if (typeof value === "number") {
    return value >>> 0;
  }
  let packed = 0;
  for (const field of definition.fields) {
    const rawFieldValue = value?.[field.name] ?? defaultBitfieldFieldValue(field);
    const fieldValue = encodeBitfieldField(field, rawFieldValue);
    packed |= (fieldValue & bitMask(field.bits)) << field.shift;
  }
  return packed >>> 0;
}

function decodeBitfieldField(field, rawValue) {
  if (field.bitflags) {
    return decodeBitflags(field.bitflags, rawValue);
  }
  if (field.enum) {
    return enumToName(field.enum, rawValue);
  }
  return rawValue;
}

function encodeBitfieldField(field, value) {
  if (field.bitflags) {
    return encodeBitflags(field.bitflags, value);
  }
  if (field.enum) {
    return enumToValue(field.enum, value);
  }
  return value;
}

function defaultBitfieldFieldValue(field) {
  return field.default ?? decodeBitfieldField(field, 0);
}

function sameJsonValue(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function decodeBitflags(bitflagName, value) {
  const definition = SUNVOX_DB.bitflags?.[bitflagName] ?? [];
  const result = {};
  let knownMask = 0;
  for (const flag of definition) {
    knownMask |= 1 << flag.bit;
    if (value & (1 << flag.bit)) {
      result[flag.name] = true;
    }
  }
  const unknown = value & ~knownMask;
  if (unknown) {
    result.unknown = unknown >>> 0;
  }
  return result;
}

function encodeBitflags(bitflagName, value) {
  if (typeof value === "number") {
    return value >>> 0;
  }
  const definition = SUNVOX_DB.bitflags?.[bitflagName] ?? [];
  let result = value?.unknown ?? 0;
  for (const flag of definition) {
    if (value?.[flag.name]) {
      result |= 1 << flag.bit;
    }
  }
  return result >>> 0;
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

export function decodeChunkData(id, data) {
  const decoded = {};
  const type = chunkType(id);
  const structArray = structArrayDefinition(type);
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

  if (structArray) {
    const value = decodeStructArrayData(data, structArray);
    if (value) {
      return { ...decoded, kind: structArray.kind ?? "structArray", value };
    }
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

function structTextTupleFields(definition) {
  return definition?.textLayout?.tupleFields ?? definition?.fields?.map((field) => field.name) ?? [];
}

function tupleRecordToObject(record, definition) {
  if (!Array.isArray(record)) {
    return record;
  }
  const tupleFields = structTextTupleFields(definition);
  return Object.fromEntries(tupleFields.map((fieldName, index) => [fieldName, record[index]]));
}

function compactPatternNotes(pattern, definition) {
  const tupleFields = structTextTupleFields(definition);
  return {
    events: pattern.events.map((event) => tupleFields.map((fieldName) => event[fieldName] ?? 0)),
  };
}

function patternNoteValueToText(value) {
  if (value === 0) {
    return undefined;
  }
  if (value > 0 && value < 128) {
    const note = value - 1;
    return `${NOTE_NAMES[note % 12]}${Math.floor(note / 12)}`;
  }
  const command = enumToName("sunvox_note_command", value);
  return typeof command === "string" ? command : value;
}

function patternNoteTextToValue(value) {
  if (value === undefined) {
    return 0;
  }
  if (typeof value === "number") {
    return value;
  }
  if (typeof value !== "string") {
    throw new Error(`Invalid pattern note value: ${value}`);
  }
  const commandValue = tryEnumToValue("sunvox_note_command", value);
  if (commandValue !== undefined) {
    return commandValue;
  }
  const match = /^([A-G])(#?)(-?\d+)$/u.exec(value);
  if (!match) {
    throw new Error(`Invalid pattern note name: ${value}`);
  }
  const pitchClass = NOTE_NAMES.indexOf(`${match[1]}${match[2]}`);
  if (pitchClass < 0) {
    throw new Error(`Invalid pattern note pitch class: ${value}`);
  }
  const noteNumber = Number(match[3]) * 12 + pitchClass;
  return noteNumber + 1;
}

function patternModuleFromStored(value) {
  return value === 0 ? undefined : value - 1;
}

function patternModuleToStored(value) {
  return value === undefined ? 0 : value + 1;
}

function moduleControllerName(module, index) {
  const definition = moduleControllers(module?.type).find((controller) => controller.index === index);
  return definition ? controllerPath(definition) : undefined;
}

function moduleControllerIndex(module, name) {
  return moduleControllers(module?.type).find((controller) => controllerPath(controller) === name || controller.name === name)?.index;
}

function decodePatternController(value, module, event) {
  const controllerNumber = value >>> 8;
  const effect = value & 0xff;
  if (controllerNumber > 0 && controllerNumber < 128) {
    const controllerIndex = controllerNumber - 1;
    const controllerName = moduleControllerName(module, controllerIndex);
    event.controller = controllerName ?? controllerIndex;
    if (controllerName) {
      event._controllerIndex = controllerIndex;
    }
  } else if (controllerNumber >= 128) {
    event.midiController = controllerNumber - 128;
  }
  if (effect) {
    event.effect = effect;
  }
}

function encodePatternController(event, module) {
  let controllerNumber = 0;
  if (event.midiController !== undefined) {
    controllerNumber = event.midiController + 128;
  } else if (event.controller !== undefined) {
    const controllerIndex =
      typeof event.controller === "string" ? moduleControllerIndex(module, event.controller) : event.controller;
    if (controllerIndex === undefined) {
      throw new Error(`Unknown pattern controller: ${event.controller}`);
    }
    controllerNumber = controllerIndex + 1;
  }
  const effect = typeof event.effect === "number" ? event.effect : 0;
  return ((controllerNumber & 0xff) << 8) | (effect & 0xff);
}

function patternFieldSemantics(definition, fieldName) {
  return definition?.textLayout?.fieldSemantics?.[fieldName] ?? {};
}

function semanticEventFieldValue(event, fieldName, semantics) {
  if (event[fieldName] !== undefined) {
    return event[fieldName];
  }
  for (const alias of semantics.aliases ?? []) {
    if (event[alias] !== undefined) {
      return event[alias];
    }
  }
  return undefined;
}

function shouldKeepDecodedPatternField(fieldName, value, semantics, rawRecord) {
  if (value !== 0) {
    return true;
  }
  if (semantics.zero === "omitUnlessController") {
    return (rawRecord.controller ?? 0) !== 0;
  }
  return !["default", "empty", "none"].includes(semantics.zero) && fieldName !== "value";
}

function annotatePatternModuleReference(event, fieldName, module, semantics) {
  if (semantics.reference !== "modules") {
    return;
  }
  if (module?.name) {
    event[`_${fieldName}Name`] = module.name;
  }
  if (module?.type) {
    event[`_${fieldName}Type`] = module.type;
  }
}

function applyDecodedPatternField(event, fieldName, value, context) {
  const semantics = patternFieldSemantics(context.definition, fieldName);
  switch (semantics.encoding) {
    case "sunvoxNote": {
      const note = patternNoteValueToText(value);
      if (note !== undefined) {
        event[fieldName] = note;
      }
      return;
    }
    case "oneBasedModuleIndex": {
      const moduleIndex = patternModuleFromStored(value);
      if (moduleIndex !== undefined) {
        const module = context.modules?.[moduleIndex];
        event[fieldName] = moduleIndex;
        context.module = module;
        annotatePatternModuleReference(event, fieldName, module, semantics);
      }
      return;
    }
    case "packedPatternControllerEffect":
      decodePatternController(value, context.module, event);
      return;
    default:
      if (shouldKeepDecodedPatternField(fieldName, value, semantics, context.rawRecord)) {
        event[fieldName] = value;
      }
  }
}

function encodePatternEventField(fieldName, event, context) {
  const semantics = patternFieldSemantics(context.definition, fieldName);
  const value = semanticEventFieldValue(event, fieldName, semantics);
  switch (semantics.encoding) {
    case "sunvoxNote":
      return patternNoteTextToValue(value);
    case "oneBasedModuleIndex":
      return patternModuleToStored(value);
    case "packedPatternControllerEffect":
      return encodePatternController(event, context.module);
    default:
      return value === "default" && semantics.zero === "default" ? 0 : (value ?? 0);
  }
}

function emptyPatternRecord(definition) {
  return Object.fromEntries(structTextTupleFields(definition).map((fieldName) => [fieldName, 0]));
}

function patternRecordIsEmpty(record, definition) {
  const object = tupleRecordToObject(record, definition);
  return structTextTupleFields(definition).every((fieldName) => (object?.[fieldName] ?? 0) === 0);
}

function patternRecordToSemanticEvent(record, index, columns, modules, definition) {
  const object = tupleRecordToObject(record, definition);
  const event = {
    line: Math.floor(index / columns),
    track: index % columns,
  };
  const context = { definition, modules, rawRecord: object };
  for (const fieldName of structTextTupleFields(definition)) {
    applyDecodedPatternField(event, fieldName, object[fieldName] ?? 0, context);
  }
  return event;
}

function patternEventColumns(pattern, records = []) {
  if (pattern?.eventColumns !== undefined) {
    return pattern.eventColumns;
  }
  if (records.length && pattern?.lines && records.length % pattern.lines === 0) {
    return records.length / pattern.lines;
  }
  return pattern?.tracks ?? Math.max(1, records.length);
}

function patternEventRows(pattern, columns, records = []) {
  if (pattern?.eventRows !== undefined) {
    return pattern.eventRows;
  }
  if (records.length && columns && records.length % columns === 0) {
    return records.length / columns;
  }
  return pattern?.lines ?? Math.ceil(records.length / columns);
}

function semanticPatternEvents(pattern, modules) {
  if (!Array.isArray(pattern?.events)) {
    return pattern;
  }
  const definition = SUNVOX_DB.structs.sunvox_note;
  const records = pattern.events.map((event) => tupleRecordToObject(event, definition));
  const columns = patternEventColumns(pattern, records);
  const rows = patternEventRows(pattern, columns, records);
  const events = records
    .map((record, index) =>
      patternRecordIsEmpty(record, definition)
        ? undefined
        : patternRecordToSemanticEvent(record, index, columns, modules, definition),
    )
    .filter(Boolean);

  pattern.events = events;
  if (columns !== pattern.tracks) {
    pattern.eventColumns = columns;
  }
  if (rows !== pattern.lines) {
    pattern.eventRows = rows;
  }
  return pattern;
}

function patternSemanticEventToRecord(event, modules, definition) {
  if (!event || typeof event !== "object") {
    return tupleRecordToObject(event, definition);
  }
  if (event.line === undefined && event.track === undefined) {
    return tupleRecordToObject(event, definition);
  }
  const context = { definition, modules, module: modules?.[event.module] };
  return Object.fromEntries(
    structTextTupleFields(definition).map((fieldName) => [fieldName, encodePatternEventField(fieldName, event, context)]),
  );
}

function patternEventRecords(pattern, modules) {
  if (!Array.isArray(pattern?.events)) {
    return undefined;
  }
  const definition = SUNVOX_DB.structs.sunvox_note;
  const sparse =
    pattern.events.length === 0
      ? pattern.eventColumns !== undefined ||
        pattern.eventRows !== undefined ||
        pattern.tracks !== undefined ||
        pattern.lines !== undefined
      : pattern.events.some(
          (event) => event && typeof event === "object" && !Array.isArray(event) && (event.line !== undefined || event.track !== undefined),
        );
  if (!sparse) {
    return pattern.events.map((event) => tupleRecordToObject(event, definition));
  }
  const columns = patternEventColumns(pattern);
  const rows = patternEventRows(pattern, columns);
  const records = Array.from({ length: columns * rows }, () => emptyPatternRecord(definition));
  for (const event of pattern.events) {
    const line = event.line ?? 0;
    const track = event.track ?? 0;
    const index = line * columns + track;
    if (index < 0 || index >= records.length) {
      throw new Error(`Pattern event is outside the event grid: line ${line}, track ${track}`);
    }
    records[index] = patternSemanticEventToRecord(event, modules, definition);
  }
  return records;
}

function makeEditableChunk(id, data) {
  const chunk = { id };
  const structArray = structArrayDefinition(chunkType(id));
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
      chunk.pattern = compactPatternNotes(decoded.value, structArray);
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
  const structArray = structArrayDefinition(type);
  if (structArray) {
    const values = getPath(chunk, structArray.path);
    if (values !== undefined) {
      return encodeStructArrayData(values, structArray);
    }
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
  for (const [index, segment] of segments.slice(0, -1).entries()) {
    const nextSegment = segments[index + 1];
    current[segment] ??= /^\d+$/u.test(nextSegment) ? [] : {};
    current = current[segment];
  }
  current[segments.at(-1)] = value;
}

function chunkSemanticValue(chunk, field) {
  const fieldName = typeof field === "string" ? field : field.field;
  const value = fieldName === "pattern.events" ? chunk.pattern?.events : chunk[fieldName];
  if (value === undefined) {
    return value;
  }
  if (field.bitflags) {
    return decodeBitflags(field.bitflags, value);
  }
  if (field.bitfield) {
    return unpackBitfield(field.bitfield, value, { omitDefaults: field.omitDefaults });
  }
  if (field.enum) {
    return enumToName(field.enum, value);
  }
  return value;
}

function assignChunkSemanticValue(chunk, field, value) {
  const fieldName = typeof field === "string" ? field : field.field;
  let chunkValue = value;
  if (field.bitflags) {
    chunkValue = encodeBitflags(field.bitflags, value);
  } else if (field.bitfield) {
    chunkValue = packBitfield(field.bitfield, value);
  } else if (field.enum) {
    chunkValue = enumToValue(field.enum, value);
  }
  if (fieldName === "pattern.events") {
    chunk.pattern = { events: chunkValue };
  } else {
    chunk[fieldName] = chunkValue;
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
  assignChunkSemanticValue(chunk, options.field ? options : field, value);
  if (options.field === "text" && options.textSize !== undefined) {
    chunk.textSize = options.textSize;
  }
  return chunk;
}

function moduleLinkRelations() {
  if (MODULE_LINK_RELATIONS) {
    return MODULE_LINK_RELATIONS;
  }
  MODULE_LINK_RELATIONS = SUNVOX_DB.chunks
    .filter((chunk) => chunk.scope === "module" && chunk.linkSlots?.linkChunk)
    .map((slotChunk) => {
      const linkChunk = chunkDefinition(slotChunk.linkSlots.linkChunk);
      if (!linkChunk) {
        return undefined;
      }
      return {
        linksChunk: linkChunk.id,
        slotsChunk: slotChunk.id,
        linksPath: slotChunk.linkSlots.localLinksPath ?? linkChunk.name,
        slotsPath: slotChunk.name,
        semanticPath: slotChunk.linkSlots.semanticPath,
        slotCountPath: slotChunk.linkSlots.slotCountPath,
      };
    })
    .filter(Boolean)
    .filter((relation) => relation.linksPath && relation.slotsPath && relation.semanticPath && relation.slotCountPath);
  return MODULE_LINK_RELATIONS;
}

function moduleLinkRelationForChunk(chunkId) {
  return moduleLinkRelations().find((relation) => relation.linksChunk === chunkId || relation.slotsChunk === chunkId);
}

function semanticLinksFromArrays(module, linksPath, slotsPath, modules) {
  const links = module?.[linksPath];
  if (!Array.isArray(links)) {
    return [];
  }
  const slots = module?.[slotsPath];
  return links
    .map((linkedModule, slot) => {
      if (!Number.isInteger(linkedModule) || linkedModule < 0) {
        return undefined;
      }
      const peer = modules?.[linkedModule];
      const link = { slot, module: linkedModule };
      if (Number.isInteger(slots?.[slot]) && slots[slot] >= 0) {
        link.peerSlot = slots[slot];
      }
      if (peer?.name) {
        link._moduleName = peer.name;
      }
      if (peer?.type) {
        link._moduleType = peer.type;
      }
      return link;
    })
    .filter(Boolean);
}

function inferredLinkSlotCount(links) {
  if (!links.length) {
    return 0;
  }
  return Math.max(...links.map((link) => link.slot)) + 1;
}

function preservedLinkSlotCount(rawLinks, semanticLinks) {
  if (!Array.isArray(rawLinks)) {
    return undefined;
  }
  if (rawLinks.length === 0) {
    return 0;
  }
  const inferred = inferredLinkSlotCount(semanticLinks);
  return rawLinks.length === inferred ? undefined : rawLinks.length;
}

function normalizeModuleLinks(module, modules) {
  for (const relation of moduleLinkRelations()) {
    const links = semanticLinksFromArrays(module, relation.linksPath, relation.slotsPath, modules);
    const slotCount = preservedLinkSlotCount(module[relation.linksPath], links);
    delete module[relation.linksPath];
    delete module[relation.slotsPath];
    if (links.length) {
      module[relation.semanticPath] = links;
    }
    if (slotCount !== undefined) {
      module[relation.slotCountPath] = slotCount;
    }
  }
  return module;
}

function normalizeModuleCollectionLinks(modules) {
  for (const module of modules) {
    normalizeModuleLinks(module, modules);
  }
  return modules;
}

function semanticLinksToArrays(links, legacyLinks, legacySlots, slotCount) {
  if (!Array.isArray(links)) {
    return { links: legacyLinks, slots: legacySlots };
  }
  const maxSlot = links.reduce((max, link, index) => {
    const slot = Number.isInteger(link?.slot) ? link.slot : index;
    return Math.max(max, slot);
  }, -1);
  const count = slotCount ?? maxSlot + 1;
  if (count < maxSlot + 1) {
    throw new Error(`module link slot count ${count} is smaller than highest slot ${maxSlot}`);
  }
  const storedLinks = Array.from({ length: count }, () => -1);
  const storedSlots = Array.from({ length: count }, () => -1);
  let hasSlots = false;
  for (const [index, link] of links.entries()) {
    const slot = Number.isInteger(link?.slot) ? link.slot : index;
    if (slot < 0 || slot >= storedLinks.length) {
      throw new Error(`Invalid module link slot: ${slot}`);
    }
    if (!Number.isInteger(link.module) || link.module < 0) {
      throw new Error(`Invalid module link target at slot ${slot}: ${link.module}`);
    }
    if (storedLinks[slot] !== -1) {
      throw new Error(`Duplicate module link slot: ${slot}`);
    }
    storedLinks[slot] = link.module;
    if (Number.isInteger(link.peerSlot) && link.peerSlot >= 0) {
      storedSlots[slot] = link.peerSlot;
      hasSlots = true;
    }
  }
  return { links: storedLinks, slots: hasSlots ? storedSlots : undefined };
}

function moduleLinkArrays(module, relation) {
  const semanticLinks = Array.isArray(module?.[relation.semanticPath])
    ? module[relation.semanticPath]
    : module?.[relation.slotCountPath] !== undefined
      ? []
      : undefined;
  return semanticLinksToArrays(
    semanticLinks,
    module?.[relation.linksPath],
    module?.[relation.slotsPath],
    module?.[relation.slotCountPath],
  );
}

function emitModuleLinkChunk(module, chunkId) {
  const relation = moduleLinkRelationForChunk(chunkId);
  if (!relation) {
    return undefined;
  }
  const { links, slots } = moduleLinkArrays(module, relation);
  if (chunkId === relation.linksChunk) {
    return links === undefined ? undefined : makeSemanticChunk(chunkId, "values", links);
  }
  if (chunkId === relation.slotsChunk) {
    return slots === undefined ? undefined : makeSemanticChunk(chunkId, "values", slots);
  }
  return undefined;
}

function validationIssue(rule, path, value, message) {
  return {
    severity: rule.severity ?? "warning",
    rule: rule.id,
    path,
    value,
    message,
    source: rule.source,
    trackingIssue: rule.trackingIssue,
  };
}

export function formatValidationIssue(issue) {
  const source = issue.source ? ` source=${issue.source}` : "";
  const trackingIssue = Number.isInteger(issue.trackingIssue) ? ` issue=#${issue.trackingIssue}` : "";
  return `${issue.severity}: ${issue.path}: ${issue.message} (${issue.rule})${source}${trackingIssue}`;
}

function validateIntegerRange(value, rule, path) {
  if (value === undefined) {
    return [];
  }
  if (!Number.isInteger(value)) {
    return [validationIssue(rule, path, value, `${path} must be an integer`)];
  }
  const issues = [];
  if (rule.min !== undefined && value < rule.min) {
    issues.push(validationIssue(rule, path, value, `${path} is ${value}; expected >= ${rule.min}`));
  }
  if (rule.max !== undefined && value > rule.max) {
    issues.push(validationIssue(rule, path, value, `${path} is ${value}; expected <= ${rule.max}`));
  }
  return issues;
}

function validateMaxUtf8Bytes(value, rule, path) {
  if (value === undefined) {
    return [];
  }
  if (typeof value !== "string") {
    return [validationIssue(rule, path, value, `${path} must be a string`)];
  }
  const byteLength = Buffer.byteLength(value, "utf8");
  if (byteLength > rule.maxBytes) {
    return [
      validationIssue(rule, path, value, `${path} is ${byteLength} UTF-8 bytes; expected <= ${rule.maxBytes}`),
    ];
  }
  return [];
}

function validateRuntimeValue(value, rule, path) {
  if (rule.kind === "integerRange") {
    return validateIntegerRange(value, rule, path);
  }
  if (rule.kind === "maxUtf8Bytes") {
    return validateMaxUtf8Bytes(value, rule, path);
  }
  return [validationIssue(rule, path, value, `Unsupported runtime constraint kind: ${rule.kind}`)];
}

function documentModuleEntries(document) {
  if (document?.module) {
    return [{ module: document.module, path: "module" }];
  }
  return (document?.modules ?? []).map((module, index) => ({ module, path: `modules[${index}]` }));
}

function validateRuntimeConstraint(document, rule) {
  if (rule.scope === "project") {
    return validateRuntimeValue(getPath(document.project, rule.path), rule, `project.${rule.path}`);
  }
  if (rule.scope === "module") {
    return documentModuleEntries(document).flatMap((entry) =>
      validateRuntimeValue(getPath(entry.module, rule.path), rule, `${entry.path}.${rule.path}`),
    );
  }
  if (rule.scope === "moduleLink") {
    return documentModuleEntries(document).flatMap((entry) => {
      const links = entry.module?.[rule.relation];
      if (!Array.isArray(links)) {
        return [];
      }
      return links.flatMap((link, index) =>
        validateRuntimeValue(getPath(link, rule.path), rule, `${entry.path}.${rule.relation}[${index}].${rule.path}`),
      );
    });
  }
  return [validationIssue(rule, rule.path, undefined, `Unsupported runtime constraint scope: ${rule.scope}`)];
}

function controllerValidationIssue(moduleEntry, controller, path, value, message) {
  return {
    severity: "warning",
    rule: "module.controller.range",
    path,
    value,
    message,
    source: controller.sourceSymbol ?? "psynth_register_ctl",
    trackingIssue: 2,
    moduleType: moduleEntry.module.type,
    controller: controller.name,
    controllerIndex: controller.index,
  };
}

function controllerStoredValue(controller, value) {
  if (controller.type !== "enum") {
    return value;
  }
  return tryEnumToValue(controller.enum, value);
}

function validateControllerValue(moduleEntry, controller) {
  const controllers = moduleEntry.module?.controllers;
  if (!controllers || typeof controllers !== "object" || Array.isArray(controllers)) {
    return [];
  }
  const path = `${moduleEntry.path}.controllers.${controllerPath(controller)}`;
  const value = getPath(controllers, controllerPath(controller));
  if (value === undefined) {
    return [];
  }
  const storedValue = controllerStoredValue(controller, value);
  if (!Number.isInteger(storedValue)) {
    return [
      controllerValidationIssue(
        moduleEntry,
        controller,
        path,
        value,
        `${path} must be a known ${controller.enum ?? "controller"} value`,
      ),
    ];
  }
  return validateIntegerRange(storedValue, controller, path).map((issue) =>
    controllerValidationIssue(moduleEntry, controller, path, value, issue.message),
  );
}

function validateModuleControllers(document) {
  return documentModuleEntries(document).flatMap((entry) =>
    moduleControllers(entry.module?.type).flatMap((controller) => validateControllerValue(entry, controller)),
  );
}

export function validateContainer(document) {
  const issues = [
    ...(SUNVOX_DB.runtimeConstraints ?? []).flatMap((rule) => validateRuntimeConstraint(document, rule)),
    ...validateModuleControllers(document),
  ];
  return {
    ok: !issues.some((issue) => issue.severity === "error"),
    issues,
  };
}

function consumeScopeFields(scopeName, chunks, target, used) {
  const grammar = scopeGrammar(scopeName);
  for (const field of grammar.fields) {
    const index = chunks.findIndex((chunk, chunkIndex) => !used.has(chunkIndex) && chunk.id === field.chunk);
    if (index < 0) {
      continue;
    }
    const value = chunkSemanticValue(chunks[index], field);
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

function dataChunkRangeMatches(definition, index) {
  if (index < definition.start || index > definition.end) {
    return false;
  }
  return !definition.step || (index - definition.start) % definition.step === 0;
}

function moduleDataDefinition(type, index) {
  const definition = moduleDefinition(type);
  return (
    definition?.dataChunks?.find((chunk) => chunk.index === index) ??
    definition?.dataChunkRanges?.find((chunk) => dataChunkRangeMatches(chunk, index))
  );
}

function dataChunkRangeIndex(definition, index) {
  if (definition.indexOffset === undefined) {
    return undefined;
  }
  const divisor = definition.indexDivisor ?? definition.step ?? 1;
  return Math.floor((index - definition.indexOffset) / divisor);
}

function assignDataChunkRangeIndex(dataChunk, definition, index) {
  const rangeIndex = dataChunkRangeIndex(definition, index);
  if (rangeIndex === undefined) {
    return;
  }
  dataChunk[definition.indexName ?? "controller"] = definition.indexEnum
    ? enumToName(definition.indexEnum, rangeIndex)
    : rangeIndex;
}

function expandControllerTemplate(template, context) {
  if (typeof template !== "string") {
    return template;
  }
  return template
    .replaceAll("{i}", String(context.index))
    .replaceAll("{n}", String(context.number))
    .replaceAll("{name}", context.name ?? "");
}

function repeatValue(value, index) {
  if (!Array.isArray(value)) {
    return value;
  }
  return value[index] ?? value.at(-1);
}

function expandControllerDefinitions(controllers) {
  const expanded = [];
  for (const controller of controllers ?? []) {
    if (!controller.repeat) {
      expanded.push(controller);
      continue;
    }

    const repeat = controller.repeat;
    const items = repeat.items ?? [];
    let chunkIndex = repeat.startIndex ?? 0;
    for (const item of items) {
      const count = item.repeatCount ?? repeat.count ?? 0;
      for (let repeatIndex = 0; repeatIndex < count; repeatIndex += 1) {
        const context = { index: repeatIndex, number: repeatIndex + 1, name: item.name };
        const definition = { ...item, index: chunkIndex };
        delete definition.repeatCount;
        definition.name = expandControllerTemplate(item.idTemplate ?? repeat.idTemplate, context) ?? item.name;
        definition.path =
          expandControllerTemplate(item.pathTemplate ?? repeat.pathTemplate, context) ??
          definition.name;
        for (const key of ["label", "min", "max", "default", "normal", "group"]) {
          definition[key] = repeatValue(definition[key], repeatIndex);
        }
        expanded.push(definition);
        chunkIndex += 1;
      }
    }
  }
  return expanded;
}

function moduleControllers(type) {
  if (!type) {
    return [];
  }
  if (!MODULE_CONTROLLER_CACHE.has(type)) {
    MODULE_CONTROLLER_CACHE.set(type, expandControllerDefinitions(moduleDefinition(type)?.controllers));
  }
  return MODULE_CONTROLLER_CACHE.get(type);
}

function moduleControllerDefinition(type, index) {
  return moduleControllers(type).find((controller) => controller.index === index);
}

function moduleDataChunkGrammar() {
  return SUNVOX_DB.moduleDataChunkGrammar;
}

function moduleDataChunkMetadata(grammar, chunkId) {
  return grammar.metadataChunks?.find((metadata) => metadata.chunk === chunkId);
}

function controllerPath(controller) {
  return controller.path ?? controller.name;
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
  int8: { size: 1, read: "readInt8", write: "writeInt8" },
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
  if (field.type === "fixedString") {
    return field.count ?? 0;
  }
  return binaryType(field).size * (field.count ?? 1);
}

function readFixedString(data, field, offset) {
  const size = binaryFieldSize(field);
  const bytes = data.subarray(offset, offset + size);
  const nul = bytes.indexOf(0);
  return bytes.subarray(0, nul >= 0 ? nul : bytes.length).toString("latin1");
}

function writeFixedString(buffer, field, offset, value) {
  const size = binaryFieldSize(field);
  const bytes = Buffer.from(value ?? "", "latin1");
  if (bytes.length > size) {
    throw new Error(`${field.name} is longer than fixed string size ${size}`);
  }
  bytes.copy(buffer, offset);
}

function readBinaryScalar(data, field, offset) {
  if (field.type === "fixedString") {
    return readFixedString(data, field, offset);
  }
  let value = data[binaryType(field).read](offset);
  if (field.type === "bool8") {
    value = Boolean(value);
    return field.invert ? !value : value;
  }
  if (field.bitfield) {
    return unpackBitfield(field.bitfield, value);
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
  if (field.type === "fixedString") {
    writeFixedString(buffer, field, offset, value);
    return;
  }
  let binaryValue = value;
  if (field.type === "bool8") {
    binaryValue = field.invert ? !Boolean(value) : Boolean(value);
  } else if (field.bitfield) {
    binaryValue = typeof value === "number" ? value : packBitfield(field.bitfield, value);
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
  if (!field.count || field.type === "fixedString") {
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
  const value = (field.flatten && object?.[field.name] === undefined ? object : object?.[field.name]) ?? cloneJson(field.default);
  if (!field.count || field.type === "fixedString") {
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

function recordObject(record, fields) {
  return Array.isArray(record)
    ? Object.fromEntries(fields.map((field, index) => [field.name, record[index]]))
    : record;
}

function readStructRecord(data, fields, baseOffset = 0) {
  const record = {};
  for (const field of fields ?? []) {
    const value = readBinaryField(data, field, baseOffset);
    if (field.flatten && value && typeof value === "object") {
      Object.assign(record, value);
    } else if (value !== undefined) {
      record[field.name] = value;
    }
  }
  return record;
}

function writeStructRecord(buffer, fields, record, baseOffset = 0) {
  const object = recordObject(record, fields ?? []);
  for (const field of fields ?? []) {
    writeBinaryField(buffer, field, object, baseOffset);
  }
}

function structArrayDefinition(type) {
  const match = /^structArray:(.+)$/u.exec(type ?? "");
  return match ? SUNVOX_DB.structs?.[match[1]] : undefined;
}

function decodeStructArrayData(data, definition) {
  const recordSize = definition.recordSize ?? binaryLayoutSize(definition.fields ?? []);
  if (recordSize <= 0 || data.length % recordSize !== 0) {
    return undefined;
  }
  const records = [];
  for (let offset = 0; offset < data.length; offset += recordSize) {
    records.push(readStructRecord(data, definition.fields, offset));
  }
  if (definition.kind !== "patternNotes") {
    return records;
  }
  return {
    eventSize: recordSize,
    events: records,
    eventCount: records.length,
    nonEmptyEventCount: records.filter((record) => Object.values(record).some(Boolean)).length,
  };
}

function encodeStructArrayData(records, definition) {
  if (!Array.isArray(records)) {
    throw new Error(`${definition.kind ?? "structArray"} must be an array`);
  }
  const recordSize = definition.recordSize ?? binaryLayoutSize(definition.fields ?? []);
  const buffer = Buffer.alloc(records.length * recordSize);
  records.forEach((record, index) =>
    writeStructRecord(buffer, definition.fields, tupleRecordToObject(record, definition), index * recordSize),
  );
  return buffer;
}

function decodeStructData(data, definition) {
  const object = readStructRecord(data, definition.fields);
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
  writeStructRecord(buffer, definition.fields, object);
  if (definition.trimTrailingZeroes) {
    let length = buffer.length;
    const minLength = Math.min(buffer.length, dataChunk.dataSize ?? 0);
    while (length > minLength && buffer[length - 1] === 0) {
      length -= 1;
    }
    return buffer.subarray(0, length);
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
    const values = readStructRecord(data, definition.fields, index * recordSize);
    const record = { [definition.indexField ?? "index"]: index };
    let hasNonDefault = false;
    for (const field of definition.fields ?? []) {
      const value = values[field.name];
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
    writeStructRecord(buffer, definition.fields, emptyRecord, index * recordSize);
  }
  for (const record of records) {
    const index = record[definition.indexField ?? "index"];
    if (!Number.isInteger(index) || index < 0 || index >= count) {
      throw new Error(`Invalid ${definition.name} index: ${index}`);
    }
    writeStructRecord(buffer, definition.fields, record, index * recordSize);
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

function decodeBytesData(data) {
  return {
    byteLength: data.length,
    bytesBase64: data.toString("base64"),
  };
}

function encodeBytesData(dataChunk) {
  return dataChunk.bytesBase64 === undefined ? undefined : decodeBase64(dataChunk.bytesBase64, "module data bytes");
}

function decodeSamplerEnvelope(data, definition) {
  const headerSize = definition.headerSize ?? binaryLayoutSize(definition.fields ?? []);
  if (data.length < headerSize) {
    return undefined;
  }
  const envelope = readStructRecord(data, definition.fields);
  const pointCount = envelope.pointCount ?? 0;
  const points = [];
  for (let index = 0, offset = headerSize; index < pointCount; index += 1, offset += 4) {
    if (offset + 4 > data.length) {
      return undefined;
    }
    const packed = data.readUInt32LE(offset);
    points.push({
      x: packed & 0xffff,
      value: packed >>> 16,
    });
  }
  envelope.points = points;
  const result = {};
  setPath(result, definition.path ?? "envelope", envelope);
  return result;
}

function encodeSamplerEnvelope(dataChunk, definition) {
  const envelope = getPath(dataChunk, definition.path ?? "envelope");
  if (!envelope || typeof envelope !== "object") {
    return undefined;
  }
  const headerSize = definition.headerSize ?? binaryLayoutSize(definition.fields ?? []);
  const points = Array.isArray(envelope.points) ? envelope.points : [];
  const pointCount = envelope.pointCount ?? points.length;
  const buffer = Buffer.alloc(headerSize + pointCount * 4);
  writeStructRecord(buffer, definition.fields, { ...envelope, pointCount });
  for (let index = 0; index < pointCount; index += 1) {
    const point = points[index] ?? {};
    const packed = ((point.x ?? 0) & 0xffff) | (((point.value ?? 0) & 0xffff) << 16);
    buffer.writeUInt32LE(packed >>> 0, headerSize + index * 4);
  }
  return buffer;
}

const MODULE_DATA_CODECS = {
  bytes: {
    decode: decodeBytesData,
    encode: encodeBytesData,
  },
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
  samplerEnvelope: {
    decode: decodeSamplerEnvelope,
    encode: encodeSamplerEnvelope,
  },
  struct: {
    decode: decodeStructData,
    encode: encodeStructData,
  },
  int8Array: {
    decode(data, definition) {
      return {
        count: definition.count ?? data.length,
        values: readInt8Array(data),
      };
    },
    encode(dataChunk) {
      return Array.isArray(dataChunk.values) ? writeInt8Array(dataChunk.values) : undefined;
    },
  },
  uint8Array: {
    decode(data, definition) {
      return {
        count: definition.count ?? data.length,
        values: readUInt8Array(data),
      };
    },
    encode(dataChunk) {
      return Array.isArray(dataChunk.values) ? writeUInt8Array(dataChunk.values) : undefined;
    },
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
  assignDataChunkRangeIndex(dataChunk, definition ?? {}, index);

  if (chunk.base64 !== undefined) {
    const data = decodeBase64(chunk.base64, `module data chunk ${index}`);
    const decoded = decodeModuleDataPayload(definition, data);
    if (decoded) {
      Object.assign(dataChunk, decoded);
      if (definition?.trimTrailingZeroes) {
        dataChunk.dataSize = data.length;
      }
    } else {
      dataChunk.base64 = chunk.base64;
    }
    return dataChunk;
  }

  dataChunk.chunk = cloneJson(chunk);
  return dataChunk;
}

function decodeDataChunkInfoValue(definition, kind, value) {
  if (kind === "flags") {
    if (definition?.flagBitfield) {
      return unpackBitfield(definition.flagBitfield, value);
    }
    if (definition?.flagBitflags) {
      return decodeBitflags(definition.flagBitflags, value);
    }
  }
  return value;
}

function encodeDataChunkInfoValue(definition, kind, value) {
  if (kind === "flags") {
    if (definition?.flagBitfield) {
      return packBitfield(definition.flagBitfield, value);
    }
    if (definition?.flagBitflags) {
      return encodeBitflags(definition.flagBitflags, value);
    }
  }
  return value;
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

function metaModuleUserControllerMetadata(module) {
  const dataChunks = module?.dataChunks ?? [];
  const names = new Map();
  for (const chunk of dataChunks) {
    if (chunk.name === "userControllerName" && chunk.controller !== undefined) {
      names.set(chunk.controller, chunk);
    }
  }
  const links = new Map();
  for (const link of dataChunks.find((chunk) => chunk.name === "controllerLinks")?.links ?? []) {
    links.set(link.index, link);
  }
  const count = dataChunks.find((chunk) => chunk.name === "options")?.options?.userControllers ?? names.size;
  return { count, links, names };
}

function annotateMetaModuleControllerLinks(module) {
  if (module?.type !== "MetaModule") {
    return;
  }
  const dataChunks = module?.dataChunks ?? [];
  const embedded = dataChunks.find((chunk) => chunk.name === "embeddedProject")?.container;
  const links = dataChunks.find((chunk) => chunk.name === "controllerLinks")?.links;
  if (!Array.isArray(links) || !Array.isArray(embedded?.modules)) {
    return;
  }
  for (const link of links) {
    const target = embedded.modules[link.module];
    if (target?.name) {
      link._moduleName = target.name;
    }
    if (target?.type) {
      link._moduleType = target.type;
    }
    const controller = moduleControllerDefinition(target?.type, link.controller);
    if (controller?.name) {
      link._controllerName = controller.name;
    }
    if (controller?.label) {
      link._controllerLabel = controller.label;
    }
  }
}

function metaModuleControllerLinkReference(link) {
  return {
    module: link.module,
    controller: link.controller,
    ...(link._moduleName !== undefined ? { _moduleName: link._moduleName } : {}),
    ...(link._moduleType !== undefined ? { _moduleType: link._moduleType } : {}),
    ...(link._controllerName !== undefined ? { _controllerName: link._controllerName } : {}),
    ...(link._controllerLabel !== undefined ? { _controllerLabel: link._controllerLabel } : {}),
  };
}

function decodeMetaModuleUserControllers(controllers, module) {
  const extra = controllers.extra;
  if (!extra) {
    return;
  }
  const { count, links, names } = metaModuleUserControllerMetadata(module);
  const userControllers = [];
  for (let index = 0; index < count; index += 1) {
    const controllerIndex = index + 5;
    const value = extra[controllerIndex];
    if (value === undefined) {
      continue;
    }
    const name = names.get(index);
    const link = links.get(index);
    userControllers.push({
      index,
      value,
      ...(name?.label !== undefined ? { _label: name.label } : {}),
      ...(name?.group !== undefined ? { _group: name.group } : {}),
      ...(link ? { _link: metaModuleControllerLinkReference(link) } : {}),
    });
    delete extra[controllerIndex];
  }
  if (userControllers.length) {
    controllers.user = userControllers;
  }
  if (Object.keys(extra).length === 0) {
    delete controllers.extra;
  }
}

function applyMetaModuleUserControllerValues(controllers, values, controllerChunks) {
  if (!Array.isArray(controllers?.user)) {
    return;
  }
  controllers.user.forEach((controller, arrayIndex) => {
    const index = controller.index ?? arrayIndex;
    const value = controller.value;
    const chunkIndex = index + 5;
    if (!Number.isInteger(index) || value === undefined) {
      return;
    }
    if (controllerChunks) {
      const chunk = controllerChunks[chunkIndex];
      if (chunk) {
        chunk.value = value;
      }
    } else {
      values[chunkIndex] = value;
    }
  });
}

function decodeModuleControllers(type, controllerValues, module) {
  const definitions = moduleControllers(type);
  if (definitions.length === 0 || controllerValues.length === 0) {
    return controllerValues.length ? controllerValues : undefined;
  }
  const controllers = {};
  const knownIndexes = new Set();
  for (const controller of definitions) {
    knownIndexes.add(controller.index);
    if (controllerValues[controller.index] !== undefined) {
      setPath(controllers, controllerPath(controller), decodeControllerValue(controller, controllerValues[controller.index]));
    }
  }
  for (let index = 0; index < controllerValues.length; index += 1) {
    if (!knownIndexes.has(index) && controllerValues[index] !== undefined) {
      controllers.extra ??= {};
      controllers.extra[index] = controllerValues[index];
    }
  }
  if (type === "MetaModule") {
    decodeMetaModuleUserControllers(controllers, module);
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
  const definitions = moduleControllers(type);
  if (definitions.length === 0 || !controllers || typeof controllers !== "object") {
    return;
  }
  for (const controller of definitions) {
    const value = getPath(controllers, controllerPath(controller));
    const chunk = controllerChunks[controller.index];
    if (value !== undefined && chunk) {
      chunk.value = encodeControllerValue(controller, value);
    }
  }
  if (type === "MetaModule") {
    applyMetaModuleUserControllerValues(controllers, undefined, controllerChunks);
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
  const definitions = moduleControllers(type);
  if (definitions.length === 0 || !controllers || typeof controllers !== "object") {
    return undefined;
  }
  const values = [];
  for (const controller of definitions) {
    const value = getPath(controllers, controllerPath(controller));
    if (value !== undefined) {
      values[controller.index] = encodeControllerValue(controller, value);
    }
  }
  if (type === "MetaModule") {
    applyMetaModuleUserControllerValues(controllers, values);
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

function consumeModuleDataChunks(chunks, target, used, type) {
  const grammar = moduleDataChunkGrammar();
  const dataChunks = [];
  for (let index = 0; index < chunks.length; index += 1) {
    const chunk = chunks[index];
    if (used.has(index)) {
      continue;
    }
    if (chunk.id === grammar.countChunk) {
      if (chunk.value !== undefined) {
        setPath(target, grammar.countPath, chunk.value);
      }
      used.add(index);
      continue;
    }
    if (chunk.id !== grammar.indexChunk) {
      continue;
    }

    const dataChunk = { index: chunk.value ?? dataChunks.length };
    used.add(index);

    const data = chunks[index + 1];
    if (data?.id === grammar.payloadChunk && !used.has(index + 1)) {
      Object.assign(dataChunk, decodeModuleDataChunk(type, dataChunk.index, data));
      used.add(index + 1);
      index += 1;
    }

    while (index + 1 < chunks.length) {
      const next = chunks[index + 1];
      const definition = moduleDataDefinition(type, dataChunk.index);
      const metadata = moduleDataChunkMetadata(grammar, next.id);
      if (metadata && !used.has(index + 1)) {
        setPath(
          dataChunk,
          metadata.path,
          decodeDataChunkInfoValue(definition, metadata.kind ?? metadata.path, chunkSemanticValue(next, metadata)),
        );
        used.add(index + 1);
        index += 1;
      } else {
        break;
      }
    }
    dataChunks.push(dataChunk);
  }
  if (dataChunks.length) {
    setPath(target, grammar.path, dataChunks);
  }
}

function makeModuleDataChunks(module) {
  const grammar = moduleDataChunkGrammar();
  const dataChunks = module?.dataChunks;
  const declaredCount = getPath(module, grammar.countPath) ?? dataChunks?.length;
  if (declaredCount === undefined && !Array.isArray(dataChunks)) {
    return [];
  }

  const chunks = [makeSemanticChunk(grammar.countChunk, "value", declaredCount ?? 0)];
  for (const dataChunk of dataChunks ?? []) {
    const definition = moduleDataDefinition(module?.type, dataChunk.index);
    chunks.push(makeSemanticChunk(grammar.indexChunk, "value", dataChunk.index ?? 0));
    if (dataChunk.chunk) {
      chunks.push(cloneJson(dataChunk.chunk));
    } else {
      chunks.push({
        id: grammar.payloadChunk,
        _label: chunkLabel(grammar.payloadChunk),
        base64: encodeModuleDataPayload(dataChunk, definition).toString("base64"),
      });
    }
    for (const metadata of grammar.metadataChunks ?? []) {
      const value = getPath(dataChunk, metadata.path);
      if (value !== undefined) {
        chunks.push(
          makeSemanticChunk(
            metadata.chunk,
            metadata.field,
            encodeDataChunkInfoValue(definition, metadata.kind ?? metadata.path, value),
          ),
        );
      }
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
  const dataChunkModule = {};
  const used = new Set();
  consumeScopeFields("module", chunks, module, used);
  chunks.forEach((chunk, index) => {
    if (chunk.id === "CVAL") {
      used.add(index);
    }
  });
  consumeModuleDataChunks(chunks, dataChunkModule, used, type);
  annotateMetaModuleControllerLinks({ type, dataChunks: dataChunkModule.dataChunks });
  const controllers = decodeModuleControllers(type, controllerValues, dataChunkModule);
  if (controllers !== undefined) {
    module.controllers = controllers;
  }
  const midiIndex = chunks.findIndex((chunk, index) => !used.has(index) && chunk.id === "CMID");
  if (midiIndex >= 0) {
    module.midiBindings = chunks[midiIndex].midiBindings;
    used.add(midiIndex);
  }
  if (dataChunkModule.dataChunkCount !== undefined) {
    module.dataChunkCount = dataChunkModule.dataChunkCount;
  }
  if (dataChunkModule.dataChunks) {
    module.dataChunks = dataChunkModule.dataChunks;
  }
  consumeTerminator("module", chunks, used);
  const extraChunks = remainingChunks(chunks, used);
  if (extraChunks.length) {
    module.extraChunks = extraChunks;
  }
  return module;
}

function isPatternStart(chunks, index) {
  const id = chunks[index]?.id;
  return PATTERN_CHUNKS.has(id);
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
      module: normalizeModuleLinks(makeModule(moduleChunks), []),
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

  normalizeModuleCollectionLinks(modules);

  return {
    format: TEXT_FORMAT,
    _sourceName: sourceName,
    magic: document.magic,
    headerTailHex: document.headerTailHex,
    _comments: [],
    project: makeProject(projectChunks),
    patterns: patterns.map((pattern) => semanticPatternEvents(pattern, modules)),
    modules,
    trailingChunks,
  };
}

function syncLegacyScope(scopeName, object) {
  const chunks = object?.chunks?.map(cloneJson) ?? [];
  for (const field of scopeGrammar(scopeName).fields) {
    const chunk = firstChunk(chunks, field.chunk);
    const value = getPath(object, field.path);
    if (chunk && value !== undefined) {
      assignChunkSemanticValue(chunk, field, value);
    }
  }
  return chunks;
}

function syncLegacyProject(project) {
  return syncLegacyScope("project", project);
}

function syncLegacyPattern(pattern) {
  return syncLegacyScope("pattern", pattern);
}

function syncLegacyModule(module) {
  const chunks = syncLegacyScope("module", module);
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

function syncPattern(pattern, modules = []) {
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
    if (token === "PDTA") {
      const field = scopeGrammar("pattern").fields.find((candidate) => candidate.chunk === "PDTA");
      const records = patternEventRecords(pattern, modules);
      if (field && records !== undefined) {
        chunks.push(makeSemanticChunk("PDTA", field.field, records, field));
      }
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
    if (moduleLinkRelationForChunk(token)) {
      const chunk = emitModuleLinkChunk(module, token);
      if (chunk) {
        chunks.push(chunk);
      }
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
    ...(document.patterns ?? []).flatMap((pattern) => syncPattern(pattern, document.modules ?? [])),
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

async function readDocument(inputPath) {
  const buffer = await readFile(inputPath);
  if (inputPath.toLowerCase().endsWith(".json")) {
    return JSON.parse(buffer.toString("utf8"));
  }
  return parseContainer(buffer);
}

export async function validate(inputPath) {
  const document = await readDocument(inputPath);
  const result = validateContainer(document);
  if (result.issues.length === 0) {
    console.log(`${inputPath}: no validation issues`);
    return;
  }
  for (const issue of result.issues) {
    console.log(formatValidationIssue(issue));
  }
  if (!result.ok) {
    throw new Error(`${inputPath}: validation failed`);
  }
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
    } else if (command === "validate" && inputPath && !outputPath) {
      await validate(inputPath);
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

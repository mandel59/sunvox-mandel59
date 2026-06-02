import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";

export const DEFAULT_SUNVOX_JS_PATH = "sunvox_lib/sunvox_lib/js/lib/sunvox.js";
export const DEFAULT_SLOT = 0;
export const DEFAULT_SAMPLE_RATE = 44100;
export const DEFAULT_CHANNELS = 2;
export const DEFAULT_BLOCK_FRAMES = 128;
export const DEFAULT_SYNTH_POSITION = Object.freeze({ x: 256, y: 256, z: 0 });
export const DEFAULT_OUTPUT_MODULE = 0;

export const SunVoxInitFlags = Object.freeze({
  noDebugOutput: 1 << 0,
  offline: 1 << 1,
  audioInt16: 1 << 2,
  audioFloat32: 1 << 3,
  oneThread: 1 << 4,
});

export const SunVoxNoteCommands = Object.freeze({
  noteOff: 128,
  allNotesOff: 129,
  cleanModules: 130,
  stop: 131,
  play: 132,
  setPitch: 133,
  cleanModule: 140,
});

export const DEFAULT_OFFLINE_INIT_FLAGS =
  SunVoxInitFlags.noDebugOutput | SunVoxInitFlags.offline | SunVoxInitFlags.oneThread;
export const DEFAULT_FLOAT_OFFLINE_INIT_FLAGS = DEFAULT_OFFLINE_INIT_FLAGS | SunVoxInitFlags.audioFloat32;

export async function loadSunVoxLib({
  sunvoxJsPath = DEFAULT_SUNVOX_JS_PATH,
  print = () => {},
  printErr = () => {},
} = {}) {
  const resolvedSunVoxJsPath = resolve(sunvoxJsPath);
  const sunvoxJsDir = dirname(resolvedSunVoxJsPath);
  const module = { exports: {} };
  const context = {
    module,
    exports: module.exports,
    require: createRequire(pathToFileURL(resolvedSunVoxJsPath)),
    __filename: resolvedSunVoxJsPath,
    __dirname: sunvoxJsDir,
    clearTimeout,
    console,
    Date,
    performance,
    process,
    setTimeout,
    TextDecoder,
    TextEncoder,
    URL,
    WebAssembly,
  };
  context.globalThis = context;

  vm.runInNewContext(readFileSync(resolvedSunVoxJsPath, "utf8"), context, { filename: resolvedSunVoxJsPath });

  const SunVoxLib = module.exports.default ?? module.exports;
  return SunVoxLib({
    locateFile: (fileName) => resolve(sunvoxJsDir, fileName),
    print,
    printErr,
  });
}

export function assertSunVoxOk(value, label) {
  if (value < 0) {
    throw new Error(`${label} failed: ${value}`);
  }
  return value;
}

export function readCString(module, pointer) {
  return pointer ? module.UTF8ToString(pointer) : undefined;
}

export function readMagic(buffer) {
  return buffer.subarray(0, 4).toString("latin1");
}

export function mallocBytes(module, bytes, label = "SunVox bytes") {
  const pointer = module._malloc(bytes.length);
  if (!pointer) {
    throw new Error(`${label} malloc failed`);
  }
  module.HEAPU8.set(bytes, pointer);
  return pointer;
}

export function mallocString(module, value) {
  return mallocBytes(module, Buffer.from(`${value}\0`, "utf8"), "SunVox string");
}

export function withMallocBytes(module, bytes, fn, label) {
  const pointer = mallocBytes(module, bytes, label);
  try {
    return fn(pointer);
  } finally {
    module._free(pointer);
  }
}

export function withSlotLock(module, slot, fn) {
  assertSunVoxOk(module._sv_lock_slot(slot), "sv_lock_slot");
  try {
    return fn();
  } finally {
    assertSunVoxOk(module._sv_unlock_slot(slot), "sv_unlock_slot");
  }
}

export async function withSunVoxSlot(
  {
    sampleRate = DEFAULT_SAMPLE_RATE,
    channels = DEFAULT_CHANNELS,
    flags = DEFAULT_OFFLINE_INIT_FLAGS,
    slot = DEFAULT_SLOT,
    config = 0,
    sunvoxJsPath = DEFAULT_SUNVOX_JS_PATH,
  } = {},
  fn,
) {
  const module = await loadSunVoxLib({ sunvoxJsPath });
  const engineVersion = assertSunVoxOk(module._sv_init(config, sampleRate, channels, flags), "sv_init");
  try {
    assertSunVoxOk(module._sv_open_slot(slot), "sv_open_slot");
    try {
      return await fn({ module, slot, engineVersion, sampleRate, channels, flags });
    } finally {
      module._sv_close_slot(slot);
    }
  } finally {
    module._sv_deinit();
  }
}

export function loadProjectFromBuffer(module, buffer, { slot = DEFAULT_SLOT } = {}) {
  return withMallocBytes(module, buffer, (pointer) =>
    assertSunVoxOk(module._sv_load_from_memory(slot, pointer, buffer.length), "sv_load_from_memory"),
  );
}

export function loadSynthModuleFromBuffer(
  module,
  buffer,
  {
    slot = DEFAULT_SLOT,
    x = DEFAULT_SYNTH_POSITION.x,
    y = DEFAULT_SYNTH_POSITION.y,
    z = DEFAULT_SYNTH_POSITION.z,
    connectToOutput = true,
    outputModule = DEFAULT_OUTPUT_MODULE,
  } = {},
) {
  return withSlotLock(module, slot, () =>
    withMallocBytes(module, buffer, (pointer) => {
      const moduleIndex = assertSunVoxOk(
        module._sv_load_module_from_memory(slot, pointer, buffer.length, x, y, z),
        "sv_load_module_from_memory",
      );
      if (connectToOutput) {
        assertSunVoxOk(module._sv_connect_module(slot, moduleIndex, outputModule), "sv_connect_module");
      }
      return moduleIndex;
    }),
  );
}

export function loadBufferIntoSlot(module, buffer, options = {}) {
  const magic = readMagic(buffer);
  if (magic === "SVOX") {
    return {
      magic,
      loadApi: "sv_load_from_memory",
      loadResult: loadProjectFromBuffer(module, buffer, options),
    };
  }
  if (magic === "SSYN") {
    const moduleIndex = loadSynthModuleFromBuffer(module, buffer, {
      ...options,
      connectToOutput: options.connectToOutput ?? false,
    });
    return {
      magic,
      loadApi: "sv_load_module_from_memory",
      loadResult: moduleIndex,
      moduleIndex,
    };
  }
  throw new Error(`Unsupported SunVox container magic: ${magic || "<empty>"}`);
}

export function createPattern(
  module,
  {
    slot = DEFAULT_SLOT,
    clone = -1,
    x = 0,
    y = 0,
    tracks = 1,
    lines,
    iconSeed = 0,
    name = "",
  } = {},
) {
  const namePointer = mallocString(module, name);
  try {
    return assertSunVoxOk(
      module._sv_new_pattern(slot, clone, x, y, tracks, lines, iconSeed, namePointer),
      "sv_new_pattern",
    );
  } finally {
    module._free(namePointer);
  }
}

export function setPatternEvent(
  module,
  {
    slot = DEFAULT_SLOT,
    patternIndex,
    track = 0,
    line,
    note = 0,
    velocity = 0,
    moduleNumber = 0,
    controller = 0,
    value = 0,
  },
) {
  return assertSunVoxOk(
    module._sv_set_pattern_event(slot, patternIndex, track, line, note, velocity, moduleNumber, controller, value),
    "sv_set_pattern_event",
  );
}

export function sunVoxNoteValue(midiNote) {
  return Math.max(1, Math.min(127, Math.round(midiNote) + 1));
}

export function readTimeMapFrames(module, { slot = DEFAULT_SLOT, startLine = 0, lineCount } = {}) {
  const pointer = module._malloc(lineCount * 4);
  if (!pointer) {
    throw new Error("SunVox time map malloc failed");
  }
  try {
    assertSunVoxOk(module._sv_get_time_map(slot, startLine, lineCount, pointer, 1), "sv_get_time_map");
    return Array.from(module.HEAPU32.subarray(pointer >> 2, (pointer >> 2) + lineCount));
  } finally {
    module._free(pointer);
  }
}

export function lineFramesFromTimeMap(frameMap, fallbackFrames = Math.round(DEFAULT_SAMPLE_RATE * 0.12)) {
  for (let index = 1; index < frameMap.length; index += 1) {
    const diff = frameMap[index] - frameMap[index - 1];
    if (diff > 0) {
      return diff;
    }
  }
  return fallbackFrames;
}

export function createNoteProbePattern(
  module,
  {
    slot = DEFAULT_SLOT,
    moduleIndex,
    note,
    velocity,
    gateSeconds,
    sampleRate = DEFAULT_SAMPLE_RATE,
    lineCount = 256,
    name = "sunvox-node-probe",
  },
) {
  const patternIndex = createPattern(module, { slot, tracks: 1, lines: lineCount, name });
  const frameMap = readTimeMapFrames(module, { slot, startLine: 0, lineCount });
  const lineFrames = lineFramesFromTimeMap(frameMap, Math.round(sampleRate * 0.12));
  const noteOffLine = Math.max(1, Math.min(lineCount - 1, Math.round((gateSeconds * sampleRate) / lineFrames)));
  setPatternEvent(module, {
    slot,
    patternIndex,
    line: 0,
    note: sunVoxNoteValue(note),
    velocity,
    moduleNumber: moduleIndex + 1,
  });
  setPatternEvent(module, {
    slot,
    patternIndex,
    line: noteOffLine,
    note: SunVoxNoteCommands.noteOff,
    moduleNumber: moduleIndex + 1,
  });
  return {
    patternIndex,
    noteOnFrame: frameMap[0] ?? 0,
    noteOffFrame: frameMap[noteOffLine] ?? noteOffLine * lineFrames,
    noteOffLine,
    lineFrames,
  };
}

export function renderSlotAudio(
  module,
  {
    slot = DEFAULT_SLOT,
    sampleRate = DEFAULT_SAMPLE_RATE,
    channels = DEFAULT_CHANNELS,
    durationSeconds,
    blockFrames = DEFAULT_BLOCK_FRAMES,
    outTime,
  },
) {
  const totalFrames = Math.round(durationSeconds * sampleRate);
  const outputPointer = module._malloc(blockFrames * channels * 4);
  if (!outputPointer) {
    throw new Error("SunVox audio output malloc failed");
  }
  const samples = new Float32Array(totalFrames * channels);
  let writeFrame = 0;
  const baseTicks = module._sv_get_ticks();
  const ticksPerSecond = module._sv_get_ticks_per_second();
  const frameToTicks = outTime ?? ((frame) => baseTicks + Math.floor((frame * ticksPerSecond) / sampleRate));
  try {
    while (writeFrame < totalFrames) {
      const frames = Math.min(blockFrames, totalFrames - writeFrame);
      assertSunVoxOk(module._sv_audio_callback(outputPointer, frames, 0, frameToTicks(writeFrame)), "sv_audio_callback");
      samples.set(
        module.HEAPF32.subarray(outputPointer >> 2, (outputPointer >> 2) + frames * channels),
        writeFrame * channels,
      );
      writeFrame += frames;
    }
  } finally {
    module._free(outputPointer);
  }
  return {
    samples,
    sampleRate,
    channels,
  };
}

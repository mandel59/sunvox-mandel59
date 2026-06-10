import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { pathToFileURL } from "node:url";

import {
  buildContainer,
  parseContainer,
  parseVerboseContainer,
  SUNVOX_DB,
  TEXT_FORMAT,
} from "../../tools/sunvox-codec.mjs";
import {
  DEFAULT_CHANNELS,
  DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
  DEFAULT_SAMPLE_RATE,
  DEFAULT_SLOT,
  assertSunVoxOk,
  createPattern,
  loadProjectFromBuffer,
  readCString,
  setPatternEvent,
  sunVoxNoteValue,
  withSlotLock,
  withSunVoxSlot,
} from "../../tools/sunvox-node.mjs";

const OUTPUT_DIRECTORY = "var/issue-33-pattern-runtime";
const PATTERN_CHUNK_IDS = new Set(SUNVOX_DB.chunks.filter((chunk) => chunk.scope === "pattern").map((chunk) => chunk.id));
const ZERO_ICON_BASE64 = Buffer.alloc(32).toString("base64");

const codecDocument = {
  format: TEXT_FORMAT,
  magic: "SVOX",
  headerTailHex: "00000000",
  project: {
    name: "Issue 33 codec pattern probe",
    bpm: 125,
    speed: 6,
  },
  patterns: [
    {
      name: "Probe",
      position: { x: 0, y: 0 },
      tracks: 1,
      lines: 4,
      events: [{ line: 0, track: 0, note: "C4", velocity: 112 }],
    },
  ],
  modules: [
    {
      flags: {
        exists: true,
        output: true,
      },
      name: "Output",
      position: { x: 0, y: 0 },
    },
  ],
  trailingChunks: [],
};

function saveSlotToMemory(module, slot) {
  const sizePointer = module._malloc(16);
  if (!sizePointer) {
    throw new Error("malloc failed for SunVox save size pointer");
  }
  let savedPointer;
  try {
    savedPointer = module._sv_save_to_memory(slot, sizePointer);
    const size = module.HEAP32[sizePointer >> 2];
    if (!savedPointer || size <= 0) {
      throw new Error(`sv_save_to_memory failed with pointer ${savedPointer} and size ${size}`);
    }
    return Buffer.from(module.HEAPU8.subarray(savedPointer, savedPointer + size));
  } finally {
    if (savedPointer) {
      module._free(savedPointer);
    }
    module._free(sizePointer);
  }
}

function removeInitialPatterns(module, slot) {
  for (let index = module._sv_get_number_of_patterns(slot) - 1; index >= 0; index -= 1) {
    withSlotLock(module, slot, () => assertSunVoxOk(module._sv_remove_pattern(slot, index), "sv_remove_pattern"));
  }
}

async function buildRuntimeBuffer() {
  return withSunVoxSlot(
    {
      sampleRate: DEFAULT_SAMPLE_RATE,
      channels: DEFAULT_CHANNELS,
      flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
      slot: DEFAULT_SLOT,
    },
    async ({ module, slot }) => {
      removeInitialPatterns(module, slot);
      const patternIndex = createPattern(module, {
        slot,
        clone: -1,
        x: 0,
        y: 0,
        tracks: 1,
        lines: 4,
        iconSeed: 0,
        name: "Probe",
      });
      setPatternEvent(module, {
        slot,
        patternIndex,
        line: 0,
        track: 0,
        note: sunVoxNoteValue(48),
        velocity: 112,
        moduleNumber: 0,
        controller: 0,
        value: 0,
      });
      return saveSlotToMemory(module, slot);
    },
  );
}

function patternChunkGroups(chunks) {
  const groups = [];
  for (let index = 0; index < chunks.length; ) {
    if (!PATTERN_CHUNK_IDS.has(chunks[index].id)) {
      index += 1;
      continue;
    }
    const group = [];
    while (index < chunks.length) {
      const chunk = chunks[index++];
      group.push(chunk);
      if (chunk.id === "PEND") {
        break;
      }
    }
    groups.push(group);
  }
  return groups;
}

function movePatternDataBeforeEnd(buffer) {
  const document = parseVerboseContainer(buffer);
  const chunks = [];
  for (let index = 0; index < document.chunks.length; ) {
    const chunk = document.chunks[index];
    if (!PATTERN_CHUNK_IDS.has(chunk.id)) {
      chunks.push(chunk);
      index += 1;
      continue;
    }
    const group = [];
    while (index < document.chunks.length) {
      const current = document.chunks[index++];
      group.push(current);
      if (current.id === "PEND") {
        break;
      }
    }
    const dataChunks = group.filter((candidate) => candidate.id === "PDTA");
    const endChunks = group.filter((candidate) => candidate.id === "PEND");
    const metadataChunks = group.filter((candidate) => candidate.id !== "PDTA" && candidate.id !== "PEND");
    chunks.push(...metadataChunks, ...dataChunks, ...endChunks);
  }
  return buildContainer({ ...document, chunks, sha256: undefined });
}

function removePatternIcons(buffer) {
  const document = parseVerboseContainer(buffer);
  const chunks = document.chunks.filter((chunk) => chunk.id !== "PICO");
  return buildContainer({ ...document, chunks, size: undefined, sha256: undefined });
}

function decodedPreview(chunk) {
  const decoded = chunk._decoded;
  if (!decoded) {
    return undefined;
  }
  if (chunk.id === "PDTA") {
    return {
      kind: decoded.kind,
      eventCount: decoded.value?.events?.length,
      firstEvent: decoded.value?.events?.[0],
    };
  }
  if (["string", "stringPreview", "int32", "uint32"].includes(decoded.kind)) {
    return { kind: decoded.kind, value: decoded.value };
  }
  return { kind: decoded.kind };
}

function chunkSummary(buffer) {
  const document = parseVerboseContainer(buffer);
  return {
    size: document.size,
    sha256: document.sha256,
    patternChunks: patternChunkGroups(document.chunks).map((group) =>
      group.map((chunk) => ({
        index: document.chunks.indexOf(chunk),
        id: chunk.id,
        offset: chunk.offset,
        size: chunk.size,
        decoded: decodedPreview(chunk),
      })),
    ),
  };
}

function parsedSummary(buffer) {
  const document = parseContainer(buffer);
  return {
    project: {
      name: document.project?.name,
      bpm: document.project?.bpm,
      speed: document.project?.speed,
    },
    patterns: (document.patterns ?? []).map((pattern, index) => ({
      index,
      name: pattern.name,
      tracks: pattern.tracks,
      lines: pattern.lines,
      ySize: pattern.ySize,
      flags: pattern.flags,
      hasIcon: typeof pattern.iconBase64 === "string",
      foreground: pattern.foreground,
      background: pattern.background,
      infoFlags: pattern.infoFlags,
      eventCount: pattern.events?.length ?? 0,
      firstEvent: pattern.events?.[0],
    })),
    modules: (document.modules ?? []).map((module, index) => ({
      index,
      name: module.name,
      type: module.type,
      flags: module.flags,
    })),
  };
}

function readRuntimePatternEvent(module, slot, patternIndex, line, track) {
  const tracks = module._sv_get_pattern_tracks(slot, patternIndex);
  const lines = module._sv_get_pattern_lines(slot, patternIndex);
  if (track >= tracks || line >= lines) {
    return undefined;
  }
  const dataPointer = module._sv_get_pattern_data(slot, patternIndex);
  if (!dataPointer) {
    return undefined;
  }
  const offset = dataPointer + (line * tracks + track) * 8;
  return {
    line,
    track,
    note: module.HEAPU8[offset],
    velocity: module.HEAPU8[offset + 1],
    module: module.HEAPU8[offset + 2] | (module.HEAPU8[offset + 3] << 8),
    controller: module.HEAPU8[offset + 4] | (module.HEAPU8[offset + 5] << 8),
    value: module.HEAPU8[offset + 6] | (module.HEAPU8[offset + 7] << 8),
  };
}

async function runtimeSummary(buffer) {
  return withSunVoxSlot(
    {
      sampleRate: DEFAULT_SAMPLE_RATE,
      channels: DEFAULT_CHANNELS,
      flags: DEFAULT_FLOAT_OFFLINE_INIT_FLAGS,
      slot: DEFAULT_SLOT,
    },
    async ({ module, slot, engineVersion }) => {
      const loadResult = loadProjectFromBuffer(module, buffer, { slot });
      const patternCount = module._sv_get_number_of_patterns(slot);
      const patterns = [];
      for (let index = 0; index < patternCount; index += 1) {
        patterns.push({
          index,
          name: readCString(module, module._sv_get_pattern_name(slot, index)),
          tracks: module._sv_get_pattern_tracks(slot, index),
          lines: module._sv_get_pattern_lines(slot, index),
          firstEvent: readRuntimePatternEvent(module, slot, index, 0, 0),
        });
      }
      return {
        engineVersion,
        loadResult,
        patternCount,
        patterns,
      };
    },
  );
}

async function writeBuffer(path, buffer) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, buffer);
}

async function main() {
  const codecBuffer = buildContainer(codecDocument);
  const codecNoIconBuffer = removePatternIcons(codecBuffer);
  const codecReorderedBuffer = movePatternDataBeforeEnd(codecBuffer);
  const runtimeBuffer = await buildRuntimeBuffer();
  const runtimeParsed = parseContainer(runtimeBuffer);
  const runtimePattern = runtimeParsed.patterns[0];
  const buildCodecWithPatternPatch = (patch) =>
    buildContainer({
      ...codecDocument,
      patterns: [{ ...codecDocument.patterns[0], ...patch }],
    });
  const codecWithRuntimePatternDefaults = buildContainer({
    ...codecDocument,
    patterns: [
      {
        ...codecDocument.patterns[0],
        ySize: runtimePattern.ySize,
        flags: runtimePattern.flags,
        iconBase64: runtimePattern.iconBase64,
        foreground: runtimePattern.foreground,
        background: runtimePattern.background,
        infoFlags: runtimePattern.infoFlags,
      },
    ],
  });
  const codecWithRuntimeDefaults = buildContainer({
    ...runtimeParsed,
    project: {
      ...runtimeParsed.project,
      name: "Issue 33 codec runtime-default probe",
    },
    patterns: [
      {
        ...runtimePattern,
        name: "Probe",
        tracks: 1,
        lines: 4,
        events: codecDocument.patterns[0].events,
      },
    ],
  });
  const runtimeParsedRebuilt = buildContainer(runtimeParsed);
  const variants = [
    ["codec-built-no-pico-control", codecNoIconBuffer],
    ["codec-built-minimal", codecBuffer],
    ["codec-built-pdta-before-pend", codecReorderedBuffer],
    ["codec-built-y-size-only", buildCodecWithPatternPatch({ ySize: runtimePattern.ySize })],
    ["codec-built-icon-only", buildCodecWithPatternPatch({ iconBase64: runtimePattern.iconBase64 })],
    [
      "codec-built-flags-colors-info-only",
      buildCodecWithPatternPatch({
        flags: runtimePattern.flags,
        foreground: runtimePattern.foreground,
        background: runtimePattern.background,
        infoFlags: runtimePattern.infoFlags,
      }),
    ],
    [
      "codec-built-no-icon-pattern-defaults",
      buildCodecWithPatternPatch({
        ySize: runtimePattern.ySize,
        flags: runtimePattern.flags,
        foreground: runtimePattern.foreground,
        background: runtimePattern.background,
        infoFlags: runtimePattern.infoFlags,
      }),
    ],
    [
      "codec-built-zero-icon-pattern-defaults",
      buildCodecWithPatternPatch({
        ySize: runtimePattern.ySize,
        flags: runtimePattern.flags,
        iconBase64: ZERO_ICON_BASE64,
        foreground: runtimePattern.foreground,
        background: runtimePattern.background,
        infoFlags: runtimePattern.infoFlags,
      }),
    ],
    ["codec-built-runtime-pattern-defaults", codecWithRuntimePatternDefaults],
    ["codec-built-runtime-defaults", codecWithRuntimeDefaults],
    ["runtime-parsed-rebuilt", runtimeParsedRebuilt],
    ["runtime-built-minimal", runtimeBuffer],
  ];

  await mkdir(OUTPUT_DIRECTORY, { recursive: true });
  for (const [name, buffer] of variants) {
    await writeBuffer(`${OUTPUT_DIRECTORY}/${name}.sunvox`, buffer);
  }

  const summary = {
    generatedAt: new Date().toISOString(),
    variants: Object.fromEntries(
      await Promise.all(
        variants.map(async ([name, buffer]) => [
          name,
          {
            file: `${OUTPUT_DIRECTORY}/${name}.sunvox`,
            chunks: chunkSummary(buffer),
            parsed: parsedSummary(buffer),
            runtime: await runtimeSummary(buffer),
          },
        ]),
      ),
    ),
  };

  await writeFile(`${OUTPUT_DIRECTORY}/pattern-runtime-summary.json`, `${JSON.stringify(summary, null, 2)}\n`);
  console.log(
    JSON.stringify(
      {
        generatedAt: summary.generatedAt,
        variants: Object.fromEntries(
          Object.entries(summary.variants).map(([name, variant]) => [
            name,
            {
              file: variant.file,
              patternChunkIds: variant.chunks.patternChunks[0]?.map((chunk) => chunk.id),
              parsedPattern0: variant.parsed.patterns[0],
              runtimePattern0: variant.runtime.patterns[0],
            },
          ]),
        ),
      },
      null,
      2,
    ),
  );
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}

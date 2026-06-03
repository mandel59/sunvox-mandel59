#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_HEADER_PATH = "var/sunvox_lib/sunvox_lib/headers/sunvox.h";
const DEFAULT_IMPLEMENTATION_PATH = "var/sunvox_lib/sunvox_lib/main/sunvox_lib.cpp";
const DEFAULT_WRAPPER_PATH = "sunvox_lib/sunvox_lib/js/lib/sunvox_lib_loader.js";
const DEFAULT_SCAN_ROOTS = ["js", "tools", "test"];
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]);
const SKIP_DIRECTORIES = new Set([".git", ".jj", "node_modules", "dist", "var", "sunvox_lib"]);
const SKIP_FILES = new Set(["sunvox-api-audit.mjs", "sunvox-api-audit.test.mjs"]);

const REVIEW_NOTES = {
  sv_init: {
    priority: "high",
    notes: [
      "Initializes the global sound system; returns negative if SunVox is already initialized or initialization fails.",
      "Offline render tools should combine SV_INIT_FLAG_USER_AUDIO_CALLBACK or SV_INIT_FLAG_OFFLINE with an explicit audio sample format.",
    ],
    argumentSemantics: {
      config: {
        meaning: "additional configuration string",
        format: "option=value|option=value",
        specialValues: { NULL: "automatic configuration" },
      },
      freq: { meaning: "desired sample rate", unit: "Hz", minimum: 44100 },
      channels: {
        meaning: "number of output channels",
        values: { 2: "stereo; only supported value documented" },
      },
      flags: {
        meaning: "SV_INIT_FLAG_* bitmask",
        values: {
          SV_INIT_FLAG_NO_DEBUG_OUTPUT: "disable debug output",
          SV_INIT_FLAG_USER_AUDIO_CALLBACK: "offline/user audio callback mode",
          SV_INIT_FLAG_OFFLINE: "alias for SV_INIT_FLAG_USER_AUDIO_CALLBACK",
          SV_INIT_FLAG_AUDIO_INT16: "desired int16 output stream",
          SV_INIT_FLAG_AUDIO_FLOAT32: "desired float32 output stream",
          SV_INIT_FLAG_ONE_THREAD: "single-threaded offline processing mode",
        },
      },
    },
  },
  sv_deinit: {
    priority: "high",
    notes: ["Deinitializes the global sound system; returns negative if SunVox was not initialized."],
    argumentSemantics: {},
  },
  sv_open_slot: {
    priority: "high",
    notes: ["Opens a SunVox engine slot; invalid slot numbers return negative."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index", range: "0..SUNDOG_SOUND_SLOTS-1" },
    },
  },
  sv_close_slot: {
    priority: "medium",
    notes: ["Closes an opened SunVox slot and releases the engine state."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index", range: "0..SUNDOG_SOUND_SLOTS-1" },
    },
  },
  sv_lock_slot: {
    priority: "high",
    notes: ["Required around functions marked USE LOCK/UNLOCK and concurrent slot access."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index", range: "0..SUNDOG_SOUND_SLOTS-1" },
    },
  },
  sv_unlock_slot: {
    priority: "high",
    notes: ["Releases a slot lock acquired by sv_lock_slot()."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index", range: "0..SUNDOG_SOUND_SLOTS-1" },
    },
  },
  sv_load_from_memory: {
    priority: "high",
    notes: ["Loads a full .sunvox project from a memory block into an opened slot."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      data: { meaning: "SunVox project data block" },
      data_size: { meaning: "data block size", unit: "bytes" },
    },
  },
  sv_save_to_memory: {
    priority: "medium",
    notes: ["The C API returns a malloc-allocated memory block; the JS wrapper returns a UInt8Array."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      size: { meaning: "output pointer receiving byte length", unit: "bytes" },
    },
  },
  sv_play: {
    priority: "medium",
    notes: ["Starts playback from the current project position."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
    },
  },
  sv_play_from_beginning: {
    priority: "medium",
    notes: ["Starts playback from line 0."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
    },
  },
  sv_stop: {
    priority: "high",
    notes: ["The first call stops playback; the second call resets all SunVox activity and switches the engine to standby."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
    },
  },
  sv_rewind: {
    priority: "medium",
    notes: ["Rewinds the project to the given line number."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      line_num: { meaning: "target line number", unit: "lines" },
    },
  },
  sv_volume: {
    priority: "high",
    notes: ["Sets the global slot volume; negative values are ignored; returns the previous volume."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      vol: {
        meaning: "global slot volume",
        range: "0..256",
        unit: "SunVox volume units",
        specialValues: { "<0": "ignored; previous volume is returned without changing volume" },
      },
    },
  },
  sv_audio_callback: {
    priority: "high",
    notes: ["out_time is SunVox system ticks, not seconds."],
    argumentSemantics: {
      buf: {
        meaning: "destination audio buffer",
        notes: ["Element type follows SV_INIT_FLAG_AUDIO_INT16 or SV_INIT_FLAG_AUDIO_FLOAT32."],
      },
      frames: { meaning: "number of output frames", unit: "frames" },
      latency: { meaning: "audio output latency", unit: "frames" },
      out_time: { meaning: "buffer output time", unit: "SunVox system ticks" },
    },
  },
  sv_audio_callback2: {
    priority: "medium",
    notes: ["out_time uses the same system tick space as sv_audio_callback()."],
    argumentSemantics: {
      out_time: { meaning: "buffer output time", unit: "SunVox system ticks" },
      in_type: { meaning: "input buffer sample type", values: { 0: "int16", 1: "float32" } },
      in_channels: { meaning: "number of input channels" },
      in_buf: { meaning: "interleaved input audio buffer" },
    },
  },
  sv_new_pattern: {
    priority: "high",
    notes: ["clone < 0 creates a fresh pattern; clone >= 0 creates a clone."],
    argumentSemantics: {
      clone: {
        meaning: "source pattern index for clone creation",
        specialValues: { "<0": "create a fresh pattern", ">=0": "clone the specified pattern" },
      },
      x: { meaning: "timeline X position" },
      y: { meaning: "timeline Y position" },
      tracks: { meaning: "number of pattern tracks" },
      lines: { meaning: "number of pattern lines" },
      icon_seed: { meaning: "pattern icon seed" },
      name: { meaning: "pattern name" },
    },
  },
  sv_get_number_of_patterns: {
    priority: "high",
    notes: ["Returns the number of pattern slots, not the number of non-empty patterns."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      returnValue: {
        meaning: "pattern slot count",
        specialValues: { 0: "invalid slot or no pattern slots" },
        notes: ["A pattern slot is non-empty when sv_get_pattern_lines(slot, index) > 0."],
      },
    },
  },
  sv_get_pattern_tracks: {
    priority: "medium",
    notes: ["Returns 0 for invalid slots, out-of-range pattern slots, and empty pattern slots."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      pat_num: { meaning: "pattern slot index" },
      returnValue: { meaning: "pattern track count" },
    },
  },
  sv_get_pattern_lines: {
    priority: "medium",
    notes: ["Returns 0 for invalid slots, out-of-range pattern slots, and empty pattern slots."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      pat_num: { meaning: "pattern slot index" },
      returnValue: { meaning: "pattern line count", unit: "lines" },
    },
  },
  sv_get_pattern_name: {
    priority: "medium",
    notes: ["Returns NULL for invalid slots, out-of-range pattern slots, and empty pattern slots."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      pat_num: { meaning: "pattern slot index" },
      returnValue: { meaning: "pattern name C string", specialValues: { NULL: "invalid slot or empty pattern slot" } },
    },
  },
  sv_get_pattern_data: {
    priority: "high",
    notes: ["Returns the raw sunvox_note buffer for reading and writing pattern events."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      pat_num: { meaning: "pattern slot index" },
      returnValue: {
        meaning: "sunvox_note buffer pointer",
        format: "line-major: data[line * tracks + track]",
        specialValues: { NULL: "invalid slot or empty pattern slot" },
      },
    },
  },
  sv_send_event: {
    priority: "high",
    notes: ["vel is the public API velocity: 1..129, 0 means default."],
    argumentSemantics: {
      track_num: { meaning: "track number within the pattern" },
      note: {
        meaning: "note or note command",
        range: "0..255",
        specialValues: { 0: "empty", "1..127": "note number", 128: "note off", "129+": "NOTECMD_*" },
      },
      vel: { meaning: "velocity", range: "1..129", specialValues: { 0: "default" } },
      module: { meaning: "target module", specialValues: { 0: "empty", "1..65535": "module number + 1" } },
      ctl: { meaning: "packed controller/effect selector", format: "0xCCEE" },
      ctl_val: { meaning: "controller or effect value" },
    },
  },
  sv_set_event_t: {
    priority: "high",
    notes: ["timestamp is SunVox system ticks."],
    argumentSemantics: {
      set: { meaning: "manual event timestamp mode", values: { 0: "reset to automatic time", 1: "set manual time" } },
      t: { meaning: "event timestamp", unit: "SunVox system ticks" },
    },
  },
  sv_set_module_ctl_value: {
    priority: "high",
    notes: ["scaled controls whether val is a scaled controller value."],
    argumentSemantics: {
      mod_num: { meaning: "module index" },
      ctl_num: { meaning: "zero-based controller index" },
      val: { meaning: "controller value" },
      scaled: { meaning: "value scale mode", values: { 0: "raw controller value", 1: "scaled/display value" } },
    },
  },
  sv_get_module_ctl_value: {
    priority: "medium",
    notes: ["scaled controls whether the returned value is scaled."],
    argumentSemantics: {
      mod_num: { meaning: "module index" },
      ctl_num: { meaning: "zero-based controller index" },
      scaled: {
        meaning: "value scale mode",
        values: { 0: "raw controller value", 1: "scaled pattern value", 2: "final displayed value" },
      },
    },
  },
  sv_connect_module: {
    priority: "high",
    notes: ["Requires sv_lock_slot()/sv_unlock_slot(); returns negative if the slot is invalid or not locked."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      source: { meaning: "source module index" },
      destination: { meaning: "destination module index" },
    },
  },
  sv_get_number_of_modules: {
    priority: "medium",
    notes: ["Returns the number of module slots, not the number of existing modules."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      returnValue: { meaning: "module slot count", specialValues: { 0: "invalid slot or no module slots" } },
    },
  },
  sv_get_module_flags: {
    priority: "high",
    notes: [
      "Return value is an SV_MODULE_FLAG_* bitmask and also packs input/output link slot counts.",
      "Use SV_MODULE_FLAG_EXISTS to distinguish an occupied module slot from an empty slot.",
    ],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      mod_num: { meaning: "module index" },
      returnValue: {
        meaning: "module flags bitmask",
        specialValues: { 0: "invalid slot or missing module" },
        values: {
          SV_MODULE_FLAG_EXISTS: "module slot is occupied",
          SV_MODULE_FLAG_GENERATOR: "note input and sound output module",
          SV_MODULE_FLAG_EFFECT: "sound input and sound output module",
          SV_MODULE_FLAG_MUTE: "module is muted",
          SV_MODULE_FLAG_SOLO: "module is soloed",
          SV_MODULE_FLAG_BYPASS: "module is bypassed",
          SV_MODULE_INPUTS_MASK: "packed input link slot count",
          SV_MODULE_OUTPUTS_MASK: "packed output link slot count",
        },
      },
    },
  },
  sv_get_module_inputs: {
    priority: "high",
    notes: ["Returns a pointer to an int array of input link slots; empty link slots contain -1."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      mod_num: { meaning: "module index" },
      returnValue: {
        meaning: "input link array pointer",
        size: "(sv_get_module_flags() & SV_MODULE_INPUTS_MASK) >> SV_MODULE_INPUTS_OFF",
        specialValues: { NULL: "invalid slot or missing module", "-1": "empty link slot" },
      },
    },
  },
  sv_get_module_outputs: {
    priority: "high",
    notes: ["Returns a pointer to an int array of output link slots; empty link slots contain -1."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      mod_num: { meaning: "module index" },
      returnValue: {
        meaning: "output link array pointer",
        size: "(sv_get_module_flags() & SV_MODULE_OUTPUTS_MASK) >> SV_MODULE_OUTPUTS_OFF",
        specialValues: { NULL: "invalid slot or missing module", "-1": "empty link slot" },
      },
    },
  },
  sv_get_module_type: {
    priority: "medium",
    notes: ["Returns the module type name; module 0 is reported as Output."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      mod_num: { meaning: "module index" },
      returnValue: { meaning: "module type C string", specialValues: { NULL: "invalid slot", "\"\"": "missing module" } },
    },
  },
  sv_get_module_name: {
    priority: "medium",
    notes: ["Returns the module display name stored in the module slot."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      mod_num: { meaning: "module index" },
      returnValue: { meaning: "module name C string", specialValues: { NULL: "invalid slot", "\"\"": "missing module" } },
    },
  },
  sv_get_number_of_module_ctls: {
    priority: "medium",
    notes: ["Returns the number of controller slots exposed by the module."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      mod_num: { meaning: "module index" },
      returnValue: { meaning: "module controller count", specialValues: { 0: "invalid slot or module without controllers" } },
    },
  },
  sv_get_module_ctl_name: {
    priority: "medium",
    notes: ["Controller numbers are zero-based."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      mod_num: { meaning: "module index" },
      ctl_num: { meaning: "zero-based controller index" },
      returnValue: { meaning: "controller name C string", specialValues: { NULL: "invalid slot or missing controller" } },
    },
  },
  sv_set_pattern_event: {
    priority: "high",
    notes: ["Pattern event fields should not be inferred from sv_send_event() alone."],
    argumentSemantics: {
      pat_num: { meaning: "pattern index" },
      track: { meaning: "pattern track index" },
      line: { meaning: "pattern line index" },
      nn: { meaning: "pattern note field" },
      vv: { meaning: "pattern velocity field" },
      mm: { meaning: "pattern module field" },
      ccee: { meaning: "pattern controller/effect field" },
      xxyy: { meaning: "pattern controller/effect value field" },
    },
  },
  sv_get_pattern_event: {
    priority: "medium",
    notes: ["Pattern event fields should be audited against pattern storage semantics."],
    argumentSemantics: {
      pat_num: { meaning: "pattern index" },
      track: { meaning: "pattern track index" },
      line: { meaning: "pattern line index" },
      column: { meaning: "event column selector" },
    },
  },
  sv_get_time_map: {
    priority: "high",
    notes: ["The destination type depends on the requested time-map mode."],
    argumentSemantics: {
      start_line: { meaning: "first line to read" },
      len: { meaning: "number of lines to read", unit: "lines" },
      dest: { meaning: "uint32_t destination buffer", size: "len * sizeof(uint32_t)" },
      flags: {
        meaning: "time-map mode",
        values: {
          SV_TIME_MAP_SPEED: "BPM | (TPL << 16) at the beginning of each line",
          SV_TIME_MAP_FRAMECNT: "frame counter at the beginning of each line",
        },
      },
    },
  },
  sv_get_song_name: {
    priority: "medium",
    notes: ["Returns the current project name stored in the slot."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      returnValue: { meaning: "project name C string", specialValues: { NULL: "invalid slot" } },
    },
  },
  sv_get_song_bpm: {
    priority: "medium",
    notes: ["Returns the project BPM value."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      returnValue: { meaning: "project beats per minute", specialValues: { 0: "invalid slot" } },
    },
  },
  sv_get_song_tpl: {
    priority: "medium",
    notes: ["Returns the project speed value: ticks per line."],
    argumentSemantics: {
      slot: { meaning: "SunVox slot index" },
      returnValue: { meaning: "project ticks per line", unit: "ticks per line", specialValues: { 0: "invalid slot" } },
    },
  },
  sv_get_ticks: {
    priority: "medium",
    notes: ["Returns the current SunVox system tick counter; this is not the project tick timeline."],
    argumentSemantics: {
      returnValue: { meaning: "current system tick counter", range: "0..0xFFFFFFFF", unit: "SunVox system ticks" },
    },
  },
  sv_get_ticks_per_second: {
    priority: "medium",
    notes: ["Returns the number of SunVox system ticks per second."],
    argumentSemantics: {
      returnValue: { meaning: "system tick rate", unit: "ticks per second" },
    },
  },
  sv_load_module_from_memory: {
    priority: "high",
    notes: ["Return value is the loaded module index."],
    argumentSemantics: {
      data: { meaning: "module or sample data block" },
      data_size: { meaning: "data block size", unit: "bytes" },
      x: { meaning: "new module X position" },
      y: { meaning: "new module Y position" },
      z: { meaning: "new module Z position" },
    },
  },
  sv_metamodule_load_from_memory: {
    priority: "medium",
    notes: ["Loads data into an existing MetaModule slot."],
    argumentSemantics: {
      mod_num: { meaning: "existing MetaModule index" },
      data: { meaning: "project data block" },
      data_size: { meaning: "data block size", unit: "bytes" },
    },
  },
  sv_sampler_load_from_memory: {
    priority: "medium",
    notes: ["Loads sample data into an existing Sampler module."],
    argumentSemantics: {
      mod_num: { meaning: "existing Sampler index" },
      data: { meaning: "sample data block" },
      data_size: { meaning: "data block size", unit: "bytes" },
      sample_slot: { meaning: "target sample slot", specialValues: { "-1": "replace whole sampler" } },
    },
  },
};

function usage() {
  console.error(`Usage:
  node tools/sunvox-api-audit.mjs [--json] [--check]

Scans js/, tools/, and test/ for SunVox Lib API calls and compares them with
the checked-in source fixture under var/sunvox_lib/.`);
}

function extname(path) {
  const dot = path.lastIndexOf(".");
  return dot < 0 ? "" : path.slice(dot);
}

async function walkFiles(root) {
  const files = [];
  async function visit(path) {
    const entries = await readdir(path, { withFileTypes: true });
    for (const entry of entries) {
      const child = resolve(path, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRECTORIES.has(entry.name)) {
          await visit(child);
        }
      } else if (
        entry.isFile() &&
        SOURCE_EXTENSIONS.has(extname(entry.name)) &&
        !entry.name.endsWith(".d.ts") &&
        !SKIP_FILES.has(entry.name)
      ) {
        files.push(child);
      }
    }
  }
  await visit(resolve(root));
  return files;
}

function normalizeApiName(rawName) {
  return rawName.startsWith("_sv_") ? rawName.slice(1) : rawName;
}

function parseParameterList(signatureText) {
  const openIndex = signatureText.indexOf("(");
  const closeIndex = signatureText.indexOf(")", openIndex + 1);
  if (openIndex < 0 || closeIndex < 0) {
    return [];
  }
  const body = signatureText.slice(openIndex + 1, closeIndex).trim();
  if (!body || body === "void") {
    return [];
  }
  return body.split(",").map((part) => {
    const text = part.trim();
    const nameMatch = text.match(/([A-Za-z_][A-Za-z0-9_]*)\s*(?:\[[^\]]*\])?$/u);
    return {
      name: nameMatch ? nameMatch[1] : undefined,
      text,
    };
  });
}

function countCallArguments(argumentText) {
  const trimmed = argumentText.trim();
  if (!trimmed) {
    return 0;
  }
  let count = 1;
  let depth = 0;
  for (let index = 0; index < argumentText.length; index += 1) {
    const char = argumentText[index];
    if (char === "(" || char === "[" || char === "{") {
      depth += 1;
    } else if (char === ")" || char === "]" || char === "}") {
      depth = Math.max(0, depth - 1);
    } else if (char === "," && depth === 0) {
      count += 1;
    }
  }
  return count;
}

function readCallArgumentsFromLine(line, openParenIndex) {
  let depth = 0;
  for (let index = openParenIndex; index < line.length; index += 1) {
    const char = line[index];
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
      if (depth === 0) {
        return line.slice(openParenIndex + 1, index);
      }
    }
  }
  return undefined;
}

function collectCallsFromText(text, file) {
  const calls = [];
  const pattern = /\b(?:module\.|window\.)?(_?sv_[A-Za-z0-9_]+)(?:\?\.)?\s*\(/g;
  const stringLiteralPattern = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;
  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const codeOnlyLine = line.replace(stringLiteralPattern, (match) => " ".repeat(match.length));
    for (const match of codeOnlyLine.matchAll(pattern)) {
      const rawName = match[1];
      const openParenIndex = match.index + match[0].length - 1;
      const argumentText = readCallArgumentsFromLine(codeOnlyLine, openParenIndex);
      calls.push({
        api: normalizeApiName(rawName),
        rawName,
        binding: rawName.startsWith("_sv_") ? "wasm-export" : "js-wrapper",
        argumentCount: argumentText === undefined ? undefined : countCallArguments(argumentText),
        file,
        line: lineIndex + 1,
        column: match.index + 1,
        text: line.trim(),
      });
    }
  }
  return calls;
}

function collectSymbolsFromText(text, pattern) {
  const symbols = new Map();
  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const match = line.match(pattern);
    if (match) {
      symbols.set(match[1], { line: lineIndex + 1, text: line.trim() });
    }
  }
  return symbols;
}

function summarizeReviewedApi(item) {
  return {
    api: item.api,
    calls: item.calls.length,
    priority: item.review.priority,
  };
}

function summarizeUnreviewedApi(item) {
  return {
    api: item.api,
    calls: item.calls.length,
    bindings: Array.from(new Set(item.calls.map((call) => call.binding))).sort(),
    files: Array.from(new Set(item.calls.map((call) => call.file))).sort(),
  };
}

function formatAudit(audit) {
  const rows = [];
  rows.push("SunVox API audit");
  rows.push("");
  rows.push(`Header: ${audit.headerPath}`);
  rows.push(`Implementation: ${audit.implementationPath}`);
  rows.push(`JS wrapper: ${audit.wrapperPath}`);
  rows.push(`Scanned files: ${audit.scannedFileCount}`);
  rows.push(
    `Reviewed APIs: ${audit.reviewCoverage.reviewedApiCount}/${audit.reviewCoverage.referencedApiCount} ` +
      `(high=${audit.reviewCoverage.byPriority.high ?? 0}, medium=${audit.reviewCoverage.byPriority.medium ?? 0})`,
  );
  rows.push(`Unreviewed referenced APIs: ${audit.reviewCoverage.unreviewedApiCount}`);
  rows.push("");
  rows.push("Referenced APIs:");
  for (const item of audit.apis) {
    const note = item.review ? ` priority=${item.review.priority}` : "";
    rows.push(
      `- ${item.api}: calls=${item.calls.length} header=${item.header ? "yes" : "no"} implementation=${
        item.implementation ? "yes" : "no"
      }${note}`,
    );
    for (const call of item.calls.slice(0, 5)) {
      const arity = Number.isInteger(call.argumentCount)
        ? ` args=${call.argumentCount}/${call.expectedArgumentCount}`
        : "";
      rows.push(`  - ${call.file}:${call.line}:${call.column} (${call.rawName}, ${call.binding}${arity})`);
      if (item.review) {
        rows.push(`    source: ${call.text}`);
      }
    }
    if (item.calls.length > 5) {
      rows.push(`  - ... ${item.calls.length - 5} more`);
    }
    if (item.review && item.header) {
      rows.push(`  - header: ${item.header.line}: ${item.header.text}`);
    }
    if (item.header?.parameters?.length) {
      rows.push(`  - parameters: ${item.header.parameters.map((parameter) => parameter.name ?? parameter.text).join(", ")}`);
    }
    if (item.review?.argumentSemantics) {
      for (const parameter of item.header?.parameters ?? []) {
        const name = parameter.name;
        const semantics = name ? item.review.argumentSemantics[name] : undefined;
        if (!semantics) {
          continue;
        }
        const parts = [semantics.meaning];
        if (semantics.unit) {
          parts.push(`unit=${semantics.unit}`);
        }
        if (semantics.range) {
          parts.push(`range=${semantics.range}`);
        }
        if (semantics.format) {
          parts.push(`format=${semantics.format}`);
        }
        if (semantics.size) {
          parts.push(`size=${semantics.size}`);
        }
        if (semantics.values) {
          parts.push(
            `values=${Object.entries(semantics.values)
              .map(([value, meaning]) => `${value}: ${meaning}`)
              .join("; ")}`,
          );
        }
        if (semantics.specialValues) {
          parts.push(
            `special=${Object.entries(semantics.specialValues)
              .map(([value, meaning]) => `${value}: ${meaning}`)
              .join("; ")}`,
          );
        }
        for (const note of semantics.notes ?? []) {
          parts.push(note);
        }
        rows.push(`  - argument ${name}: ${parts.filter(Boolean).join("; ")}`);
      }
    }
    if (item.wrapper) {
      rows.push(`  - wrapper: ${item.wrapper.line}: ${item.wrapper.text}`);
      if (item.wrapper.parameters.length) {
        rows.push(
          `  - wrapper parameters: ${item.wrapper.parameters
            .map((parameter) => parameter.name ?? parameter.text)
            .join(", ")}`,
        );
      }
    }
    if (item.review && item.implementation) {
      rows.push(`  - implementation: ${item.implementation.line}: ${item.implementation.text}`);
    }
    for (const line of item.review?.notes ?? []) {
      rows.push(`  - note: ${line}`);
    }
    for (const mismatch of item.strictArityMismatches) {
      rows.push(
        `  - arity mismatch: ${mismatch.file}:${mismatch.line}:${mismatch.column} expected ${mismatch.expectedArgumentCount}, got ${mismatch.argumentCount}`,
      );
    }
  }
  if (audit.missingHeader.length) {
    rows.push("");
    rows.push("Missing from header:");
    for (const api of audit.missingHeader) {
      rows.push(`- ${api}`);
    }
  }
  if (audit.missingImplementation.length) {
    rows.push("");
    rows.push("Missing from implementation:");
    for (const api of audit.missingImplementation) {
      rows.push(`- ${api}`);
    }
  }
  if (audit.strictArityMismatches.length) {
    rows.push("");
    rows.push("WASM export arity mismatches:");
    for (const mismatch of audit.strictArityMismatches) {
      rows.push(
        `- ${mismatch.api}: ${mismatch.file}:${mismatch.line}:${mismatch.column} expected ${mismatch.expectedArgumentCount}, got ${mismatch.argumentCount}`,
      );
    }
  }
  if (audit.unreviewedApis.length) {
    rows.push("");
    rows.push("Unreviewed referenced APIs:");
    for (const item of audit.unreviewedApis) {
      rows.push(`- ${item.api}: calls=${item.calls} bindings=${item.bindings.join(", ")} files=${item.files.join(", ")}`);
    }
  }
  if (audit.reviewedButUnreferencedApis.length) {
    rows.push("");
    rows.push("Reviewed APIs not currently referenced:");
    for (const api of audit.reviewedButUnreferencedApis) {
      rows.push(`- ${api}`);
    }
  }
  return `${rows.join("\n")}\n`;
}

export async function collectApiAudit({
  cwd = process.cwd(),
  scanRoots = DEFAULT_SCAN_ROOTS,
  headerPath = DEFAULT_HEADER_PATH,
  implementationPath = DEFAULT_IMPLEMENTATION_PATH,
  wrapperPath = DEFAULT_WRAPPER_PATH,
} = {}) {
  const absoluteHeaderPath = resolve(cwd, headerPath);
  const absoluteImplementationPath = resolve(cwd, implementationPath);
  const absoluteWrapperPath = resolve(cwd, wrapperPath);
  const [headerText, implementationText, wrapperText] = await Promise.all([
    readFile(absoluteHeaderPath, "utf8"),
    readFile(absoluteImplementationPath, "utf8"),
    readFile(absoluteWrapperPath, "utf8"),
  ]);

  const headerSymbols = collectSymbolsFromText(
    headerText,
    /^\s*[A-Za-z_][A-Za-z0-9_*\s]*\b(sv_[A-Za-z0-9_]+)\s*\([^;]*\)\s*SUNVOX_FN_ATTR\b/,
  );
  const implementationSymbols = collectSymbolsFromText(
    implementationText,
    /SUNVOX_EXPORT(?:\s+[A-Za-z_][A-Za-z0-9_]*)*\s+[A-Za-z_][A-Za-z0-9_*\s]*\b(sv_[A-Za-z0-9_]+)\s*\(/,
  );
  const wrapperSymbols = collectSymbolsFromText(wrapperText, /^\s*function\s+(sv_[A-Za-z0-9_]+)\s*\([^)]*\)/);

  const files = (await Promise.all(scanRoots.map((root) => walkFiles(resolve(cwd, root))))).flat();
  const calls = [];
  for (const file of files) {
    const text = await readFile(file, "utf8");
    calls.push(...collectCallsFromText(text, relative(cwd, file)));
  }

  const byApi = new Map();
  for (const call of calls) {
    if (!byApi.has(call.api)) {
      byApi.set(call.api, []);
    }
    byApi.get(call.api).push(call);
  }

  const apis = [...byApi.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([api, apiCalls]) => {
      const header = headerSymbols.get(api);
      const parameters = header ? parseParameterList(header.text) : [];
      const parameterCount = parameters.length;
      const wrapper = wrapperSymbols.get(api);
      const wrapperParameters = wrapper ? parseParameterList(wrapper.text) : [];
      const wrapperParameterCount = wrapperParameters.length;
      const callsWithExpectedArity = apiCalls.map((call) => {
        const expectedArgumentCount =
          call.binding === "js-wrapper" && wrapper ? wrapperParameterCount : header ? parameterCount : undefined;
        const expectedArgumentSource = call.binding === "js-wrapper" && wrapper ? "wrapper" : header ? "header" : undefined;
        return {
          ...call,
          expectedArgumentCount,
          expectedArgumentSource,
        };
      });
      const strictArityMismatches = callsWithExpectedArity
        .filter(
          (call) =>
            Number.isInteger(call.argumentCount) &&
            Number.isInteger(call.expectedArgumentCount) &&
            call.argumentCount !== call.expectedArgumentCount,
        )
        .map((call) => ({ ...call }));
      return {
        api,
        calls: callsWithExpectedArity,
        header: header ? { ...header, parameters } : undefined,
        implementation: implementationSymbols.get(api),
        wrapper: wrapper ? { ...wrapper, parameters: wrapperParameters } : undefined,
        parameterCount,
        wrapperParameterCount: wrapper ? wrapperParameterCount : undefined,
        strictArityMismatches,
        review: REVIEW_NOTES[api],
      };
    });
  const strictArityMismatches = apis.flatMap((item) =>
    item.strictArityMismatches.map((call) => ({
      ...call,
      api: item.api,
    })),
  );
  const reviewedApis = apis.filter((item) => item.review).map(summarizeReviewedApi);
  const unreviewedApis = apis.filter((item) => !item.review).map(summarizeUnreviewedApi);
  const reviewedButUnreferencedApis = Object.keys(REVIEW_NOTES)
    .filter((api) => !byApi.has(api))
    .sort();
  const byPriority = reviewedApis.reduce((counts, item) => {
    counts[item.priority] = (counts[item.priority] ?? 0) + 1;
    return counts;
  }, {});

  return {
    headerPath,
    implementationPath,
    wrapperPath,
    scannedFileCount: files.length,
    reviewCoverage: {
      referencedApiCount: apis.length,
      reviewedApiCount: reviewedApis.length,
      unreviewedApiCount: unreviewedApis.length,
      reviewedButUnreferencedApiCount: reviewedButUnreferencedApis.length,
      byPriority,
    },
    reviewedApis,
    unreviewedApis,
    reviewedButUnreferencedApis,
    apis,
    missingHeader: apis.filter((item) => !item.header).map((item) => item.api),
    missingImplementation: apis.filter((item) => !item.implementation).map((item) => item.api),
    strictArityMismatches,
  };
}

async function main(argv) {
  const options = { json: false, check: false };
  for (const arg of argv) {
    if (arg === "--json") {
      options.json = true;
    } else if (arg === "--check") {
      options.check = true;
    } else if (arg === "--help" || arg === "-h") {
      usage();
      return;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  const audit = await collectApiAudit();
  if (options.json) {
    console.log(JSON.stringify(audit, null, 2));
  } else {
    process.stdout.write(formatAudit(audit));
  }
  if (
    options.check &&
    (audit.missingHeader.length || audit.missingImplementation.length || audit.strictArityMismatches.length)
  ) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

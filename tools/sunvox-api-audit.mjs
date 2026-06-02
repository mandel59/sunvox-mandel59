#!/usr/bin/env node

import { readdir, readFile } from "node:fs/promises";
import { relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const DEFAULT_HEADER_PATH = "var/sunvox_lib/sunvox_lib/headers/sunvox.h";
const DEFAULT_IMPLEMENTATION_PATH = "var/sunvox_lib/sunvox_lib/main/sunvox_lib.cpp";
const DEFAULT_SCAN_ROOTS = ["js", "tools", "test"];
const SOURCE_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"]);
const SKIP_DIRECTORIES = new Set([".git", ".jj", "node_modules", "dist", "var", "sunvox_lib"]);
const SKIP_FILES = new Set(["sunvox-api-audit.mjs", "sunvox-api-audit.test.mjs"]);

const REVIEW_NOTES = {
  sv_audio_callback: {
    priority: "high",
    notes: ["out_time is SunVox system ticks, not seconds."],
  },
  sv_audio_callback2: {
    priority: "medium",
    notes: ["out_time uses the same system tick space as sv_audio_callback()."],
  },
  sv_new_pattern: {
    priority: "high",
    notes: ["clone < 0 creates a fresh pattern; clone >= 0 creates a clone."],
  },
  sv_send_event: {
    priority: "high",
    notes: ["vel is the public API velocity: 1..129, 0 means default."],
  },
  sv_set_event_t: {
    priority: "high",
    notes: ["timestamp is SunVox system ticks."],
  },
  sv_set_module_ctl_value: {
    priority: "high",
    notes: ["scaled controls whether val is a scaled controller value."],
  },
  sv_get_module_ctl_value: {
    priority: "medium",
    notes: ["scaled controls whether the returned value is scaled."],
  },
  sv_set_pattern_event: {
    priority: "high",
    notes: ["Pattern event fields should not be inferred from sv_send_event() alone."],
  },
  sv_get_pattern_event: {
    priority: "medium",
    notes: ["Pattern event fields should be audited against pattern storage semantics."],
  },
  sv_get_time_map: {
    priority: "high",
    notes: ["The destination type depends on the requested time-map mode."],
  },
  sv_load_module_from_memory: {
    priority: "high",
    notes: ["Return value is the loaded module index."],
  },
  sv_metamodule_load_from_memory: {
    priority: "medium",
    notes: ["Loads data into an existing MetaModule slot."],
  },
  sv_sampler_load_from_memory: {
    priority: "medium",
    notes: ["Loads sample data into an existing Sampler module."],
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

function collectCallsFromText(text, file) {
  const calls = [];
  const pattern = /\b(?:module\.|window\.)?(_?sv_[A-Za-z0-9_]+)\b/g;
  const stringLiteralPattern = /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`/g;
  const lines = text.split(/\r?\n/);
  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const codeOnlyLine = line.replace(stringLiteralPattern, (match) => " ".repeat(match.length));
    for (const match of codeOnlyLine.matchAll(pattern)) {
      const rawName = match[1];
      calls.push({
        api: normalizeApiName(rawName),
        rawName,
        file,
        line: lineIndex + 1,
        column: match.index + 1,
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

function formatAudit(audit) {
  const rows = [];
  rows.push("SunVox API audit");
  rows.push("");
  rows.push(`Header: ${audit.headerPath}`);
  rows.push(`Implementation: ${audit.implementationPath}`);
  rows.push(`Scanned files: ${audit.scannedFileCount}`);
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
      rows.push(`  - ${call.file}:${call.line}:${call.column} (${call.rawName})`);
    }
    if (item.calls.length > 5) {
      rows.push(`  - ... ${item.calls.length - 5} more`);
    }
    if (item.review && item.header) {
      rows.push(`  - header: ${item.header.line}: ${item.header.text}`);
    }
    if (item.review && item.implementation) {
      rows.push(`  - implementation: ${item.implementation.line}: ${item.implementation.text}`);
    }
    for (const line of item.review?.notes ?? []) {
      rows.push(`  - note: ${line}`);
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
  return `${rows.join("\n")}\n`;
}

export async function collectApiAudit({
  cwd = process.cwd(),
  scanRoots = DEFAULT_SCAN_ROOTS,
  headerPath = DEFAULT_HEADER_PATH,
  implementationPath = DEFAULT_IMPLEMENTATION_PATH,
} = {}) {
  const absoluteHeaderPath = resolve(cwd, headerPath);
  const absoluteImplementationPath = resolve(cwd, implementationPath);
  const [headerText, implementationText] = await Promise.all([
    readFile(absoluteHeaderPath, "utf8"),
    readFile(absoluteImplementationPath, "utf8"),
  ]);

  const headerSymbols = collectSymbolsFromText(
    headerText,
    /^\s*[A-Za-z_][A-Za-z0-9_*\s]*\b(sv_[A-Za-z0-9_]+)\s*\([^;]*\)\s*SUNVOX_FN_ATTR\b/,
  );
  const implementationSymbols = collectSymbolsFromText(
    implementationText,
    /SUNVOX_EXPORT(?:\s+[A-Za-z_][A-Za-z0-9_]*)*\s+[A-Za-z_][A-Za-z0-9_*\s]*\b(sv_[A-Za-z0-9_]+)\s*\(/,
  );

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
    .map(([api, apiCalls]) => ({
      api,
      calls: apiCalls,
      header: headerSymbols.get(api),
      implementation: implementationSymbols.get(api),
      review: REVIEW_NOTES[api],
    }));

  return {
    headerPath,
    implementationPath,
    scannedFileCount: files.length,
    apis,
    missingHeader: apis.filter((item) => !item.header).map((item) => item.api),
    missingImplementation: apis.filter((item) => !item.implementation).map((item) => item.api),
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
  if (options.check && (audit.missingHeader.length || audit.missingImplementation.length)) {
    process.exitCode = 1;
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main(process.argv.slice(2)).catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

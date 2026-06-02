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
      const arity = Number.isInteger(call.argumentCount) ? ` args=${call.argumentCount}/${item.parameterCount}` : "";
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
    if (item.review && item.implementation) {
      rows.push(`  - implementation: ${item.implementation.line}: ${item.implementation.text}`);
    }
    for (const line of item.review?.notes ?? []) {
      rows.push(`  - note: ${line}`);
    }
    for (const mismatch of item.strictArityMismatches) {
      rows.push(
        `  - arity mismatch: ${mismatch.file}:${mismatch.line}:${mismatch.column} expected ${item.parameterCount}, got ${mismatch.argumentCount}`,
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
    .map(([api, apiCalls]) => {
      const header = headerSymbols.get(api);
      const parameters = header ? parseParameterList(header.text) : [];
      const parameterCount = parameters.length;
      const strictArityMismatches = apiCalls
        .filter(
          (call) =>
            call.binding === "wasm-export" &&
            Number.isInteger(call.argumentCount) &&
            Number.isInteger(parameterCount) &&
            call.argumentCount !== parameterCount,
        )
        .map((call) => ({ ...call, expectedArgumentCount: parameterCount }));
      return {
        api,
        calls: apiCalls,
        header: header ? { ...header, parameters } : undefined,
        implementation: implementationSymbols.get(api),
        parameterCount,
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

  return {
    headerPath,
    implementationPath,
    scannedFileCount: files.length,
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

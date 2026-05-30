#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const DEFAULT_PATHS = ["tools", "test", "js", "src"];
const SOURCE_EXTENSIONS = new Set([".js", ".jsx", ".mjs"]);
const SKIP_DIRECTORIES = new Set(["node_modules", "dist", "var", "sunvox_lib"]);

function compareText(a, b) {
  return a.localeCompare(b, "en");
}

function safeStat(path) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

function countBraces(line) {
  let count = 0;
  let quote = "";
  let escaped = false;
  for (const char of line) {
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = "";
      }
      continue;
    }
    if (char === '"' || char === "'" || char === "`") {
      quote = char;
      continue;
    }
    if (char === "{") {
      count += 1;
    } else if (char === "}") {
      count -= 1;
    }
  }
  return count;
}

function logicalLines(text) {
  const lines = text.split(/\r?\n/u);
  if (lines.at(-1) === "") {
    lines.pop();
  }
  return lines;
}

function findSourceFiles(paths) {
  const files = [];
  for (const input of paths) {
    const path = resolve(input);
    const stat = safeStat(path);
    if (!stat) {
      continue;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        if (entry.isDirectory() && SKIP_DIRECTORIES.has(entry.name)) {
          continue;
        }
        files.push(...findSourceFiles([join(path, entry.name)]));
      }
      continue;
    }
    if (stat.isFile() && SOURCE_EXTENSIONS.has(extname(path).toLowerCase())) {
      files.push(path);
    }
  }
  return files.sort(compareText);
}

function functionNameFromLine(line) {
  const declaration = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_$]+)\s*\(/u.exec(line.trim());
  if (declaration) {
    return declaration[1];
  }
  const arrow = /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z0-9_$]+)\s*=\s*(?:async\s*)?(?:\([^)]*\)|[A-Za-z0-9_$]+)\s*=>/u.exec(
    line.trim(),
  );
  return arrow?.[1];
}

export function collectFileMetrics(file) {
  const text = readFileSync(file, "utf8");
  const lines = logicalLines(text);
  const functions = [];
  let current = undefined;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;
    if (!current) {
      const name = functionNameFromLine(line);
      if (!name) {
        return;
      }
      current = {
        file: relative(process.cwd(), file),
        name,
        startLine: lineNumber,
        braceDepth: 0,
        bodyStarted: false,
      };
    }

    const delta = countBraces(line);
    current.braceDepth += delta;
    if (line.includes("{")) {
      current.bodyStarted = true;
    }
    if (current.bodyStarted && current.braceDepth <= 0) {
      functions.push({
        file: current.file,
        name: current.name,
        startLine: current.startLine,
        endLine: lineNumber,
        lines: lineNumber - current.startLine + 1,
      });
      current = undefined;
    }
  });

  return {
    file: relative(process.cwd(), file),
    lines: lines.length,
    nonBlankLines: lines.filter((line) => line.trim()).length,
    functions,
  };
}

export function collectCodeMetrics(paths = DEFAULT_PATHS) {
  const files = findSourceFiles(paths);
  const fileMetrics = files.map(collectFileMetrics);
  const functions = fileMetrics.flatMap((file) => file.functions);
  const largestFiles = [...fileMetrics].sort((a, b) => b.lines - a.lines || compareText(a.file, b.file)).slice(0, 10);
  const longestFunctions = [...functions]
    .sort((a, b) => b.lines - a.lines || compareText(a.file, b.file) || a.startLine - b.startLine)
    .slice(0, 10);

  return {
    paths,
    summary: {
      files: fileMetrics.length,
      lines: fileMetrics.reduce((total, file) => total + file.lines, 0),
      nonBlankLines: fileMetrics.reduce((total, file) => total + file.nonBlankLines, 0),
      functions: functions.length,
      maxFileLines: largestFiles[0]?.lines ?? 0,
      maxFunctionLines: longestFunctions[0]?.lines ?? 0,
    },
    largestFiles,
    longestFunctions,
  };
}

function formatTable(rows, columns) {
  if (rows.length === 0) {
    return "(none)";
  }
  const widths = columns.map((column) =>
    Math.max(column.header.length, ...rows.map((row) => String(column.value(row)).length)),
  );
  return [
    columns.map((column, index) => column.header.padEnd(widths[index])).join("  "),
    widths.map((width) => "-".repeat(width)).join("  "),
    ...rows.map((row) =>
      columns.map((column, index) => String(column.value(row)).padEnd(widths[index])).join("  "),
    ),
  ].join("\n");
}

function formatCodeMetrics(metrics) {
  const summaryRows = [
    { metric: "Source files", value: metrics.summary.files },
    { metric: "Lines", value: metrics.summary.lines },
    { metric: "Non-blank lines", value: metrics.summary.nonBlankLines },
    { metric: "Functions", value: metrics.summary.functions },
    { metric: "Largest file lines", value: metrics.summary.maxFileLines },
    { metric: "Longest function lines", value: metrics.summary.maxFunctionLines },
  ];

  return [
    "Code metrics",
    "",
    `Paths: ${metrics.paths.join(", ")}`,
    "",
    "Summary:",
    formatTable(summaryRows, [
      { header: "metric", value: (row) => row.metric },
      { header: "value", value: (row) => row.value },
    ]),
    "",
    "Largest files:",
    formatTable(metrics.largestFiles, [
      { header: "file", value: (row) => row.file },
      { header: "lines", value: (row) => row.lines },
      { header: "nonBlank", value: (row) => row.nonBlankLines },
    ]),
    "",
    "Longest functions:",
    formatTable(metrics.longestFunctions, [
      { header: "file", value: (row) => row.file },
      { header: "function", value: (row) => row.name },
      { header: "lines", value: (row) => row.lines },
      { header: "line", value: (row) => row.startLine },
    ]),
  ].join("\n");
}

function main(argv) {
  const json = argv.includes("--json");
  const paths = argv.filter((arg) => arg !== "--json");
  const metrics = collectCodeMetrics(paths.length ? paths : DEFAULT_PATHS);
  console.log(json ? JSON.stringify(metrics, null, 2) : formatCodeMetrics(metrics));
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  main(process.argv.slice(2));
}

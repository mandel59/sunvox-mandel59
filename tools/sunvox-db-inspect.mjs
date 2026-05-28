#!/usr/bin/env node
import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { parseContainer, SUNVOX_DB } from "./sunvox-codec.mjs";

const DEFAULT_SAMPLE_ROOTS = ["music", "instruments"];
const DEFAULT_SOURCE_ROOT = "var/sunvox_lib/lib_sunvox/psynth";
const SAMPLE_EXTENSIONS = new Set([".sunvox", ".sunsynth"]);

function usage() {
  console.error(`Usage:
  node tools/sunvox-db-inspect.mjs coverage [--details] [sample-path ...]
  node tools/sunvox-db-inspect.mjs report [source-root]`);
}

function compareText(a, b) {
  return a.localeCompare(b, "en");
}

function increment(map, key, count = 1) {
  map.set(key, (map.get(key) ?? 0) + count);
}

function safeStat(path) {
  try {
    return statSync(path);
  } catch {
    return undefined;
  }
}

function findFiles(paths, extensions) {
  const files = [];
  for (const input of paths) {
    const path = resolve(input);
    const stat = safeStat(path);
    if (!stat) {
      continue;
    }
    if (stat.isDirectory()) {
      for (const entry of readdirSync(path, { withFileTypes: true })) {
        files.push(...findFiles([join(path, entry.name)], extensions));
      }
      continue;
    }
    if (stat.isFile() && extensions.has(extname(path).toLowerCase())) {
      files.push(path);
    }
  }
  return files.sort(compareText);
}

function expandTemplate(template, context) {
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
    let chunkIndex = repeat.startIndex ?? 0;
    for (const item of repeat.items ?? []) {
      const count = item.repeatCount ?? repeat.count ?? 0;
      for (let repeatIndex = 0; repeatIndex < count; repeatIndex += 1) {
        const context = { index: repeatIndex, number: repeatIndex + 1, name: item.name };
        const definition = { ...item, index: chunkIndex };
        delete definition.repeatCount;
        definition.name = expandTemplate(item.idTemplate ?? repeat.idTemplate, context) ?? item.name;
        definition.path =
          expandTemplate(item.pathTemplate ?? repeat.pathTemplate, context) ?? definition.name;
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

function dbControllerCount(moduleType) {
  return expandControllerDefinitions(SUNVOX_DB.modules[moduleType]?.controllers).length;
}

function moduleLabel(module, fallbackIndex) {
  const parts = [`#${module.index ?? fallbackIndex}`];
  if (module.name) {
    parts.push(module.name);
  }
  if (module.type) {
    parts.push(`<${module.type}>`);
  }
  return parts.join(" ");
}

function collectDocumentModules(document, source, path, modules) {
  const documentModules =
    document.magic === "SSYN" ? (document.module ? [document.module] : []) : document.modules ?? [];

  documentModules.forEach((module, index) => {
    const modulePath = [...path, moduleLabel(module, index)];
    modules.push({ source, path: modulePath.join(" / "), module });

    for (const chunk of module.dataChunks ?? []) {
      if (chunk.container) {
        collectDocumentModules(
          chunk.container,
          source,
          [...modulePath, `dataChunk[${chunk.index}]`],
          modules,
        );
      }
    }
  });
}

export function collectCoverage(sampleRoots = DEFAULT_SAMPLE_ROOTS) {
  const sampleFiles = findFiles(sampleRoots, SAMPLE_EXTENSIONS);
  const modules = [];
  const errors = [];

  for (const file of sampleFiles) {
    try {
      const document = parseContainer(readFileSync(file));
      collectDocumentModules(document, relative(process.cwd(), file), [], modules);
    } catch (error) {
      errors.push({ file: relative(process.cwd(), file), message: error.message });
    }
  }

  const moduleTypes = new Map();
  const missingDbTypes = new Map();
  const rawControllers = [];
  const controllerExtras = [];
  const moduleExtraChunks = [];
  const opaqueDataChunks = [];

  for (const { source, path, module } of modules) {
    const type = module.type ?? "(missing type)";
    increment(moduleTypes, type);
    if (module.type && !SUNVOX_DB.modules[module.type]) {
      increment(missingDbTypes, module.type);
    }

    if (Array.isArray(module.controllers)) {
      rawControllers.push({
        source,
        path,
        type,
        count: module.controllers.filter((value) => value !== undefined).length,
      });
    } else if (module.controllers?.extra && typeof module.controllers.extra === "object") {
      controllerExtras.push({
        source,
        path,
        type,
        indexes: Object.keys(module.controllers.extra).map(Number).sort((a, b) => a - b),
      });
    }

    if (Array.isArray(module.extraChunks) && module.extraChunks.length > 0) {
      moduleExtraChunks.push({ source, path, type, count: module.extraChunks.length });
    }

    for (const chunk of module.dataChunks ?? []) {
      if (chunk.base64 !== undefined) {
        opaqueDataChunks.push({
          source,
          path,
          type,
          index: chunk.index,
          name: chunk.name,
        });
      }
    }
  }

  return {
    files: sampleFiles.map((file) => relative(process.cwd(), file)),
    errors,
    moduleCount: modules.length,
    moduleTypes: [...moduleTypes.entries()].sort(([a], [b]) => compareText(a, b)),
    dbModuleTypes: Object.keys(SUNVOX_DB.modules).sort(compareText),
    missingDbTypes: [...missingDbTypes.entries()].sort(([a], [b]) => compareText(a, b)),
    rawControllers,
    controllerExtras,
    moduleExtraChunks,
    opaqueDataChunks,
  };
}

function aggregateRows(rows, keyFn, updateFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) {
      groups.set(key, { key, count: 0 });
    }
    const group = groups.get(key);
    group.count += 1;
    updateFn?.(group, row);
  }
  return [...groups.values()].sort((a, b) => compareText(a.key, b.key));
}

function extractCaseReturnString(text, command) {
  const pattern = new RegExp(
    `case\\s+${command}\\s*:\\s*(?:\\{[\\s\\S]*?\\})?\\s*retval\\s*=\\s*(?:\\(PS_RETTYPE\\))?\\s*"([^"]+)"`,
    "u",
  );
  return pattern.exec(text)?.[1];
}

function extractCaseReturnExpression(text, command) {
  const pattern = new RegExp(`case\\s+${command}\\s*:\\s*retval\\s*=\\s*([^;]+);`, "u");
  return pattern.exec(text)?.[1]?.trim();
}

function countMatches(text, pattern) {
  return [...text.matchAll(pattern)].length;
}

function scanSourceFile(file) {
  const text = readFileSync(file, "utf8");
  const fallbackName = file
    .replace(/\\/gu, "/")
    .replace(/^.*\/psynths_/u, "")
    .replace(/\.cpp$/u, "");
  return {
    file: relative(process.cwd(), file),
    module: extractCaseReturnString(text, "PS_CMD_GET_NAME") ?? fallbackName,
    controllers: countMatches(text, /psynth_register_ctl\s*\(/gu),
    showOffsets: countMatches(text, /psynth_set_ctl_show_offset\s*\(/gu),
    controlFlags: countMatches(text, /psynth_set_ctl_flags\s*\(/gu),
    color: extractCaseReturnString(text, "PS_CMD_GET_COLOR"),
    inputs: extractCaseReturnExpression(text, "PS_CMD_GET_INPUTS_NUM"),
    outputs: extractCaseReturnExpression(text, "PS_CMD_GET_OUTPUTS_NUM"),
    flags: extractCaseReturnExpression(text, "PS_CMD_GET_FLAGS"),
    flags2: extractCaseReturnExpression(text, "PS_CMD_GET_FLAGS2"),
  };
}

export function collectSourceReport(sourceRoot = DEFAULT_SOURCE_ROOT) {
  const files = findFiles([sourceRoot], new Set([".cpp"])).filter((file) =>
    /[\\/]psynths_[^\\/]+\.cpp$/u.test(file),
  );
  const modules = files.map(scanSourceFile).sort((a, b) => compareText(a.module, b.module));
  const sourceByName = new Map(modules.map((module) => [module.module, module]));
  const dbModules = Object.keys(SUNVOX_DB.modules).sort(compareText);
  const dbRows = dbModules.map((module) => ({
    module,
    sourceControllers: sourceByName.get(module)?.controllers,
    dbControllers: dbControllerCount(module),
    inSource: sourceByName.has(module),
  }));

  return {
    sourceRoot,
    sourceFiles: files.map((file) => relative(process.cwd(), file)),
    sourceModules: modules,
    dbModules: dbRows,
    missingFromDb: modules
      .filter((module) => !SUNVOX_DB.modules[module.module])
      .map((module) => ({
        module: module.module,
        controllers: module.controllers,
        file: module.file,
      })),
    missingFromSource: dbRows.filter((module) => !module.inSource).map((module) => module.module),
  };
}

function formatTable(rows, columns) {
  if (rows.length === 0) {
    return "(none)";
  }
  const widths = columns.map((column) =>
    Math.max(
      column.header.length,
      ...rows.map((row) => String(column.value(row) ?? "").length),
    ),
  );
  const header = columns.map((column, index) => column.header.padEnd(widths[index])).join("  ");
  const separator = widths.map((width) => "-".repeat(width)).join("  ");
  const body = rows
    .map((row) =>
      columns.map((column, index) => String(column.value(row) ?? "").padEnd(widths[index])).join("  "),
    )
    .join("\n");
  return `${header}\n${separator}\n${body}`;
}

function formatCoverage(coverage, options = {}) {
  const rawControllerSummary = aggregateRows(coverage.rawControllers, (row) => row.type, (group, row) => {
    group.controllers = (group.controllers ?? 0) + row.count;
  });
  const controllerExtraSummary = aggregateRows(coverage.controllerExtras, (row) => row.type, (group, row) => {
    group.indexes ??= new Set();
    for (const index of row.indexes) {
      group.indexes.add(index);
    }
  }).map((group) => ({ ...group, indexes: [...group.indexes].sort((a, b) => a - b) }));
  const extraChunkSummary = aggregateRows(coverage.moduleExtraChunks, (row) => row.type, (group, row) => {
    group.chunks = (group.chunks ?? 0) + row.count;
  });
  const opaqueDataSummary = aggregateRows(
    coverage.opaqueDataChunks,
    (row) => `${row.type} ${row.index} ${row.name ?? ""}`.trim(),
    (group, row) => {
      group.type = row.type;
      group.index = row.index;
      group.name = row.name ?? "";
    },
  );

  const lines = [
    "SunVox DB coverage",
    "",
    `Files: ${coverage.files.length}`,
    ...coverage.files.map((file) => `  - ${file}`),
    "",
    `Decoded modules including embedded containers: ${coverage.moduleCount}`,
    `Unique module types in samples: ${coverage.moduleTypes.length}`,
    `DB module types: ${coverage.dbModuleTypes.length}`,
    "",
    "Module types in samples:",
    formatTable(
      coverage.moduleTypes.map(([type, count]) => ({
        type,
        count,
        db: SUNVOX_DB.modules[type] ? "yes" : "no",
        dbControllers: dbControllerCount(type),
      })),
      [
        { header: "type", value: (row) => row.type },
        { header: "count", value: (row) => row.count },
        { header: "db", value: (row) => row.db },
        { header: "dbControllers", value: (row) => row.dbControllers },
      ],
    ),
    "",
    "Missing DB module types in samples:",
    formatTable(
      coverage.missingDbTypes.map(([type, count]) => ({ type, count })),
      [
        { header: "type", value: (row) => row.type },
        { header: "count", value: (row) => row.count },
      ],
    ),
    "",
    "Raw controller arrays by type:",
    formatTable(rawControllerSummary, [
      { header: "type", value: (row) => row.key },
      { header: "modules", value: (row) => row.count },
      { header: "controllerValues", value: (row) => row.controllers },
    ]),
    "",
    "Controller extras by type:",
    formatTable(controllerExtraSummary, [
      { header: "type", value: (row) => row.key },
      { header: "modules", value: (row) => row.count },
      { header: "indexes", value: (row) => row.indexes.join(",") },
    ]),
    "",
    "Module extra chunks by type:",
    formatTable(extraChunkSummary, [
      { header: "type", value: (row) => row.key },
      { header: "modules", value: (row) => row.count },
      { header: "chunks", value: (row) => row.chunks },
    ]),
    "",
    "Opaque data chunks by type/index:",
    formatTable(opaqueDataSummary, [
      { header: "type", value: (row) => row.type },
      { header: "index", value: (row) => row.index },
      { header: "name", value: (row) => row.name ?? "" },
      { header: "chunks", value: (row) => row.count },
    ]),
  ];

  if (options.details) {
    lines.push(
      "",
      "Raw controller array details:",
      formatTable(coverage.rawControllers, [
        { header: "type", value: (row) => row.type },
        { header: "count", value: (row) => row.count },
        { header: "source", value: (row) => row.source },
        { header: "path", value: (row) => row.path },
      ]),
      "",
      "Controller extra details:",
      formatTable(coverage.controllerExtras, [
        { header: "type", value: (row) => row.type },
        { header: "indexes", value: (row) => row.indexes.join(",") },
        { header: "source", value: (row) => row.source },
        { header: "path", value: (row) => row.path },
      ]),
      "",
      "Module extra chunk details:",
      formatTable(coverage.moduleExtraChunks, [
        { header: "type", value: (row) => row.type },
        { header: "count", value: (row) => row.count },
        { header: "source", value: (row) => row.source },
        { header: "path", value: (row) => row.path },
      ]),
      "",
      "Opaque data chunk details:",
      formatTable(coverage.opaqueDataChunks, [
        { header: "type", value: (row) => row.type },
        { header: "index", value: (row) => row.index },
        { header: "name", value: (row) => row.name ?? "" },
        { header: "source", value: (row) => row.source },
        { header: "path", value: (row) => row.path },
      ]),
    );
  }

  if (coverage.errors.length) {
    lines.push("", "Errors:", formatTable(coverage.errors, [
      { header: "file", value: (row) => row.file },
      { header: "message", value: (row) => row.message },
    ]));
  }

  return lines.join("\n");
}

function formatSourceReport(report) {
  const sourceControllerTotal = report.sourceModules.reduce((total, module) => total + module.controllers, 0);
  const dbControllerTotal = report.dbModules.reduce((total, module) => total + module.dbControllers, 0);

  return [
    "SunVox source / DB report",
    "",
    `Source root: ${report.sourceRoot}`,
    `Source modules: ${report.sourceModules.length}`,
    `Source controller declarations: ${sourceControllerTotal}`,
    `DB modules: ${report.dbModules.length}`,
    `DB controller definitions: ${dbControllerTotal}`,
    "",
    "Source modules missing from DB:",
    formatTable(report.missingFromDb, [
      { header: "module", value: (row) => row.module },
      { header: "controllers", value: (row) => row.controllers },
      { header: "file", value: (row) => row.file },
    ]),
    "",
    "DB modules missing from source scan:",
    report.missingFromSource.length ? report.missingFromSource.map((module) => `  - ${module}`).join("\n") : "(none)",
    "",
    "Covered DB modules:",
    formatTable(
      report.dbModules.filter((module) => module.inSource),
      [
        { header: "module", value: (row) => row.module },
        { header: "sourceControllers", value: (row) => row.sourceControllers },
        { header: "dbControllers", value: (row) => row.dbControllers },
      ],
    ),
  ].join("\n");
}

function main(argv) {
  const [command, ...args] = argv;
  if (command === "coverage") {
    const details = args.includes("--details");
    const paths = args.filter((arg) => arg !== "--details");
    console.log(formatCoverage(collectCoverage(paths.length ? paths : DEFAULT_SAMPLE_ROOTS), { details }));
    return;
  }
  if (command === "report") {
    console.log(formatSourceReport(collectSourceReport(args[0] ?? DEFAULT_SOURCE_ROOT)));
    return;
  }
  usage();
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  main(process.argv.slice(2));
}

#!/usr/bin/env node
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { buildContainer, SUNVOX_DB, TEXT_FORMAT } from "./sunvox-codec.mjs";

const OUTPUT_PATH = "test/fixtures/sunvox/unsampled-modules.sunvox";
export const COVERAGE_MODULE_TYPES = [
  "ADSR",
  "Ctl2Note",
  "Feedback",
  "FFT",
  "GPIO",
  "Input",
  "Kicker",
  "Loop",
  "Pitch Detector",
  "Pitch2Ctl",
  "Sampler",
  "Smooth",
  "Vocal filter",
  "Vorbis player",
];

function setPath(target, path, value) {
  const parts = path.split(".");
  let cursor = target;
  for (const part of parts.slice(0, -1)) {
    cursor[part] ??= {};
    cursor = cursor[part];
  }
  cursor[parts.at(-1)] = value;
}

function defaultControllers(moduleType) {
  const controllers = {};
  for (const controller of SUNVOX_DB.modules[moduleType]?.controllers ?? []) {
    if (controller.repeat || controller.default === undefined) {
      continue;
    }
    setPath(controllers, controller.path ?? controller.name, controller.default);
  }
  return Object.keys(controllers).length ? controllers : undefined;
}

function coverageModule(moduleType, index) {
  return {
    name: `Coverage ${moduleType}`,
    type: moduleType,
    position: {
      x: (index % 7) * 128,
      y: Math.floor(index / 7) * 96,
    },
    controllers: defaultControllers(moduleType),
  };
}

export function buildCoverageFixture() {
  const document = {
    format: TEXT_FORMAT,
    magic: "SVOX",
    headerTailHex: "00000000",
    project: {
      name: "SunVox codec synthetic coverage fixture",
    },
    patterns: [],
    modules: COVERAGE_MODULE_TYPES.map(coverageModule),
    trailingChunks: [],
  };

  return buildContainer(document);
}

if (import.meta.url === pathToFileURL(resolve(process.argv[1] ?? "")).href) {
  mkdirSync(dirname(OUTPUT_PATH), { recursive: true });
  writeFileSync(OUTPUT_PATH, buildCoverageFixture());
  console.log(`Generated ${OUTPUT_PATH}`);
}

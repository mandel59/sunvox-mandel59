import assert from "node:assert/strict";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  buildContainer,
  decode,
  decodeChunkData,
  encode,
  formatValidationIssue,
  parseContainer,
  parseEditableContainer,
  parseVerboseContainer,
  sha256,
  SUNVOX_DB,
  TEXT_FORMAT,
  validateContainer,
} from "../tools/sunvox-codec.mjs";

function withoutAuxiliaryProperties(value) {
  if (Array.isArray(value)) {
    return value.map((item) => withoutAuxiliaryProperties(item));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !key.startsWith("_"))
        .map(([key, item]) => [key, withoutAuxiliaryProperties(item)]),
    );
  }
  return value;
}

test("parses project into structured metadata", async () => {
  const buffer = await readFile("music/2022-04-17.sunvox");
  const document = parseContainer(buffer);

  assert.equal(document.magic, "SVOX");
  assert.equal(document.format, "sunvox-structured-text-v1");
  assert.equal(document.project.name, "2022-04-17 03-24");
  assert.equal(document.project.version, 33554437);
  assert.equal(document.project.bpm, 125);
  assert.equal(document.project.speed, 6);
  assert.deepEqual(document.project.syncFlags, {
    midiStartStopContinue: true,
    otherStartStopContinue: true,
  });
  assert.equal(document.project.currentLayer, 0);
  assert.equal(document.project.lineCounter, 17);
  assert.equal(document.project.selectedModule, 2);
  assert.equal(document.project.currentPattern, 0);
  assert.equal(document.project.currentPatternTrack, 1);
  assert.equal(document.project.currentPatternLine, 0);
  assert.equal(document.project.chunks, undefined);
  assert.ok(document.patterns.length > 0);
  assert.ok(document.modules.length > 0);
  assert.equal(document.patterns.some((pattern) => Array.isArray(pattern.chunks)), false);
  assert.equal(document.modules.some((module) => Array.isArray(module.chunks)), false);
  assert.equal(document.patterns[0].index, undefined);
  assert.equal(document.patterns[0].layer, undefined);
  assert.deepEqual(document.modules[1].inputs, [
    { slot: 0, module: 8, peerSlot: 1, _moduleName: "MultiCtl", _moduleType: "MultiCtl" },
  ]);
  assert.equal(document.modules[1].inputSlotCount, 2);
  assert.equal(document.modules[1].inputLinks, undefined);
  assert.equal(document.modules[1].inputLinkSlots, undefined);
});

test("reports DB-driven runtime constraint warnings", () => {
  const result = validateContainer({
    magic: "SVOX",
    project: { bpm: 0, speed: 0 },
    modules: [
      {
        type: "Amplifier",
        name: "012345678901234567890123456789012",
        inputs: [{ slot: 0, module: -1 }],
        outputs: [{ slot: 0, module: -1 }],
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.issues.map((issue) => issue.rule),
    [
      "project.bpm.positive",
      "project.speed.positive",
      "module.name.maxBytes",
      "module.inputs.target.nonNegative",
      "module.outputs.target.nonNegative",
    ],
  );
  assert.match(result.issues[2].message, /33 UTF-8 bytes/u);
  assert.equal(result.issues[3].path, "modules[0].inputs[0].module");
  assert.deepEqual(result.issues.map((issue) => issue.trackingIssue), [2, 2, 2, 2, 2]);
  assert.match(formatValidationIssue(result.issues[0]), /issue=#2/u);
});

test("reports DB-driven controller value warnings", () => {
  const result = validateContainer({
    magic: "SVOX",
    project: { bpm: 125, speed: 6 },
    modules: [
      {
        type: "Amplifier",
        name: "Amp",
        controllers: {
          volume: -1,
          inverse: "definitelyNotAnEnumValue",
        },
      },
    ],
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.issues.map((issue) => issue.rule),
    ["module.controller.range", "module.controller.range"],
  );
  assert.match(result.issues[0].message, /expected >= 0/u);
  assert.equal(result.issues[0].controller, "volume");
  assert.equal(result.issues[0].trackingIssue, 2);
  assert.match(result.issues[1].message, /known off_on value/u);
  assert.equal(result.issues[1].path, "modules[0].controllers.inverse");
  assert.match(formatValidationIssue(result.issues[1]), /source=psynth_register_ctl issue=#2/u);
});

test("recursively validates embedded MetaModule containers", () => {
  const result = validateContainer({
    magic: "SSYN",
    module: {
      type: "MetaModule",
      dataChunks: [
        {
          index: 0,
          container: {
            magic: "SVOX",
            project: { bpm: 0, speed: 6 },
            modules: [
              {
                type: "Amplifier",
                controllers: {
                  volume: -1,
                },
              },
            ],
          },
        },
      ],
    },
  });

  assert.equal(result.ok, true);
  assert.deepEqual(
    result.issues.map((issue) => issue.path),
    [
      "module.dataChunks[0].container.project.bpm",
      "module.dataChunks[0].container.modules[0].controllers.volume",
    ],
  );
  assert.deepEqual(
    result.issues.map((issue) => issue.rule),
    ["project.bpm.positive", "module.controller.range"],
  );
  assert.match(formatValidationIssue(result.issues[0]), /issue=#2/u);
});

test("decodes project supertrack mute and jump address state", () => {
  const document = {
    format: TEXT_FORMAT,
    magic: "SVOX",
    headerTailHex: "00000000",
    project: {
      flags: {
        midiOut7bit: true,
      },
      syncFlags: {
        midiClock: true,
        otherPosition: true,
      },
      supertrackMuteWords: [1, 2],
      jumpAddressMode: "nextLineMinus",
    },
    patterns: [],
    modules: [],
  };

  const buffer = buildContainer(document);
  const parsed = parseContainer(buffer);

  assert.deepEqual(parsed.project.flags, { midiOut7bit: true });
  assert.deepEqual(parsed.project.syncFlags, {
    midiClock: true,
    otherPosition: true,
  });
  assert.deepEqual(parsed.project.supertrackMuteWords, [1, 2]);
  assert.equal(parsed.project.jumpAddressMode, "nextLineMinus");
  assert.equal(sha256(buildContainer(parsed)), sha256(buffer));
});

test("preserves signed project editor state values", () => {
  const document = {
    format: TEXT_FORMAT,
    magic: "SVOX",
    headerTailHex: "00000000",
    project: {
      view: {
        moduleScale: 256,
        moduleZoom: 256,
      },
      currentLayer: -1,
      lineCounter: -1,
      restartPosition: -1,
      selectedModule: -1,
      lastSelectedGenerator: -1,
      currentPattern: -1,
      currentPatternTrack: -1,
      currentPatternLine: -1,
    },
    patterns: [],
    modules: [],
  };

  const buffer = buildContainer(document);
  const parsed = parseContainer(buffer);

  assert.equal(parsed.project.currentLayer, -1);
  assert.equal(parsed.project.lineCounter, -1);
  assert.equal(parsed.project.restartPosition, -1);
  assert.equal(parsed.project.selectedModule, -1);
  assert.equal(parsed.project.lastSelectedGenerator, -1);
  assert.equal(parsed.project.currentPattern, -1);
  assert.equal(parsed.project.currentPatternTrack, -1);
  assert.equal(parsed.project.currentPatternLine, -1);
  assert.equal(sha256(buildContainer(parsed)), sha256(buffer));
});

test("decodes clone pattern parent numbers and stable parent ids", () => {
  const document = {
    format: TEXT_FORMAT,
    magic: "SVOX",
    headerTailHex: "00000000",
    project: {},
    patterns: [
      {
        parent: 0,
        parentId: 12345,
        infoFlags: { clone: true },
      },
    ],
    modules: [],
  };

  const buffer = buildContainer(document);
  const parsed = parseContainer(buffer);

  assert.equal(parsed.patterns[0].parent, 0);
  assert.equal(parsed.patterns[0].parentId, 12345);
  assert.deepEqual(parsed.patterns[0].infoFlags, { clone: true });
  assert.equal(sha256(buildContainer(parsed)), sha256(buffer));
});

test("preserves signed pattern parent and data chunk sample rate values", () => {
  const document = {
    format: TEXT_FORMAT,
    magic: "SSYN",
    headerTailHex: "00000000",
    module: {
      name: "Signed metadata",
      dataChunks: [
        {
          index: 3,
          base64: "",
          sampleRate: -1,
        },
      ],
    },
  };
  const projectDocument = {
    format: TEXT_FORMAT,
    magic: "SVOX",
    headerTailHex: "00000000",
    project: {},
    patterns: [
      {
        parent: -1,
        infoFlags: {
          clone: true,
        },
      },
    ],
    modules: [],
  };

  const buffer = buildContainer(document);
  const parsed = parseContainer(buffer);
  const projectBuffer = buildContainer(projectDocument);
  const parsedProject = parseContainer(projectBuffer);

  assert.equal(parsed.module.dataChunks[0].sampleRate, -1);
  assert.equal(parsedProject.patterns[0].parent, -1);
  assert.equal(sha256(buildContainer(parsed)), sha256(buffer));
  assert.equal(sha256(buildContainer(parsedProject)), sha256(projectBuffer));
});

test("preserves signed module MIDI output settings", () => {
  const document = {
    format: TEXT_FORMAT,
    magic: "SSYN",
    headerTailHex: "00000000",
    module: {
      name: "MIDI output",
      midi: {
        outputChannel: -1,
        outputBank: -1,
        outputProgram: -1,
      },
    },
  };

  const buffer = buildContainer(document);
  const parsed = parseContainer(buffer);

  assert.deepEqual(parsed.module.midi, {
    outputChannel: -1,
    outputBank: -1,
    outputProgram: -1,
  });
  assert.equal(sha256(buildContainer(parsed)), sha256(buffer));
});

test("decodes module MIDI input flag bitfields", () => {
  const document = {
    format: TEXT_FORMAT,
    magic: "SSYN",
    headerTailHex: "00000000",
    module: {
      name: "MIDI flags",
      midi: {
        inputFlags: {
          alwaysActive: "on",
          channel: "channel3",
          never: "on",
        },
      },
    },
  };

  const buffer = buildContainer(document);
  const parsed = parseContainer(buffer);

  assert.deepEqual(parsed.module.midi.inputFlags, {
    alwaysActive: "on",
    channel: "channel3",
    never: "on",
  });
  assert.equal(sha256(buildContainer(parsed)), sha256(buffer));
});

test("decodes module visualizer parameter bitfields", () => {
  const document = {
    format: TEXT_FORMAT,
    magic: "SSYN",
    headerTailHex: "00000000",
    module: {
      name: "Visualizer",
      visualizerParameters: {
        levelMode: "stereo",
        levelFlags: {
          vertical: true,
          peak: true,
        },
        oscilloscopeMode: "xy",
        oscilloscopeFlags: {
          sync: true,
        },
        oscilloscopeSizeMs: 24,
        backgroundTransparency: 2,
        shadowOpacity: 3,
        flags: {
          noBackgroundFill: true,
          levelRms: true,
        },
      },
    },
  };

  const buffer = buildContainer(document);
  const parsed = parseContainer(buffer);

  assert.deepEqual(parsed.module.visualizerParameters, document.module.visualizerParameters);
  assert.equal(sha256(buildContainer(parsed)), sha256(buffer));
});

test("parses synth into a structured module", async () => {
  const buffer = await readFile("instruments/mandel59 shepard.sunsynth");
  const document = parseContainer(buffer);

  assert.equal(document.magic, "SSYN");
  assert.equal(document.module.name, "Shepard tone");
  assert.equal(document.module.type, "MetaModule");
  assert.match(document.module.color ?? "", /^#[0-9a-f]{6}$/);
  assert.equal(document.module.chunks, undefined);
  assert.equal(document.module.dataChunks[0].name, "embeddedProject");
  assert.equal(document.module.dataChunks[0].container.magic, "SVOX");
  assert.equal(document.module.dataChunks[0].container.project.name, "Shepard tone");
  assert.deepEqual(document.module.midi, {
    inputFlags: {},
    outputChannel: "channel1",
    outputBank: -1,
    outputProgram: -1,
  });
  assert.equal(document.module.dataChunks.length, 3);
  assert.deepEqual(document.module.controllers, {
    volume: 160,
    inputModule: 3,
    playPatterns: "off",
    bpm: 125,
    tpl: 6,
  });
  assert.deepEqual(document.module.midiBindings?.[0], {
    type: "none",
    channel: 0,
    mode: "linear",
    parameter: 0,
    min: 0,
    max: 255,
  });
});

test("round-trips editable parsed documents", async () => {
  const buffer = await readFile("music/2022-04-18.sunvox");
  const document = parseContainer(buffer);
  const rebuilt = buildContainer(document);

  assert.equal(sha256(rebuilt), sha256(buffer));
});

test("round-trips structured documents without auxiliary properties", async () => {
  const files = [
    "music/2022-04-16.sunvox",
    "music/2022-04-17.sunvox",
    "music/2022-04-18.sunvox",
    "music/2022-04-20.sunvox",
    "instruments/mandel59 shepard.sunsynth",
    "instruments/mandel59 SuperSaw.sunsynth",
  ];

  for (const file of files) {
    const buffer = await readFile(file);
    const document = withoutAuxiliaryProperties(parseContainer(buffer));
    const rebuilt = buildContainer(document);

    assert.equal(sha256(rebuilt), sha256(buffer), file);
  }
});

test("decodes pattern note data", async () => {
  const buffer = await readFile("music/2022-04-17.sunvox");
  const document = parseContainer(buffer);
  const pattern = document.patterns.find((candidate) => candidate.events);
  const layout = SUNVOX_DB.structs.sunvox_note.textLayout;

  assert.ok(Array.isArray(pattern?.events));
  assert.ok(pattern.events.length > 0);
  assert.deepEqual(pattern.events[0], {
    line: 0,
    track: 0,
    note: "C4",
    module: 2,
    _moduleName: "DrumSynth",
    _moduleType: "DrumSynth",
  });
  assert.equal(layout.kind, "sparsePatternEvents");
  assert.equal(layout.columnsPath, "tracks");
  assert.equal(layout.rowsPath, "lines");
  assert.deepEqual(layout.positionFields, ["line", "track"]);
  assert.deepEqual(layout.tupleFields, ["note", "velocity", "module", "controller", "value"]);
  assert.equal(layout.fieldSemantics.note.encoding, "sunvoxNote");
  assert.equal(layout.fieldSemantics.module.reference, "modules");
  assert.equal(layout.fieldSemantics.controller.encoding, "packedPatternControllerEffect");
  assert.deepEqual(layout.fieldSemantics.value.aliases, ["parameter"]);
  assert.ok(pattern.events.length < pattern.tracks * pattern.lines);
  assert.equal(sha256(buildContainer(document)), sha256(buffer));
});

test("encodes named pattern controller events", async () => {
  const buffer = await readFile("music/2022-04-17.sunvox");
  const document = parseContainer(buffer);
  const moduleIndex = document.modules.findIndex((module) =>
    SUNVOX_DB.modules[module?.type]?.controllers?.some((controller) => controller.name === "volume"),
  );
  assert.ok(moduleIndex >= 0);
  const module = document.modules[moduleIndex];
  const controllerIndex = SUNVOX_DB.modules[module.type].controllers.find((controller) => controller.name === "volume").index;
  const patternIndex = document.patterns.findIndex((pattern) => pattern.tracks > 0 && pattern.lines > 1);
  assert.ok(patternIndex >= 0);
  const pattern = document.patterns[patternIndex];

  pattern.events.push({
    line: 1,
    track: 0,
    module: moduleIndex,
    controller: "volume",
    parameter: 321,
  });

  const reparsed = parseContainer(buildContainer(document));
  const event = reparsed.patterns[patternIndex].events.find((candidate) => candidate.line === 1 && candidate.track === 0);

  assert.equal(event.module, moduleIndex);
  assert.equal(event.controller, "volume");
  assert.equal(event._controllerIndex, controllerIndex);
  assert.equal(event.value, 321);
});

test("can still build editable chunk documents", async () => {
  const buffer = await readFile("music/2022-04-17.sunvox");
  const document = parseEditableContainer(buffer);
  const rebuilt = buildContainer(document);

  assert.equal(document.format, "sunvox-editable-text-v1");
  assert.equal(document.chunks[0].value, 33554437);
  assert.equal(sha256(rebuilt), sha256(buffer));
});

test("can still build verbose documents", async () => {
  const buffer = await readFile("music/2022-04-17.sunvox");
  const document = parseVerboseContainer(buffer);
  const rebuilt = buildContainer(document);

  assert.equal(document.format, "sunvox-container-text-v1");
  assert.equal(document.chunks[0]._decoded.kind, "uint32");
  assert.equal(sha256(rebuilt), sha256(buffer));
});

test("encode and decode files through JSON", async () => {
  const source = "instruments/mandel59 SuperSaw.sunsynth";
  const jsonPath = join("var", "test-supersaw.sunsynth.json");
  const roundtripPath = join("var", "test-supersaw.roundtrip.sunsynth");

  await encode(source, jsonPath);
  await decode(jsonPath, roundtripPath);

  const [original, rebuilt] = await Promise.all([readFile(source), readFile(roundtripPath)]);
  assert.equal(sha256(rebuilt), sha256(original));

  await rm(jsonPath, { force: true });
  await rm(roundtripPath, { force: true });
});

test("encodes named MetaModule controller and MIDI binding values", async () => {
  const buffer = await readFile("instruments/mandel59 shepard.sunsynth");
  const document = parseContainer(buffer);

  document.module.controllers.volume = 200;
  document.module.controllers.playPatterns = "repeat";
  document.module.midiBindings[0] = {
    type: "controlChange",
    channel: 2,
    mode: "linear",
    parameter: 74,
    min: 0,
    max: 200,
  };

  const rebuilt = buildContainer(document);
  const reparsed = parseContainer(rebuilt);

  assert.equal(reparsed.module.controllers.volume, 200);
  assert.equal(reparsed.module.controllers.playPatterns, "repeat");
  assert.deepEqual(reparsed.module.midiBindings[0], {
    type: "controlChange",
    channel: 2,
    mode: "linear",
    parameter: 74,
    min: 0,
    max: 200,
  });
});

test("decodes MetaModule controller link and option data chunks", async () => {
  const buffer = await readFile("instruments/mandel59 SuperSaw.sunsynth");
  const document = parseContainer(buffer);
  const links = document.module.dataChunks.find((chunk) => chunk.name === "controllerLinks");
  const options = document.module.dataChunks.find((chunk) => chunk.name === "options");
  const firstName = document.module.dataChunks.find((chunk) => chunk.name === "userControllerName");

  assert.deepEqual(links.links[0], {
    index: 0,
    module: 16,
    controller: 0,
    _moduleName: "Detune 1",
    _moduleType: "MultiCtl",
    _controllerName: "value",
    _controllerLabel: "Value",
  });
  assert.equal(options.options.userControllers, 9);
  assert.equal(options.options.eventOutput, true);
  assert.deepEqual(firstName, {
    index: 8,
    name: "userControllerName",
    controller: 0,
    group: 2,
    label: "Detune 1",
  });
});

test("decodes and encodes MetaModule user controller values", async () => {
  const buffer = await readFile("instruments/mandel59 SuperSaw.sunsynth");
  const document = parseContainer(buffer);

  assert.equal(document.module.controllers.user[0].value, 8192);
  assert.equal(document.module.controllers.user[0]._label, "Detune 1");
  assert.deepEqual(document.module.controllers.user[0]._link, {
    module: 16,
    controller: 0,
    _moduleName: "Detune 1",
    _moduleType: "MultiCtl",
    _controllerName: "value",
    _controllerLabel: "Value",
  });

  document.module.controllers.user[0].value = 4096;
  const reparsed = parseContainer(buildContainer(document));

  assert.equal(reparsed.module.controllers.user[0].value, 4096);
  assert.equal(reparsed.module.controllers.user[0]._label, "Detune 1");
});

test("decodes MultiCtl controllers, output slots, and curve", async () => {
  const buffer = await readFile("music/2022-04-17.sunvox");
  const document = parseContainer(buffer);
  const multiCtl = document.modules.find((module) => module.type === "MultiCtl");
  const slots = multiCtl.dataChunks.find((chunk) => chunk.name === "outputSlots");
  const curve = multiCtl.dataChunks.find((chunk) => chunk.name === "curve");

  assert.equal(multiCtl.controllers.value, 958);
  assert.deepEqual(slots.slots, [
    { index: 0, controller: 1 },
    { index: 1, max: 20000, controller: 1 },
  ]);
  assert.equal(curve.values.length, 257);
  assert.deepEqual(curve.values.slice(0, 4), [0, 128, 256, 384]);
});

test("decodes MultiSynth controllers", async () => {
  const buffer = await readFile("instruments/mandel59 shepard.sunsynth");
  const document = parseContainer(buffer);
  const embedded = document.module.dataChunks[0].container;
  const multiSynth = embedded.modules.find((module) => module.type === "MultiSynth");
  const options = multiSynth.dataChunks.find((chunk) => chunk.name === "options");

  assert.deepEqual(multiSynth.controllers, {
    transpose: 128,
    randomPitch: 0,
    velocity: 256,
    finetune: 256,
    randomPhase: 0,
    randomVelocity: 0,
    phase: 0,
    curve2Influence: 256,
  });
  assert.deepEqual(options.options, {
    staticNoteC5: false,
    ignoreVelocity0: false,
    selectedCurve: "velocityByPitch",
    trigger: false,
    generateMissedNoteOff: "off",
    roundPitch: "off",
    roundPitch2: "off",
    recordPitchCurve: "off",
    noteDifference: "off",
    outputSlotMode: "off",
  });
});

test("decodes common effect and generator controllers", async () => {
  const buffer = await readFile("music/2022-04-17.sunvox");
  const document = parseContainer(buffer);
  const compressor = document.modules.find((module) => module.type === "Compressor");
  const drumSynth = document.modules.find((module) => module.type === "DrumSynth");
  const amplifier = document.modules.find((module) => module.type === "Amplifier");
  const reverb = document.modules.find((module) => module.type === "Reverb");

  assert.equal(compressor.controllers.mode, "peak");
  assert.equal(compressor.controllers.sideChainInput, 1);
  assert.equal(drumSynth.controllers.bassVolume, 200);
  assert.equal(amplifier.controllers.inverse, "off");
  assert.equal(amplifier.controllers.fineVolume, 32768);
  assert.equal(reverb.controllers.mode, "hq");
  assert.equal(reverb.controllers.allpassFilter, "on");
});

test("decodes Analog generator and Filter Pro controllers", async () => {
  const buffer = await readFile("instruments/mandel59 shepard.sunsynth");
  const document = parseContainer(buffer);
  const embedded = document.module.dataChunks[0].container;
  const generator = embedded.modules.find((module) => module.type === "Analog generator");
  const options = generator.dataChunks.find((chunk) => chunk.name === "options");
  const filter = embedded.modules.find((module) => module.type === "Filter Pro");

  assert.equal(generator.controllers.waveform, "sin");
  assert.equal(generator.controllers.sustain, "on");
  assert.equal(generator.controllers.filter, "off");
  assert.equal(generator.controllers.osc2Mode, "add");
  assert.equal(options.dataSize, 14);
  assert.equal(options.options.smoothFreqChange, true);
  assert.equal(options.options.alwaysPlayOsc2, false);
  assert.equal(filter.controllers.type, "bpConstSkirtGain");
  assert.equal(filter.controllers.rolloff, "db12");
  assert.equal(filter.controllers.mode, "stereo");
  assert.equal(filter.controllers.lfoFreqUnit, "hz002");
});

test("decodes Analog generator waveform and option data chunks", async () => {
  const buffer = await readFile("music/2022-04-16.sunvox");
  const document = parseContainer(buffer);
  const analogGenerators = [];

  function walk(container) {
    for (const module of container.modules ?? []) {
      if (module.type === "Analog generator") {
        analogGenerators.push(module);
      }
      for (const chunk of module.dataChunks ?? []) {
        if (chunk.container) {
          walk(chunk.container);
        }
      }
    }
  }

  walk(document);

  const drawn = analogGenerators
    .flatMap((module) => module.dataChunks ?? [])
    .find((chunk) => chunk.name === "drawnWaveform");
  const randomPhase = analogGenerators
    .flatMap((module) => module.dataChunks ?? [])
    .find((chunk) => chunk.options?.randomPhase);
  const trueZeroOnly = analogGenerators
    .flatMap((module) => module.dataChunks ?? [])
    .find((chunk) => chunk.options?.trueZeroAttackRelease && !chunk.options?.increasedFreqAccuracy);

  assert.equal(drawn.count, 32);
  assert.deepEqual(drawn.values.slice(0, 8), [127, 127, 127, 127, 127, 127, 127, 127]);
  assert.deepEqual(drawn.values.slice(-4), [127, 127, 127, 127]);
  assert.equal(randomPhase.options.randomPhase, true);
  assert.equal(randomPhase.options.increasedFreqAccuracy, true);
  assert.equal(randomPhase.options.alwaysPlayOsc2, false);
  assert.equal(trueZeroOnly.dataSize, 14);
});

test("decodes utility and delay-style effect controllers", async () => {
  const buffer = await readFile("music/2022-04-18.sunvox");
  const document = parseContainer(buffer);
  const dcBlocker = document.modules.find((module) => module.type === "DC Blocker");
  const metaModule = document.modules.find((module) => module.name === "Vox NOT-09");
  const embedded = metaModule.dataChunks[0].container;
  const glide = embedded.modules.find((module) => module.type === "Glide");
  const modulator = embedded.modules.find((module) => module.type === "Modulator");
  const delay = embedded.modules.find((module) => module.type === "Delay");
  const echo = embedded.modules.find((module) => module.type === "Echo");
  const waveShaper = embedded.modules.find((module) => module.type === "WaveShaper");

  assert.equal(dcBlocker.controllers.channels, "stereo");
  assert.equal(glide.controllers.polyphony, "on");
  assert.equal(glide.controllers.resetOnFirstNote, "off");
  assert.equal(modulator.controllers.modulationType, "phase");
  assert.equal(modulator.controllers.channels, "mono");
  assert.equal(delay.controllers.channels, "mono");
  assert.equal(delay.controllers.delayUnit, "ms");
  assert.equal(echo.controllers.delayUnit, "ms");
  assert.equal(echo.controllers.filter, "off");
  assert.equal(waveShaper.controllers.symmetric, "on");
  assert.equal(waveShaper.controllers.dcBlocker, "on");
  assert.equal(waveShaper.dataChunks[0].name, "curve");
  assert.equal(waveShaper.dataChunks[0].values.length, 256);
  assert.deepEqual(waveShaper.dataChunks[0].values.slice(0, 4), [0, 1, 4, 9]);
});

test("decodes Pitch shifter controllers", async () => {
  const buffer = await readFile("music/2022-04-16.sunvox");
  const document = parseContainer(buffer);
  const pitchShifters = [];

  function walk(container) {
    for (const module of container.modules ?? []) {
      if (module.type === "Pitch shifter") {
        pitchShifters.push(module);
      }
      for (const chunk of module.dataChunks ?? []) {
        if (chunk.container) {
          walk(chunk.container);
        }
      }
    }
  }

  walk(document);

  assert.equal(pitchShifters.length, 26);
  assert.deepEqual(pitchShifters[0].controllers, {
    volume: 256,
    pitch: 599,
    pitchScale: 35,
    feedback: 0,
    grainSize: 10,
    mode: "hq",
    bypassIfPitch0: "off",
  });
});

test("decodes Distortion controllers", async () => {
  const buffer = await readFile("music/2022-04-16.sunvox");
  const document = parseContainer(buffer);
  const distortions = [];

  function walk(container) {
    for (const module of container.modules ?? []) {
      if (module.type === "Distortion") {
        distortions.push(module);
      }
      for (const chunk of module.dataChunks ?? []) {
        if (chunk.container) {
          walk(chunk.container);
        }
      }
    }
  }

  walk(document);

  assert.equal(distortions.length, 6);
  assert.deepEqual(distortions[1].controllers, {
    volume: 64,
    type: "foldback",
    power: 226,
    bitDepth: 16,
    freq: 44100,
    noise: 0,
  });
});

test("decodes EQ and Velocity2Ctl controllers", async () => {
  const buffer = await readFile("music/2022-04-16.sunvox");
  const document = parseContainer(buffer);
  const eqs = [];
  const velocity2Ctls = [];

  function walk(container) {
    for (const module of container.modules ?? []) {
      if (module.type === "EQ") {
        eqs.push(module);
      } else if (module.type === "Velocity2Ctl") {
        velocity2Ctls.push(module);
      }
      for (const chunk of module.dataChunks ?? []) {
        if (chunk.container) {
          walk(chunk.container);
        }
      }
    }
  }

  walk(document);

  assert.equal(eqs.length, 1);
  assert.equal(velocity2Ctls.length, 2);
  assert.deepEqual(eqs[0].controllers, {
    low: 256,
    middle: 142,
    high: 256,
    channels: "stereo",
  });
  assert.deepEqual(velocity2Ctls[0].controllers, {
    onNoteOff: "doNothing",
    outMin: 10920,
    outMax: 32768,
    outOffset: 16384,
    outController: 1,
  });
  assert.deepEqual(velocity2Ctls[1].controllers, {
    onNoteOff: "doNothing",
    outMin: 1728,
    outMax: 5016,
    outOffset: 16384,
    outController: 2,
  });
});

test("decodes Flanger and Vibrato controllers", async () => {
  const buffer = await readFile("music/2022-04-16.sunvox");
  const document = parseContainer(buffer);
  const flangers = [];
  const vibratos = [];

  function walk(container) {
    for (const module of container.modules ?? []) {
      if (module.type === "Flanger") {
        flangers.push(module);
      } else if (module.type === "Vibrato") {
        vibratos.push(module);
      }
      for (const chunk of module.dataChunks ?? []) {
        if (chunk.container) {
          walk(chunk.container);
        }
      }
    }
  }

  walk(document);

  assert.equal(flangers.length, 1);
  assert.equal(vibratos.length, 6);
  assert.deepEqual(flangers[0].controllers, {
    dry: 256,
    wet: 128,
    feedback: 128,
    delay: 200,
    response: 10,
    lfoFreq: 8,
    lfoAmp: 256,
    lfoWaveform: "hsin",
    setLfoPhase: 0,
    lfoFreqUnit: "hz005",
  });
  assert.deepEqual(vibratos[0].controllers, {
    volume: 256,
    amplitude: 4,
    freq: 396,
    channels: "mono",
    setPhase: 0,
    frequencyUnit: "hz64",
    exponentialAmplitude: "off",
  });
});

test("decodes Generator and Filter controllers", async () => {
  const buffer = await readFile("music/2022-04-16.sunvox");
  const document = parseContainer(buffer);
  const generators = [];
  const filters = [];

  function walk(container) {
    for (const module of container.modules ?? []) {
      if (module.type === "Generator") {
        generators.push(module);
      } else if (module.type === "Filter") {
        filters.push(module);
      }
      for (const chunk of module.dataChunks ?? []) {
        if (chunk.container) {
          walk(chunk.container);
        }
      }
    }
  }

  walk(document);

  assert.equal(generators.length, 6);
  assert.equal(filters.length, 4);
  assert.equal(generators[0].dataChunks[0].name, "drawnWaveform");
  assert.equal(generators[0].dataChunks[0].count, 32);
  assert.deepEqual(generators[0].dataChunks[0].values.slice(0, 8), [-127, -100, -81, -66, -19, 18, 31, 50]);
  assert.deepEqual(generators[0].dataChunks[0].values.slice(-4), [-114, -79, -53, -44]);
  assert.deepEqual(generators[0].controllers, {
    volume: 128,
    waveform: "saw",
    panning: 44,
    attack: 34,
    release: 40,
    polyphony: 16,
    mode: "stereo",
    sustain: "on",
    freqModulationByInput: 0,
    dutyCycle: 511,
  });
  assert.deepEqual(filters[0].controllers, {
    volume: 256,
    freq: 793,
    resonance: 1325,
    type: "lp",
    response: 11,
    mode: "hqMono",
    impulse: 0,
    mix: 256,
    lfoFreq: 0,
    lfoAmp: 0,
    setLfoPhase: 0,
    exponentialFreq: "off",
    rolloff: "db12",
    lfoFreqUnit: "hz002",
    lfoWaveform: "sin",
  });
});

test("decodes LFO controllers", async () => {
  const buffer = await readFile("music/2022-04-16.sunvox");
  const document = parseContainer(buffer);
  const lfos = [];

  function walk(container) {
    for (const module of container.modules ?? []) {
      if (module.type === "LFO") {
        lfos.push(module);
      }
      for (const chunk of module.dataChunks ?? []) {
        if (chunk.container) {
          walk(chunk.container);
        }
      }
    }
  }

  walk(document);

  assert.equal(lfos.length, 6);
  assert.deepEqual(lfos[0].controllers, {
    volume: 256,
    type: "amplitude",
    amplitude: 16,
    freq: 16384,
    waveform: "random",
    setPhase: 0,
    channels: "stereo",
    frequencyUnit: "hz",
    dutyCycle: 128,
    generator: "off",
    freqScale: 100,
    smoothTransitions: "off",
    sineQuality: "auto",
  });
  assert.deepEqual(lfos[3].controllers, {
    volume: 256,
    type: "amplitude",
    amplitude: 256,
    freq: 65,
    waveform: "randomInterpolated",
    setPhase: 0,
    channels: "stereo",
    frequencyUnit: "hz64",
    dutyCycle: 128,
    generator: "on",
    freqScale: 100,
    smoothTransitions: "waveform",
    sineQuality: "auto",
  });
});

test("decodes FM controllers", async () => {
  const buffer = await readFile("music/2022-04-16.sunvox");
  const document = parseContainer(buffer);
  const fms = [];

  function walk(container) {
    for (const module of container.modules ?? []) {
      if (module.type === "FM") {
        fms.push(module);
      }
      for (const chunk of module.dataChunks ?? []) {
        if (chunk.container) {
          walk(chunk.container);
        }
      }
    }
  }

  walk(document);

  assert.equal(fms.length, 17);
  assert.deepEqual(fms[0].controllers, {
    cVolume: 32,
    mVolume: 0,
    panning: 128,
    cFreqRatio: 8,
    mFreqRatio: 12,
    mSelfModulation: 7,
    cAttack: 0,
    cDecay: 64,
    cSustain: 0,
    cRelease: 64,
    mAttack: 0,
    mDecay: 0,
    mSustain: 101,
    mRelease: 64,
    mScalingPerKey: 4,
    polyphony: 16,
    mode: "hq",
  });
});

test("decodes SpectraVoice controllers while preserving spectrum chunks", async () => {
  const buffer = await readFile("music/2022-04-16.sunvox");
  const document = parseContainer(buffer);
  const spectraVoices = [];

  function walk(container) {
    for (const module of container.modules ?? []) {
      if (module.type === "SpectraVoice") {
        spectraVoices.push(module);
      }
      for (const chunk of module.dataChunks ?? []) {
        if (chunk.container) {
          walk(chunk.container);
        }
      }
    }
  }

  walk(document);

  assert.equal(spectraVoices.length, 1);
  assert.deepEqual(spectraVoices[0].controllers, {
    volume: 117,
    panning: 128,
    attack: 72,
    release: 34,
    polyphony: 8,
    mode: "hqSpline",
    sustain: "on",
    spectrumResolution: 1,
    harmonic: 2,
    hFreq: 3309,
    hVolume: 78,
    hWidth: 11,
    hType: "hsin",
  });
  assert.deepEqual(
    spectraVoices[0].dataChunks.map((chunk) => chunk.index),
    [0, 1, 2, 3],
  );
  assert.deepEqual(
    spectraVoices[0].dataChunks.map((chunk) => chunk.name),
    ["harmonicFrequencies", "harmonicVolumes", "harmonicWidths", "harmonicTypes"],
  );
  assert.deepEqual(spectraVoices[0].dataChunks[0].values.slice(0, 4), [1098, 2158, 3309, 0]);
  assert.deepEqual(spectraVoices[0].dataChunks[1].values.slice(0, 4), [255, 108, 78, 0]);
  assert.deepEqual(spectraVoices[0].dataChunks[2].values.slice(0, 4), [3, 0, 11, 0]);
  assert.deepEqual(spectraVoices[0].dataChunks[3].values.slice(0, 4), [13, 0, 0, 0]);
});

test("decodes FMX controllers as operator structures", async () => {
  const buffer = await readFile("music/2022-04-18.sunvox");
  const document = parseContainer(buffer);
  const fmx = document.modules.find((module) => module.type === "FMX");

  assert.equal(fmx.controllers.sampleRate, "native");
  assert.equal(fmx.controllers.channels, "stereo");
  assert.equal(fmx.controllers.inputToCustomWave, "off");
  assert.equal(fmx.controllers.adsrSmoothTransitions, "restartVolumeChange");
  assert.equal(fmx.controllers.operators.length, 5);
  assert.equal(fmx.controllers.operators[0].attackCurve, "negExp1");
  assert.equal(fmx.controllers.operators[0].waveform, "sin");
  assert.equal(fmx.controllers.operators[0].modulationType, "phase");
  assert.equal(fmx.controllers.operators[4].noise, 267);
  assert.equal(fmx.controllers.operators[4].outputMode, undefined);
  assert.equal(fmx.controllers.envelopeGain, 1000);
});

test("decodes Sound2Ctl controllers and options", async () => {
  const buffer = await readFile("music/2022-04-17.sunvox");
  const document = parseContainer(buffer);
  const sound2Ctl = document.modules.find((module) => module.type === "Sound2Ctl");

  assert.equal(sound2Ctl.controllers.channels, "mono");
  assert.equal(sound2Ctl.controllers.absolute, "off");
  assert.equal(sound2Ctl.controllers.mode, "hq");
  assert.deepEqual(sound2Ctl.dataChunks[0], {
    index: 0,
    name: "options",
    options: {
      recordValues: false,
      sendChangesOnly: true,
    },
  });
});

test("decodes Sampler instrument samples and envelopes", () => {
  const signature = Buffer.from("SAMP", "latin1").readUInt32LE(0);
  const sampleBytes = Buffer.alloc(8);
  sampleBytes.writeInt16LE(0, 0);
  sampleBytes.writeInt16LE(1200, 2);
  sampleBytes.writeInt16LE(-1200, 4);
  sampleBytes.writeInt16LE(0, 6);

  const document = {
    format: TEXT_FORMAT,
    magic: "SSYN",
    headerTailHex: "00000000",
    module: {
      name: "Synthetic Sampler",
      type: "Sampler",
      dataChunkCount: 5,
      dataChunks: [
        {
          index: 0,
          instrument: {
            name: "Synthetic",
            samples: 1,
            signature,
            version: 6,
            maxVersion: 6,
          },
        },
        {
          index: 1,
          sample: {
            length: 4,
            loopStart: 1,
            loopLength: 2,
            volume: 64,
            finetune: -3,
            type: {
              loop: "on",
              loopRelease: "off",
              reserved3: 0,
              stereo: "off",
              reserved7: 0,
            },
            panning: 128,
            relativeNote: 0,
            reserved2: 0,
            name: "Wave",
            startPosition: 0,
          },
        },
        {
          index: 2,
          bytesBase64: sampleBytes.toString("base64"),
          flags: {
            format: "int16",
            channelsMinusOne: 0,
            dontSave: "off",
            reserved6: 0,
          },
          sampleRate: 44100,
        },
        {
          index: 257,
          options: {
            recordOnPlay: true,
            recordMono: false,
            recordReducedFreq: false,
            record16Bit: true,
            finishRecordingOnStop: false,
            ignoreVelocityForVolume: true,
            frequencyAccuracy: true,
            fitToPattern: 2,
          },
        },
        {
          index: 258,
          envelope: {
            flags: {
              enabled: true,
              sustain: true,
            },
            effectController: 0,
            gain: 100,
            velocityInfluence: 0,
            pointCount: 2,
            sustain: 1,
            loopStart: 0,
            loopEnd: 1,
            points: [
              { x: 0, value: 32768 },
              { x: 16, value: 0 },
            ],
          },
        },
      ],
    },
  };

  const buffer = buildContainer(document);
  const parsed = parseContainer(buffer);

  const instrument = parsed.module.dataChunks.find((chunk) => chunk.name === "instrument");
  const sample = parsed.module.dataChunks.find((chunk) => chunk.name === "sample");
  const sampleData = parsed.module.dataChunks.find((chunk) => chunk.name === "sampleData");
  const envelope = parsed.module.dataChunks.find((chunk) => chunk.name === "envelope");

  assert.equal(instrument.instrument.name, "Synthetic");
  assert.equal(instrument.instrument.samples, 1);
  assert.equal(sample.slot, 0);
  assert.equal(sample.sample.name, "Wave");
  assert.equal(sample.sample.finetune, -3);
  assert.equal(sample.sample.type.loop, "on");
  assert.equal(sampleData.slot, 0);
  assert.equal(sampleData.byteLength, 8);
  assert.equal(sampleData.bytesBase64, sampleBytes.toString("base64"));
  assert.deepEqual(sampleData.flags, {
    format: "int16",
    channelsMinusOne: 0,
    dontSave: "off",
    reserved6: 0,
  });
  assert.equal(sampleData.sampleRate, 44100);
  assert.equal(envelope.envelopeType, "volume");
  assert.deepEqual(envelope.envelope.flags, {
    enabled: true,
    sustain: true,
  });
  assert.deepEqual(envelope.envelope.points, [
    { x: 0, value: 32768 },
    { x: 16, value: 0 },
  ]);
  assert.equal(sha256(buildContainer(parsed)), sha256(buffer));
});

test("decodes primitive chunk payloads", () => {
  const intData = Buffer.alloc(4);
  intData.writeInt32LE(-12);
  assert.deepEqual(decodeChunkData("SXXX", intData), {
    _description: "module x position",
    kind: "int32",
    value: -12,
  });

  assert.deepEqual(decodeChunkData("SCOL", Buffer.from([1, 2, 3])), {
    _description: "module color",
    kind: "rgb",
    value: { r: 1, g: 2, b: 3, hex: "#010203" },
  });
});

test("decodes structured flags as named bitflags", async () => {
  const buffer = await readFile("music/2022-04-17.sunvox");
  const document = parseContainer(buffer);
  const multiCtl = document.modules.find((module) => module.type === "MultiCtl");

  assert.deepEqual(document.project.flags, {});
  assert.deepEqual(document.patterns[0].flags, {});
  assert.equal(multiCtl.flags.exists, true);
  assert.equal(multiCtl.flags.effect, true);
  assert.equal(multiCtl.flags.noScopeBuffer, true);
  assert.equal(multiCtl.flags.outputIsEmpty, true);
  assert.equal(multiCtl.flags.output, undefined);
});

// @ts-check
// Genre-neutral building blocks missing from the distributed set (#93):
// a clean sub bass, a snare and hi-hat to pair with Scratch Kick Snap, and a
// slow string ensemble for chords and swells. Pure synthesis, no samples.

/** @param {number} x @param {number} y */
const at = (x, y) => ({ x, y, z: 0 });

// MultiCtl output slot controller numbers are 1-based; slot min/max are
// normalized to 0..32768 of the destination range.
const ANALOG_RELEASE = 5;
// FMX controllers are grouped by parameter (all five volumes, then all
// attacks, ...), so operator 1 attack is controller 15, not 11.
const FMX_OP1_ATTACK = 15;
// FMX outputMode bit 0 sends an operator to the main output.
const FMX_TO_OUT = 1;
const BOW_ATTACK_MS = 140;
// Analog generator release is steeply non-linear: 120 ≈ 30 ms, 180 ≈ 100 ms,
// 215 ≈ 400 ms, 256 never decays.
const HAT_CLOSED_RELEASE = 178;
const HAT_RELEASE_RANGE = [150, 235];

/** Full FMX operator spec. velocitySensitivity 128 is neutral; lower values invert it (0 = silent at full velocity). @param {Record<string, string | number>} overrides */
const fmxOp = (overrides) => ({
  volume: 0,
  attack: 0,
  decay: 100,
  sustainLevel: 0,
  release: 100,
  attackCurve: "linear",
  decayCurve: "exp1",
  releaseCurve: "exp1",
  sustain: "off",
  sustainPedal: "off",
  envScaling: 128,
  volumeScaling: 128,
  velocitySensitivity: 192,
  waveform: "sin",
  noise: 0,
  phase: 0,
  freqMul: 1000,
  constPitch: 8192,
  selfMod: 0,
  feedback: 0,
  modulationType: "phase",
  outputMode: 0,
  ...overrides,
});
/** @param {number} value @param {number} max */
const norm = (value, max) => Math.round((value / max) * 32768);
/** Macro value that maps to `value` inside min..max. @param {number} value @param {number} min @param {number} max */
const macroValue = (value, min, max) => Math.round(((value - min) / (max - min)) * 32768);
/** @param {number} count @param {number} controller @param {number} min @param {number} max @param {number} rangeMax */
const fanOut = (count, controller, min, max, rangeMax) => [
  {
    index: 0,
    name: "outputSlots",
    slots: Array.from({ length: count }, (_, index) => ({
      index,
      controller,
      min: norm(min, rangeMax),
      max: norm(max, rangeMax),
    })),
  },
];

/** @satisfies {import("../../../tools/sunvox-edit-recipe.d.ts").SunVoxEditRecipe} */
const recipe = {
  schemaVersion: 1,
  outputs: {
    scratchSubBass: {
      kind: "sunsynth",
      file: "var/synth-lab/Scratch Sub Bass.sunsynth",
      create: {
        module: "MetaModule",
        name: "Scratch Sub Bass",
        volume: 128,
        bpm: 120,
        tpl: 6,
        color: "#4f7dff",
      },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput({ name: "Output", position: at(1120, 512) });
        const noteInput = project.addModule("MultiSynth", { name: "Input", position: at(0, 512) });
        synth.setInputModule(noteInput);
        // Sine fundamental carries the weight; a quiet triangle an octave up
        // keeps the line audible on small speakers.
        const sub = project.addModule("Analog generator", {
          name: "Sub Sine",
          color: "#5a8cff",
          position: at(224, 432),
          controllers: {
            waveform: "sin",
            volume: 150,
            attack: 1,
            release: 100,
            sustain: "on",
            expEnvelope: "on",
            osc2Pitch: 1000,
            osc2Volume: 0,
            polyphony: 2,
            mode: "hqMono",
          },
        });
        const overtone = project.addModule("Analog generator", {
          name: "Overtone",
          color: "#7aa2ff",
          relativeNote: 12,
          position: at(224, 592),
          controllers: {
            waveform: "triangle",
            volume: 40,
            attack: 1,
            release: 100,
            sustain: "on",
            expEnvelope: "on",
            osc2Pitch: 1000,
            osc2Volume: 0,
            polyphony: 2,
            mode: "hqMono",
          },
        });
        const warmth = project.addModule("Distortion", {
          name: "Warmth",
          position: at(448, 512),
          controllers: { volume: 150, type: "saturation4", power: 30, bitDepth: 16, freq: 44100 },
        });
        const tone = project.addModule("Filter Pro", {
          name: "Tone",
          position: at(640, 512),
          controllers: { type: "lp", freq: 1100, q: 16384, rolloff: "db24", mode: "monoSmoothing", response: 150 },
        });
        const glue = project.addModule("Compressor", {
          name: "Glue",
          position: at(864, 512),
          controllers: { volume: 256, threshold: 230, slope: 70, attack: 4, release: 120, mode: "peak" },
        });
        project.connect(noteInput, sub);
        project.connect(noteInput, overtone);
        project.connect(sub, warmth, { slot: 0 });
        project.connect(overtone, warmth, { slot: 1 });
        project.connect(warmth, tone);
        project.connect(tone, glue);
        project.connect(glue, project.output);
        synth.expose("Overtone", overtone, "volume");
        synth.expose("Drive", warmth, "power");
        synth.expose("Tone", tone, "freq");
        synth.expose("Release", sub, "release");
        synth.expose("Output trim", glue, "volume");
      },
    },
    scratchSnare: {
      kind: "sunsynth",
      file: "var/synth-lab/Scratch Snare.sunsynth",
      create: {
        module: "MetaModule",
        name: "Scratch Snare",
        volume: 130,
        bpm: 120,
        tpl: 6,
        color: "#ff9a4a",
      },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput({ name: "Output", position: at(1344, 512) });
        const noteInput = project.addModule("MultiSynth", { name: "Input", position: at(0, 512) });
        synth.setInputModule(noteInput);
        // Shell: a short pitch-dropping body. Kicker follows the played note,
        // so the drum can be retuned from the pattern.
        const shell = project.addModule("Kicker", {
          name: "Shell",
          color: "#ffb15e",
          relativeNote: -10,
          position: at(224, 400),
          controllers: {
            volume: 140,
            waveform: "triangle",
            attack: 0,
            release: 22,
            boost: 120,
            acceleration: 90,
            polyphony: 4,
            noClick: "on",
          },
        });
        // Wires: band-limited noise with its own decaying filter envelope.
        const wires = project.addModule("Analog generator", {
          name: "Wires",
          color: "#ffd08a",
          position: at(224, 624),
          controllers: {
            waveform: "whiteNoise",
            volume: 150,
            attack: 0,
            release: 190,
            sustain: "off",
            expEnvelope: "on",
            osc2Volume: 0,
            filter: "hp12db",
            filterFreq: 1600,
            filterResonance: 180,
            filterExpFreq: "on",
            polyphony: 4,
            mode: "hq",
          },
        });
        const crack = project.addModule("Filter Pro", {
          name: "Crack",
          position: at(480, 512),
          controllers: {
            type: "peaking",
            freq: 4200,
            q: 6000,
            gain: 21000,
            rolloff: "db12",
            mode: "stereo",
            response: 250,
          },
        });
        const room = project.addModule("Reverb", {
          name: "Room",
          position: at(704, 512),
          controllers: {
            dry: 256,
            wet: 44,
            feedback: 150,
            damp: 150,
            stereoWidth: 200,
            mode: "hq",
            allpassFilter: "improved",
            roomSize: 10,
          },
        });
        const snap = project.addModule("Compressor", {
          name: "Snap",
          position: at(928, 512),
          controllers: { volume: 256, threshold: 220, slope: 75, attack: 2, release: 90, mode: "peak" },
        });
        project.connect(noteInput, shell);
        project.connect(noteInput, wires);
        project.connect(shell, crack, { slot: 0 });
        project.connect(wires, crack, { slot: 1 });
        project.connect(crack, room);
        project.connect(room, snap);
        project.connect(snap, project.output);
        synth.expose("Body", shell, "volume");
        synth.expose("Wires", wires, "volume");
        synth.expose("Wire length", wires, "release");
        synth.expose("Crack", crack, "gain");
        synth.expose("Room wet", room, "wet");
        synth.expose("Output trim", snap, "volume");
      },
    },
    scratchHiHat: {
      kind: "sunsynth",
      file: "var/synth-lab/Scratch Hi-Hat.sunsynth",
      create: {
        module: "MetaModule",
        name: "Scratch Hi-Hat",
        volume: 150,
        bpm: 120,
        tpl: 6,
        color: "#ffe96a",
      },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput({ name: "Output", position: at(1120, 512) });
        const noteInput = project.addModule("MultiSynth", { name: "Input", position: at(0, 512) });
        synth.setInputModule(noteInput);
        // Two ring-modulated square pairs at inharmonic intervals give the
        // metallic cluster; a noise layer adds air. "Decay" switches between
        // closed (default) and open hats.
        const metalSpec = (/** @type {string} */ name, /** @type {number} */ y, /** @type {number} */ osc2Pitch, /** @type {number} */ relativeNote, /** @type {number} */ panning) => ({
          name,
          color: "#fff28a",
          relativeNote,
          position: at(224, y),
          controllers: {
            waveform: "square",
            volume: 110,
            panning,
            attack: 0,
            release: HAT_CLOSED_RELEASE,
            sustain: "off",
            expEnvelope: "on",
            osc2Pitch,
            osc2Volume: 32768,
            osc2Mode: "mul",
            polyphony: 4,
            mode: "hq",
          },
        });
        const metalA = project.addModule("Analog generator", metalSpec("Metal A", 352, 1471, 36, 112));
        const metalB = project.addModule("Analog generator", metalSpec("Metal B", 512, 1286, 43, 144));
        const air = project.addModule("Analog generator", {
          name: "Air",
          color: "#fffbd0",
          position: at(224, 672),
          controllers: {
            waveform: "whiteNoise",
            volume: 72,
            attack: 0,
            release: HAT_CLOSED_RELEASE,
            sustain: "off",
            expEnvelope: "on",
            osc2Volume: 0,
            polyphony: 4,
            mode: "hq",
          },
        });
        // Decay 0..32768 maps every layer's release to 150..235; the default
        // is a closed hat, around 75% opens it.
        const decay = project.addModule("MultiCtl", {
          name: "Decay",
          position: at(0, 352),
          controllers: { value: macroValue(HAT_CLOSED_RELEASE, ...HAT_RELEASE_RANGE), response: 1000 },
          dataChunks: fanOut(3, ANALOG_RELEASE, ...HAT_RELEASE_RANGE, 256),
        });
        const highpass = project.addModule("Filter Pro", {
          name: "Highpass",
          position: at(448, 512),
          controllers: { type: "hp", freq: 5200, q: 16384, rolloff: "db12", mode: "stereo", response: 250 },
        });
        const sheen = project.addModule("Filter Pro", {
          name: "Sheen",
          position: at(640, 512),
          controllers: {
            type: "highShelf",
            freq: 11000,
            q: 8000,
            gain: 20000,
            rolloff: "db12",
            mode: "stereo",
            response: 250,
          },
        });
        const trim = project.addModule("Amplifier", {
          name: "Trim",
          position: at(864, 512),
          controllers: { volume: 256, stereoWidth: 160, fineVolume: 32768, dcOffset: 128, balance: 128 },
        });
        project.connect(noteInput, metalA);
        project.connect(noteInput, metalB);
        project.connect(noteInput, air);
        project.connect(decay, metalA);
        project.connect(decay, metalB);
        project.connect(decay, air);
        project.connect(metalA, highpass, { slot: 0 });
        project.connect(metalB, highpass, { slot: 1 });
        project.connect(air, highpass, { slot: 2 });
        project.connect(highpass, sheen);
        project.connect(sheen, trim);
        project.connect(trim, project.output);
        synth.expose("Decay", decay, "value");
        synth.expose("Metal", metalA, "volume");
        synth.expose("Air", air, "volume");
        synth.expose("Tone", highpass, "freq");
        synth.expose("Output trim", trim, "volume");
      },
    },
    scratchStringEnsemble: {
      kind: "sunsynth",
      file: "var/synth-lab/Scratch String Ensemble.sunsynth",
      create: {
        module: "MetaModule",
        name: "Scratch String Ensemble",
        volume: 100,
        bpm: 120,
        tpl: 6,
        color: "#d98cff",
      },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput({ name: "Output", position: at(1344, 512) });
        const noteInput = project.addModule("MultiSynth", { name: "Input", position: at(0, 512) });
        synth.setInputModule(noteInput);
        // Four bowed saw sections on FMX, whose envelopes run in milliseconds
        // (Analog generator attack tops out near 100 ms). Module finetune
        // detunes the unison sections so they beat instead of cancelling.
        const section = (/** @type {string} */ name, /** @type {number} */ y, /** @type {number} */ panning, /** @type {number} */ relativeNote, /** @type {number} */ finetune, /** @type {number} */ volume) => ({
          name,
          color: "#e2a6ff",
          relativeNote,
          finetune,
          position: at(224, y),
          controllers: {
            volume,
            panning,
            sampleRate: "native",
            polyphony: 12,
            channels: "mono",
            adsrSmoothTransitions: "restartVolumeChange",
            envelopeGain: 1000,
            operators: [
              fmxOp({
                volume: 32768,
                attack: BOW_ATTACK_MS,
                release: 520,
                sustainLevel: 32768,
                sustain: "on",
                releaseCurve: "exp1",
                waveform: "saw",
                velocitySensitivity: 176,
                outputMode: FMX_TO_OUT,
              }),
              fmxOp({ volume: 0 }),
              fmxOp({ volume: 0 }),
              fmxOp({ volume: 0 }),
              fmxOp({ volume: 0 }),
            ],
          },
        });
        const sections = [
          project.addModule("FMX", section("Violins I", 272, 72, 0, 9, 5200)),
          project.addModule("FMX", section("Violins II", 432, 184, 0, -8, 5200)),
          project.addModule("FMX", section("Violas", 592, 128, 0, 3, 4000)),
          project.addModule("FMX", section("Celli", 752, 128, -12, -4, 4200)),
        ];
        // Bow speed 0..32768 maps every section's attack to 20..2000 ms.
        const bowSpeed = project.addModule("MultiCtl", {
          name: "Bow Speed",
          position: at(0, 272),
          controllers: { value: macroValue(BOW_ATTACK_MS, 20, 2000), response: 1000 },
          dataChunks: fanOut(sections.length, FMX_OP1_ATTACK, 20, 2000, 10000),
        });
        const bow = project.addModule("Filter Pro", {
          name: "Bow",
          position: at(448, 512),
          controllers: { type: "lp", freq: 4200, q: 16384, rolloff: "db24", mode: "stereoSmoothing", response: 150 },
        });
        const body = project.addModule("Filter Pro", {
          name: "Body",
          position: at(640, 512),
          controllers: {
            type: "peaking",
            freq: 520,
            q: 5000,
            gain: 19000,
            rolloff: "db12",
            mode: "stereo",
            response: 250,
          },
        });
        const ensemble = project.addModule("Flanger", {
          name: "Ensemble",
          position: at(864, 512),
          controllers: {
            dry: 220,
            wet: 150,
            feedback: 0,
            delay: 420,
            response: 2,
            lfoFreq: 40,
            lfoAmp: 70,
            lfoWaveform: 0,
            lfoFreqUnit: "hz005",
          },
        });
        const hall = project.addModule("Reverb", {
          name: "Hall",
          position: at(1088, 512),
          controllers: {
            dry: 256,
            wet: 70,
            feedback: 210,
            damp: 120,
            stereoWidth: 256,
            mode: "hq",
            allpassFilter: "improved",
            roomSize: 48,
          },
        });
        sections.forEach((module, slot) => {
          project.connect(noteInput, module);
          project.connect(bowSpeed, module);
          project.connect(module, bow, { slot });
        });
        project.connect(bow, body);
        project.connect(body, ensemble);
        project.connect(ensemble, hall);
        project.connect(hall, project.output);
        synth.expose("Bow speed", bowSpeed, "value");
        synth.expose("Brightness", bow, "freq");
        synth.expose("Celli", sections[3], "volume");
        synth.expose("Chorus", ensemble, "wet");
        synth.expose("Hall wet", hall, "wet");
      },
    },
  },
};

export default recipe;

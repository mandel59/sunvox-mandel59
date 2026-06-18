// @ts-check

/** @satisfies {import("../../../tools/sunvox-edit-recipe.d.ts").SunVoxEditRecipe} */
const recipe = {
  schemaVersion: 1,
  outputs: {
    waKotoPluck: {
      kind: "sunsynth",
      file: "var/synth-lab/Wa Koto Pluck.sunsynth",
      create: {
        module: "MetaModule",
        name: "Wa Koto Pluck",
        volume: 232,
        bpm: 92,
        tpl: 6,
        color: "#d7b35f",
      },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput({
          name: "Output",
          position: { x: 1104, y: 512, z: 0 },
        });
        const noteInput = project.addModule("MultiSynth", {
          name: "Input",
          position: { x: 0, y: 512, z: 0 },
        });
        synth.setInputModule(noteInput);
        const stringCore = project.addModule("FMX", {
          name: "Silk String Core",
          color: "#e2c16f",
          position: { x: 216, y: 448, z: 0 },
          controllers: {
            volume: 11800,
            panning: 124,
            sampleRate: "native",
            polyphony: 12,
            channels: "stereo",
            adsrSmoothTransitions: "restartSmootherVolumeChange",
            noiseFilter: 32768,
            envelopeGain: 1160,
            operators: [
              {
                volume: 32768,
                attack: 1,
                decay: 18,
                sustainLevel: 0,
                release: 86,
                attackCurve: "negExp1",
                decayCurve: "exp2",
                releaseCurve: "exp1",
                sustain: "off",
                waveform: "sin",
                freqMul: 1000,
                volumeScaling: 128,
                velocitySensitivity: 210,
                outputMode: 0,
              },
              {
                volume: 16400,
                attack: 1,
                decay: 920,
                sustainLevel: 0,
                release: 72,
                attackCurve: "negExp1",
                decayCurve: "exp2",
                releaseCurve: "linear",
                sustain: "off",
                waveform: "sin",
                noise: 60,
                freqMul: 7000,
                envScaling: 116,
                volumeScaling: 198,
                velocitySensitivity: 224,
                outputMode: 8,
              },
              {
                volume: 10000,
                attack: 1,
                decay: 1800,
                sustainLevel: 0,
                release: 130,
                attackCurve: "negExp1",
                decayCurve: "exp2",
                releaseCurve: "exp1",
                sustain: "off",
                waveform: "sin",
                noise: 120,
                freqMul: 2000,
                selfMod: 360,
                outputMode: 1,
              },
              {
                volume: 7200,
                attack: 1,
                decay: 2400,
                sustainLevel: 0,
                release: 160,
                attackCurve: "negExp1",
                decayCurve: "exp2",
                releaseCurve: "exp1",
                sustain: "off",
                waveform: "sin",
                freqMul: 3003,
                selfMod: 260,
                outputMode: 1,
              },
            ],
          },
        });
        const nailClick = project.addModule("Analog generator", {
          name: "Nail Click",
          color: "#f0d189",
          position: { x: 216, y: 640, z: 0 },
          controllers: {
            waveform: "violetNoise",
            volume: 24,
            panning: 144,
            attack: 0,
            release: 18,
            sustain: "off",
            expEnvelope: "on",
            filter: "bp12db",
            filterFreq: 12000,
            filterResonance: 620,
            filterExpFreq: "on",
            filterEnvelope: "sustainOff",
            polyphony: 8,
            mode: "hq",
          },
        });
        const woodBand = project.addModule("Filter Pro", {
          name: "Wood Body",
          color: "#bc8d38",
          position: { x: 456, y: 512, z: 0 },
          controllers: {
            type: "bpConstPeakGain",
            freq: 4600,
            q: 14200,
            rolloff: "db24",
            mode: "stereoSmoothing",
            response: 120,
            mix: 30000,
          },
        });
        const tatamiEcho = project.addModule("Echo", {
          name: "Tatami Echo",
          color: "#c9a96b",
          position: { x: 672, y: 512, z: 0 },
          controllers: {
            dry: 256,
            wet: 22,
            feedback: 72,
            delay: 3,
            rightChannelOffset: "on",
            delayUnit: "line3",
            rightChannelOffsetValue: 20600,
            filter: "lp6db",
            filterFreq: 6200,
          },
        });
        const pluckTrim = project.addModule("Compressor", {
          name: "Pluck Trim",
          color: "#d6b577",
          position: { x: 888, y: 512, z: 0 },
          controllers: {
            volume: 246,
            threshold: 248,
            slope: 78,
            attack: 1,
            release: 130,
            mode: "peak",
          },
        });
        project.connect(noteInput, stringCore);
        project.connect(noteInput, nailClick);
        project.connect(stringCore, woodBand);
        project.connect(nailClick, woodBand);
        project.connect(woodBand, tatamiEcho);
        project.connect(tatamiEcho, pluckTrim);
        project.connect(pluckTrim, project.output);
        synth.expose("String volume", stringCore, "volume");
        synth.expose("Click volume", nailClick, "volume");
        synth.expose("Body freq", woodBand, "freq");
        synth.expose("Echo wet", tatamiEcho, "wet");
        synth.expose("Output trim", pluckTrim, "volume");
      },
    },
    waShamisenTwang: {
      kind: "sunsynth",
      file: "var/synth-lab/Wa Shamisen Twang.sunsynth",
      create: {
        module: "MetaModule",
        name: "Wa Shamisen Twang",
        volume: 448,
        bpm: 92,
        tpl: 6,
        color: "#b86c45",
      },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput({
          name: "Output",
          position: { x: 1536, y: 512, z: 0 },
        });
        const noteInput = project.addModule("MultiSynth", {
          name: "Input",
          position: { x: 0, y: 512, z: 0 },
        });
        synth.setInputModule(noteInput);
        const stringCore = project.addModule("FMX", {
          name: "String Body Core",
          color: "#c9794e",
          position: { x: 224, y: 448, z: 0 },
          controllers: {
            volume: 20600,
            panning: 124,
            sampleRate: "native",
            polyphony: 8,
            channels: "stereo",
            adsrSmoothTransitions: "restartSmootherVolumeChange",
            noiseFilter: 32768,
            envelopeGain: 1180,
            operators: [
              {
                volume: 32768,
                attack: 1,
                decay: 14,
                sustainLevel: 0,
                release: 52,
                attackCurve: "negExp1",
                decayCurve: "exp2",
                releaseCurve: "exp1",
                sustain: "off",
                waveform: "sin",
                freqMul: 1000,
                volumeScaling: 128,
                velocitySensitivity: 218,
                outputMode: 0,
              },
              {
                volume: 15000,
                attack: 1,
                decay: 180,
                sustainLevel: 0,
                release: 60,
                attackCurve: "negExp1",
                decayCurve: "exp2",
                releaseCurve: "linear",
                sustain: "off",
                waveform: "sin",
                noise: 24,
                freqMul: 3000,
                envScaling: 116,
                volumeScaling: 190,
                velocitySensitivity: 224,
                outputMode: 8,
              },
              {
                volume: 10500,
                attack: 1,
                decay: 360,
                sustainLevel: 0,
                release: 80,
                attackCurve: "negExp1",
                decayCurve: "exp2",
                releaseCurve: "exp1",
                sustain: "off",
                waveform: "sin",
                noise: 36,
                freqMul: 2000,
                selfMod: 220,
                outputMode: 1,
              },
              {
                volume: 7200,
                attack: 1,
                decay: 500,
                sustainLevel: 0,
                release: 86,
                attackCurve: "negExp1",
                decayCurve: "exp2",
                releaseCurve: "exp1",
                sustain: "off",
                waveform: "sin",
                freqMul: 3003,
                selfMod: 180,
                outputMode: 1,
              },
            ],
          },
        });
        const sawariBuzz = project.addModule("Analog generator", {
          name: "Sawari Buzz",
          color: "#d88a5e",
          relativeNote: 12,
          position: { x: 224, y: 640, z: 0 },
          controllers: {
            waveform: "saw",
            volume: 42,
            panning: 148,
            attack: 0,
            release: 68,
            sustain: "off",
            expEnvelope: "on",
            osc2Pitch: 997,
            osc2Volume: 3000,
            osc2Mode: "add",
            filter: "bp12db",
            filterFreq: 2400,
            filterResonance: 340,
            filterExpFreq: "on",
            filterRelease: 54,
            filterEnvelope: "sustainOff",
            polyphony: 8,
            mode: "hq",
            noise: 2,
          },
        });
        const bachiClick = project.addModule("Analog generator", {
          name: "Bachi Click",
          color: "#8d4b31",
          position: { x: 224, y: 768, z: 0 },
          controllers: {
            waveform: "violetNoise",
            volume: 28,
            panning: 132,
            attack: 0,
            release: 10,
            sustain: "off",
            expEnvelope: "on",
            filter: "bp12db",
            filterFreq: 9800,
            filterResonance: 520,
            filterExpFreq: "on",
            filterRelease: 14,
            filterEnvelope: "sustainOff",
            polyphony: 8,
            mode: "hq",
          },
        });
        const sawariBite = project.addModule("Distortion", {
          name: "Sawari Bite",
          color: "#9d5435",
          position: { x: 456, y: 704, z: 0 },
          controllers: {
            volume: 138,
            type: "saturation3",
            power: 6,
            bitDepth: 15,
            freq: 44100,
          },
        });
        const douColor = project.addModule("Filter Pro", {
          name: "Dou Color",
          color: "#d39b78",
          position: { x: 672, y: 512, z: 0 },
          controllers: {
            type: "bpConstSkirtGain",
            freq: 1850,
            q: 5200,
            rolloff: "db24",
            mode: "monoSmoothing",
            response: 88,
            mix: 14200,
          },
        });
        const pluckGate = project.addModule("ADSR", {
          name: "Pluck Gate",
          color: "#a45f40",
          position: { x: 820, y: 512, z: 0 },
          controllers: {
            volume: 32768,
            attack: 0,
            decay: 420,
            sustainLevel: 0,
            release: 20,
            attackCurve: "negExp1",
            decayCurve: "exp2",
            releaseCurve: "exp2",
            sustain: "off",
            sustainPedal: "off",
            onNoteOn: "start",
            onNoteOff: "doNothing",
            mode: "ampModulatorStereo",
            smoothTransitions: "restartSmootherVolumeChange",
          },
        });
        const shortBodyTail = project.addModule("Echo", {
          name: "Short Body Tail",
          color: "#b77354",
          position: { x: 1016, y: 512, z: 0 },
          controllers: {
            dry: 256,
            wet: 4,
            feedback: 12,
            delay: 28,
            delayUnit: "ms",
            rightChannelOffset: "on",
            rightChannelOffsetValue: 18000,
            filter: "lp6db",
            filterFreq: 2600,
          },
        });
        const dcBlock = project.addModule("DC Blocker", {
          name: "DC Block",
          position: { x: 1232, y: 512, z: 0 },
          controllers: {
            channels: "stereo",
          },
        });
        const pluckTrim = project.addModule("Compressor", {
          name: "Pluck Trim",
          color: "#c7855f",
          position: { x: 1448, y: 512, z: 0 },
          controllers: {
            volume: 330,
            threshold: 308,
            slope: 86,
            attack: 1,
            release: 88,
            mode: "peak",
          },
        });
        project.connect(noteInput, stringCore);
        project.connect(noteInput, sawariBuzz);
        project.connect(noteInput, bachiClick);
        project.connect(sawariBuzz, sawariBite);
        project.connect(bachiClick, sawariBite);
        project.connect(stringCore, douColor);
        project.connect(noteInput, pluckGate);
        project.connect(douColor, pluckGate);
        project.connect(sawariBite, pluckGate);
        project.connect(pluckGate, shortBodyTail);
        project.connect(shortBodyTail, dcBlock);
        project.connect(dcBlock, pluckTrim);
        project.connect(pluckTrim, project.output);
        synth.expose("String volume", stringCore, "volume");
        synth.expose("Sawari volume", sawariBuzz, "volume");
        synth.expose("Click volume", bachiClick, "volume");
        synth.expose("Body freq", douColor, "freq");
        synth.expose("Pluck decay", pluckGate, "decay");
        synth.expose("Tail wet", shortBodyTail, "wet");
      },
    },
    waShakuhachiBreath: {
      kind: "sunsynth",
      file: "var/synth-lab/Wa Shakuhachi Breath.sunsynth",
      create: {
        module: "MetaModule",
        name: "Wa Shakuhachi Breath",
        volume: 1024,
        bpm: 92,
        tpl: 6,
        color: "#75a59a",
      },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput({
          name: "Output",
          position: { x: 1248, y: 512, z: 0 },
        });
        const noteInput = project.addModule("MultiSynth", {
          name: "Input",
          position: { x: 0, y: 512, z: 0 },
        });
        synth.setInputModule(noteInput);
        const pipeTone = project.addModule("Analog generator", {
          name: "Bamboo Tone",
          color: "#85b7aa",
          position: { x: 224, y: 448, z: 0 },
          controllers: {
            waveform: "hsin",
            volume: 82,
            panning: 128,
            attack: 14,
            release: 170,
            sustain: "on",
            expEnvelope: "on",
            osc2Pitch: 2000,
            osc2Volume: 3200,
            filter: "lp24db",
            filterFreq: 9200,
            filterResonance: 220,
            filterExpFreq: "on",
            polyphony: 4,
            mode: "hq",
            noise: 5,
          },
        });
        const breathNoise = project.addModule("Analog generator", {
          name: "Breath Noise",
          color: "#b7d3cb",
          position: { x: 224, y: 640, z: 0 },
          controllers: {
            waveform: "pinkNoise",
            volume: 26,
            panning: 138,
            attack: 1,
            release: 140,
            sustain: "on",
            expEnvelope: "on",
            filter: "bp12db",
            filterFreq: 6900,
            filterResonance: 760,
            filterExpFreq: "on",
            polyphony: 4,
            mode: "hq",
          },
        });
        const vowelBore = project.addModule("Vocal filter", {
          name: "Bore Formant",
          color: "#9fcac0",
          position: { x: 456, y: 512, z: 0 },
          controllers: {
            volume: 198,
            formantWidth: 104,
            intensity: 84,
            formants: 3,
            vowelPosition: 44,
            voiceType: "alto",
            channels: "stereo",
            randomFrequency: 7,
            randomSeed: 37,
            vowel1: "u",
            vowel2: "o",
            vowel3: "a",
            vowel4: "e",
            vowel5: "i",
          },
        });
        const yuriVibrato = project.addModule("Vibrato", {
          name: "Yuri Vibrato",
          color: "#6f9f96",
          position: { x: 664, y: 512, z: 0 },
          controllers: {
            volume: 244,
            amplitude: 9,
            freq: 142,
            channels: "stereo",
            frequencyUnit: "hz64",
            exponentialAmplitude: "on",
          },
        });
        const bambooAir = project.addModule("Filter Pro", {
          name: "Bamboo Air",
          color: "#a8c7bf",
          position: { x: 872, y: 512, z: 0 },
          controllers: {
            type: "lp",
            freq: 9800,
            q: 11200,
            rolloff: "db24",
            mode: "stereoSmoothing",
            response: 130,
            mix: 32768,
          },
        });
        const smallRoom = project.addModule("Reverb", {
          name: "Small Room",
          position: { x: 1064, y: 512, z: 0 },
          controllers: {
            dry: 256,
            wet: 34,
            feedback: 134,
            damp: 156,
            stereoWidth: 214,
            mode: "hq",
            roomSize: 18,
            randomSeed: 59,
          },
        });
        const outputTrim = project.addModule("Amplifier", {
          name: "Output Trim",
          color: "#a8d3cb",
          position: { x: 1264, y: 512, z: 0 },
          controllers: {
            volume: 320,
            balance: 128,
            fineVolume: 32768,
            gain: 1,
          },
        });
        const peakGuard = project.addModule("Compressor", {
          name: "Peak Guard",
          position: { x: 1420, y: 512, z: 0 },
          controllers: {
            volume: 246,
            threshold: 200,
            slope: 90,
            attack: 1,
            release: 180,
            mode: "peak",
          },
        });
        project.connect(noteInput, pipeTone);
        project.connect(noteInput, breathNoise);
        project.connect(pipeTone, vowelBore);
        project.connect(breathNoise, vowelBore);
        project.connect(vowelBore, yuriVibrato);
        project.connect(yuriVibrato, bambooAir);
        project.connect(bambooAir, smallRoom);
        project.connect(smallRoom, outputTrim);
        project.connect(outputTrim, peakGuard);
        project.connect(peakGuard, project.output);
        synth.expose("Tone volume", pipeTone, "volume");
        synth.expose("Breath volume", breathNoise, "volume");
        synth.expose("Formant", vowelBore, "vowelPosition");
        synth.expose("Yuri depth", yuriVibrato, "amplitude");
        synth.expose("Room wet", smallRoom, "wet");
      },
    },
    waTaikoEnsemble: {
      kind: "sunsynth",
      file: "var/synth-lab/Wa Taiko Ensemble.sunsynth",
      create: {
        module: "MetaModule",
        name: "Wa Taiko Ensemble",
        volume: 108,
        bpm: 92,
        tpl: 6,
        color: "#8f3a2f",
      },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput({
          name: "Output",
          position: { x: 1136, y: 512, z: 0 },
        });
        const noteInput = project.addModule("MultiSynth", {
          name: "Input",
          position: { x: 0, y: 512, z: 0 },
        });
        synth.setInputModule(noteInput);
        const odaiko = project.addModule("Kicker", {
          name: "Odaiko Body",
          color: "#a54535",
          position: { x: 224, y: 424, z: 0 },
          controllers: {
            volume: 240,
            waveform: "sin",
            panning: 126,
            attack: 0,
            release: 54,
            boost: 560,
            acceleration: 210,
            polyphony: 2,
            noClick: "on",
          },
        });
        const skinNoise = project.addModule("Analog generator", {
          name: "Skin Noise",
          color: "#cc775f",
          position: { x: 224, y: 584, z: 0 },
          controllers: {
            waveform: "pinkNoise",
            volume: 54,
            panning: 134,
            attack: 0,
            release: 30,
            sustain: "off",
            expEnvelope: "on",
            filter: "bp12db",
            filterFreq: 4600,
            filterResonance: 880,
            filterExpFreq: "on",
            filterRelease: 28,
            filterEnvelope: "sustainOff",
            polyphony: 3,
            mode: "hq",
          },
        });
        const rimClick = project.addModule("Analog generator", {
          name: "Rim Click",
          color: "#e3a37c",
          relativeNote: 24,
          position: { x: 224, y: 744, z: 0 },
          controllers: {
            waveform: "square",
            volume: 40,
            panning: 152,
            attack: 0,
            release: 12,
            sustain: "off",
            expEnvelope: "on",
            dutyCycle: 270,
            filter: "hp12db",
            filterFreq: 7600,
            filterResonance: 420,
            filterExpFreq: "on",
            polyphony: 3,
            mode: "hq",
            noise: 10,
          },
        });
        const skinDrive = project.addModule("Distortion", {
          name: "Skin Drive",
          color: "#843528",
          position: { x: 480, y: 512, z: 0 },
          controllers: {
            volume: 150,
            type: "saturation4",
            power: 24,
            bitDepth: 16,
            freq: 44100,
          },
        });
        const drumPunch = project.addModule("Compressor", {
          name: "Drum Punch",
          color: "#b85845",
          position: { x: 704, y: 512, z: 0 },
          controllers: {
            volume: 276,
            threshold: 222,
            slope: 70,
            attack: 1,
            release: 118,
            mode: "peak",
          },
        });
        const bodyRoom = project.addModule("Reverb", {
          name: "Body Room",
          position: { x: 920, y: 512, z: 0 },
          controllers: {
            dry: 256,
            wet: 18,
            feedback: 98,
            damp: 180,
            stereoWidth: 180,
            mode: "hq",
            roomSize: 12,
            randomSeed: 32,
          },
        });
        project.connect(noteInput, odaiko);
        project.connect(noteInput, skinNoise);
        project.connect(noteInput, rimClick);
        project.connect(odaiko, skinDrive);
        project.connect(skinNoise, skinDrive);
        project.connect(rimClick, skinDrive);
        project.connect(skinDrive, drumPunch);
        project.connect(drumPunch, bodyRoom);
        project.connect(bodyRoom, project.output);
        synth.expose("Body release", odaiko, "release");
        synth.expose("Body boost", odaiko, "boost");
        synth.expose("Skin noise", skinNoise, "volume");
        synth.expose("Drive", skinDrive, "power");
        synth.expose("Output trim", drumPunch, "volume");
      },
    },
  },
};

export default recipe;

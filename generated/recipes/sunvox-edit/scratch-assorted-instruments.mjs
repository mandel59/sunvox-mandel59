// @ts-check

/** @satisfies {import("../../../tools/sunvox-edit-recipe.d.ts").SunVoxEditRecipe} */
const recipe = {
  schemaVersion: 1,
  outputs: {
    scratchAcidBass: {
      kind: "sunsynth",
      file: "var/synth-lab/Scratch Acid Bass.sunsynth",
      create: {
          "module": "MetaModule",
          "name": "Scratch Acid Bass",
          "volume": 256,
          "bpm": 124,
          "tpl": 6,
          "color": "#9be13d"
        },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput({
          "name": "Output",
          "position": {
            "x": 992,
            "y": 512,
            "z": 0
          }
        });
        const noteInput = project.addModule("MultiSynth", {
          "name": "Input",
          "position": {
            "x": 0,
            "y": 512,
            "z": 0
          }
        });
        synth.setInputModule(noteInput);
        const bassOsc = project.addModule("Analog generator", {
          "name": "Bass Osc",
          "color": "#a5f03a",
          "position": {
            "x": 208,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "waveform": "square",
            "volume": 132,
            "panning": 128,
            "attack": 0,
            "release": 36,
            "osc2Pitch": 995,
            "osc2Volume": 9000,
            "dutyCycle": 420,
            "polyphony": 4,
            "mode": "hqMono"
          }
        });
        const acidFilter = project.addModule("Filter Pro", {
          "name": "Acid Filter",
          "position": {
            "x": 400,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "type": "lp",
            "freq": 2600,
            "q": 24800,
            "rolloff": "db24",
            "mode": "monoSmoothing",
            "response": 96
          }
        });
        const softClip = project.addModule("Distortion", {
          "name": "Soft Clip",
          "position": {
            "x": 576,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "volume": 164,
            "type": "saturation4",
            "power": 38,
            "bitDepth": 16,
            "freq": 44100
          }
        });
        const bassGlue = project.addModule("Compressor", {
          "name": "Bass Glue",
          "position": {
            "x": 752,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "volume": 286,
            "threshold": 260,
            "slope": 82,
            "attack": 4,
            "release": 160,
            "mode": "peak"
          }
        });
        project.connect(noteInput, bassOsc);
        project.connect(bassOsc, acidFilter);
        project.connect(acidFilter, softClip);
        project.connect(softClip, bassGlue);
        project.connect(bassGlue, project.output);
        synth.expose("Osc volume", bassOsc, "volume");
        synth.expose("Pulse width", bassOsc, "dutyCycle");
        synth.expose("Filter freq", acidFilter, "freq");
        synth.expose("Filter Q", acidFilter, "q");
        synth.expose("Drive", softClip, "power");
        synth.expose("Output trim", bassGlue, "volume");
      }
    },
    scratchGlassBell: {
      kind: "sunsynth",
      file: "var/synth-lab/Scratch Glass Bell.sunsynth",
      create: {
          "module": "MetaModule",
          "name": "Scratch Glass Bell",
          "volume": 256,
          "bpm": 120,
          "tpl": 6,
          "color": "#62d9ff"
        },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput({
          "name": "Output",
          "position": {
            "x": 1152,
            "y": 512,
            "z": 0
          }
        });
        const noteInput = project.addModule("MultiSynth", {
          "name": "Input",
          "position": {
            "x": 0,
            "y": 512,
            "z": 0
          }
        });
        synth.setInputModule(noteInput);
        const iceString = project.addModule("Analog generator", {
          "name": "Ice String",
          "color": "#8df6ff",
          "position": {
            "x": 224,
            "y": 448,
            "z": 0
          },
          "controllers": {
            "waveform": "square",
            "volume": 104,
            "panning": 112,
            "attack": 0,
            "release": 190,
            "sustain": "off",
            "expEnvelope": "on",
            "dutyCycle": 384,
            "osc2Pitch": 1000,
            "osc2Volume": 4800,
            "osc2Mode": "add",
            "filter": "lp24db",
            "filterFreq": 12600,
            "filterResonance": 260,
            "filterExpFreq": "on",
            "filterAttack": 0,
            "filterRelease": 160,
            "filterEnvelope": "sustainOff",
            "polyphony": 12,
            "mode": "hq",
            "noise": 2
          }
        });
        const crystalShimmer = project.addModule("Analog generator", {
          "name": "Crystal Shimmer",
          "color": "#d4fbff",
          "relativeNote": 12,
          "position": {
            "x": 224,
            "y": 608,
            "z": 0
          },
          "controllers": {
            "waveform": "square",
            "volume": 58,
            "panning": 164,
            "attack": 0,
            "release": 240,
            "sustain": "off",
            "expEnvelope": "on",
            "dutyCycle": 260,
            "osc2Pitch": 1002,
            "osc2Volume": 3000,
            "osc2Mode": "add",
            "filter": "bp12db",
            "filterFreq": 8400,
            "filterResonance": 900,
            "filterExpFreq": "on",
            "filterAttack": 0,
            "filterRelease": 210,
            "filterEnvelope": "sustainOff",
            "polyphony": 12,
            "mode": "hq",
            "noise": 4
          }
        });
        const glassPolish = project.addModule("Filter Pro", {
          "name": "Ice Polish",
          "color": "#b4f6ff",
          "position": {
            "x": 472,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "type": "peaking",
            "freq": 6800,
            "q": 5600,
            "gain": 17000,
            "rolloff": "db12",
            "response": 150,
            "mode": "stereoSmoothing",
            "mix": 24576
          }
        });
        const crystalHall = project.addModule("Reverb", {
          "name": "Crystal Hall",
          "color": "#78cfff",
          "position": {
            "x": 688,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "dry": 256,
            "wet": 118,
            "feedback": 196,
            "damp": 84,
            "stereoWidth": 250,
            "mode": "hq",
            "allpassFilter": "improved",
            "roomSize": 46
          }
        });
        const bellTrim = project.addModule("Amplifier", {
          "name": "Bell Trim",
          "color": "#a8f4ff",
          "position": {
            "x": 920,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "volume": 232,
            "stereoWidth": 224,
            "fineVolume": 32768
          }
        });
        project.connect(noteInput, iceString);
        project.connect(noteInput, crystalShimmer);
        project.connect(iceString, glassPolish, {
          "slot": 0
        });
        project.connect(crystalShimmer, glassPolish, {
          "slot": 1
        });
        project.connect(glassPolish, crystalHall);
        project.connect(crystalHall, bellTrim);
        project.connect(bellTrim, project.output);
        synth.expose("Pluck", iceString, "volume");
        synth.expose("Shimmer", crystalShimmer, "volume");
        synth.expose("Brightness", glassPolish, "freq");
        synth.expose("Hall wet", crystalHall, "wet");
        synth.expose("Output trim", bellTrim, "volume");
      }
    },
    scratchPWMOrgan: {
      kind: "sunsynth",
      file: "var/synth-lab/Scratch PWM Organ.sunsynth",
      create: {
          "module": "MetaModule",
          "name": "Scratch PWM Organ",
          "volume": 256,
          "bpm": 120,
          "tpl": 6,
          "color": "#e8dd5c"
        },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput({
          "name": "Output",
          "position": {
            "x": 1104,
            "y": 512,
            "z": 0
          }
        });
        const noteInput = project.addModule("MultiSynth", {
          "name": "Input",
          "position": {
            "x": 0,
            "y": 512,
            "z": 0
          }
        });
        synth.setInputModule(noteInput);
        const pulseA = project.addModule("Analog generator", {
          "name": "Pulse A",
          "color": "#e4ff72",
          "position": {
            "x": 224,
            "y": 416,
            "z": 0
          },
          "controllers": {
            "waveform": "square",
            "volume": 72,
            "panning": 104,
            "attack": 2,
            "release": 10,
            "dutyCycle": 384,
            "polyphony": 10,
            "mode": "hq"
          }
        });
        const pulseB = project.addModule("Analog generator", {
          "name": "Pulse B",
          "color": "#e4ff72",
          "position": {
            "x": 224,
            "y": 608,
            "z": 0
          },
          "controllers": {
            "waveform": "square",
            "volume": 66,
            "panning": 152,
            "attack": 2,
            "release": 10,
            "osc2Pitch": 1000,
            "osc2Volume": 12000,
            "dutyCycle": 640,
            "polyphony": 10,
            "mode": "hq"
          }
        });
        const toneFilter = project.addModule("Filter Pro", {
          "name": "Tone Filter",
          "position": {
            "x": 464,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "type": "lp",
            "freq": 9600,
            "q": 5800,
            "rolloff": "db12",
            "mode": "stereoSmoothing",
            "response": 150
          }
        });
        const organWidth = project.addModule("Amplifier", {
          "name": "Organ Width",
          "position": {
            "x": 656,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "volume": 232,
            "stereoWidth": 186,
            "fineVolume": 32768
          }
        });
        const organRoom = project.addModule("Reverb", {
          "name": "Organ Room",
          "position": {
            "x": 848,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "dry": 256,
            "wet": 32,
            "feedback": 142,
            "damp": 170,
            "stereoWidth": 184,
            "mode": "hq",
            "roomSize": 12
          }
        });
        project.connect(noteInput, pulseA);
        project.connect(noteInput, pulseB);
        project.connect(pulseA, toneFilter, {
          "slot": 0
        });
        project.connect(pulseB, toneFilter, {
          "slot": 1
        });
        project.connect(toneFilter, organWidth);
        project.connect(organWidth, organRoom);
        project.connect(organRoom, project.output);
        synth.expose("Pulse A width", pulseA, "dutyCycle");
        synth.expose("Pulse B width", pulseB, "dutyCycle");
        synth.expose("Filter freq", toneFilter, "freq");
        synth.expose("Stereo width", organWidth, "stereoWidth");
        synth.expose("Room wet", organRoom, "wet");
        synth.expose("Output trim", organWidth, "volume");
      }
    },
    scratchKickSnap: {
      kind: "sunsynth",
      file: "var/synth-lab/Scratch Kick Snap.sunsynth",
      create: {
          "module": "MetaModule",
          "name": "Scratch Kick Snap",
          "volume": 256,
          "bpm": 128,
          "tpl": 6,
          "color": "#ff626e"
        },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput({
          "name": "Output",
          "position": {
            "x": 944,
            "y": 512,
            "z": 0
          }
        });
        const noteInput = project.addModule("MultiSynth", {
          "name": "Input",
          "position": {
            "x": 0,
            "y": 512,
            "z": 0
          }
        });
        synth.setInputModule(noteInput);
        const kick = project.addModule("Kicker", {
          "name": "Kick",
          "color": "#58a2ff",
          "position": {
            "x": 240,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "volume": 248,
            "waveform": "sin",
            "panning": 128,
            "attack": 0,
            "release": 38,
            "boost": 430,
            "acceleration": 330,
            "polyphony": 1,
            "noClick": "on"
          }
        });
        const transientClip = project.addModule("Distortion", {
          "name": "Transient Clip",
          "position": {
            "x": 448,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "volume": 142,
            "type": "saturation3",
            "power": 22,
            "bitDepth": 16,
            "freq": 44100
          }
        });
        const kickPunch = project.addModule("Compressor", {
          "name": "Kick Punch",
          "position": {
            "x": 656,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "volume": 268,
            "threshold": 224,
            "slope": 72,
            "attack": 1,
            "release": 120,
            "mode": "peak"
          }
        });
        project.connect(noteInput, kick);
        project.connect(kick, transientClip);
        project.connect(transientClip, kickPunch);
        project.connect(kickPunch, project.output);
        synth.expose("Release", kick, "release");
        synth.expose("Boost", kick, "boost");
        synth.expose("Acceleration", kick, "acceleration");
        synth.expose("Clip power", transientClip, "power");
        synth.expose("Output trim", kickPunch, "volume");
      }
    }
  },
};

export default recipe;

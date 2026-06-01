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
          "name": "Note Input",
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
          "name": "Note Input",
          "position": {
            "x": 0,
            "y": 512,
            "z": 0
          }
        });
        synth.setInputModule(noteInput);
        const glassStrike = project.addModule("FM", {
          "name": "Glass Strike",
          "color": "#86f5ff",
          "position": {
            "x": 224,
            "y": 352,
            "z": 0
          },
          "controllers": {
            "cVolume": 92,
            "mVolume": 236,
            "panning": 128,
            "cFreqRatio": 2,
            "mFreqRatio": 11,
            "mSelfModulation": 62,
            "cAttack": 0,
            "cDecay": 26,
            "cSustain": 0,
            "cRelease": 130,
            "mAttack": 0,
            "mDecay": 18,
            "mSustain": 0,
            "mRelease": 70,
            "mScalingPerKey": 2,
            "polyphony": 12,
            "mode": "hq"
          }
        });
        const crystalBody = project.addModule("FM", {
          "name": "Crystal Body",
          "color": "#5ee8ff",
          "position": {
            "x": 224,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "cVolume": 126,
            "mVolume": 116,
            "panning": 108,
            "cFreqRatio": 1,
            "mFreqRatio": 5,
            "mSelfModulation": 24,
            "cAttack": 0,
            "cDecay": 190,
            "cSustain": 0,
            "cRelease": 380,
            "mAttack": 0,
            "mDecay": 72,
            "mSustain": 0,
            "mRelease": 180,
            "mScalingPerKey": 1,
            "polyphony": 12,
            "mode": "hq"
          }
        });
        const airRing = project.addModule("FM", {
          "name": "Air Ring",
          "color": "#c8fbff",
          "position": {
            "x": 224,
            "y": 672,
            "z": 0
          },
          "controllers": {
            "cVolume": 46,
            "mVolume": 184,
            "panning": 156,
            "cFreqRatio": 3,
            "mFreqRatio": 13,
            "mSelfModulation": 86,
            "cAttack": 0,
            "cDecay": 122,
            "cSustain": 0,
            "cRelease": 440,
            "mAttack": 0,
            "mDecay": 46,
            "mSustain": 0,
            "mRelease": 160,
            "mScalingPerKey": 3,
            "polyphony": 12,
            "mode": "hq"
          }
        });
        const glassPolish = project.addModule("Filter Pro", {
          "name": "Glass Polish",
          "color": "#b4f6ff",
          "position": {
            "x": 472,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "type": "hp6db",
            "freq": 540,
            "q": 16384,
            "rolloff": "db12",
            "mode": "stereoSmoothing",
            "response": 110
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
            "wet": 86,
            "feedback": 226,
            "damp": 78,
            "stereoWidth": 256,
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
            "volume": 292,
            "stereoWidth": 190,
            "fineVolume": 32768
          }
        });
        project.connect(noteInput, glassStrike);
        project.connect(noteInput, crystalBody);
        project.connect(noteInput, airRing);
        project.connect(glassStrike, glassPolish, {
          "slot": 0
        });
        project.connect(crystalBody, glassPolish, {
          "slot": 1
        });
        project.connect(airRing, glassPolish, {
          "slot": 2
        });
        project.connect(glassPolish, crystalHall);
        project.connect(crystalHall, bellTrim);
        project.connect(bellTrim, project.output);
        synth.expose("Strike", glassStrike, "mVolume");
        synth.expose("Body", crystalBody, "cVolume");
        synth.expose("Air", airRing, "cVolume");
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
          "name": "Note Input",
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
          "name": "Note Input",
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

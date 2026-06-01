// @ts-check

/** @satisfies {import("../../../tools/sunvox-edit-recipe.d.ts").SunVoxEditRecipe} */
const recipe = {
  schemaVersion: 1,
  outputs: {
    scratchAcidBass: {
      kind: "sunsynth",
      file: "var/synth-lab/Scratch Acid Bass.sunsynth",
      create: {
          "kind": "metaModule",
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
        project.addModule("MultiSynth", {
          "name": "Note Input",
          "position": {
            "x": 0,
            "y": 512,
            "z": 0
          },
          "id": "noteInput"
        });
        synth.setInputModule({"id":"noteInput"});
        project.addModule("Analog generator", {
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
          },
          "id": "bassOsc"
        });
        project.addModule("Filter Pro", {
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
          },
          "id": "acidFilter"
        });
        project.addModule("Distortion", {
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
          },
          "id": "softClip"
        });
        project.addModule("Compressor", {
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
          },
          "id": "bassGlue"
        });
        project.connect({"id":"noteInput"}, {"id":"bassOsc"});
        project.connect({"id":"bassOsc"}, {"id":"acidFilter"});
        project.connect({"id":"acidFilter"}, {"id":"softClip"});
        project.connect({"id":"softClip"}, {"id":"bassGlue"});
        project.connect({"id":"bassGlue"}, project.output);
        synth.expose("Osc volume", {"id":"bassOsc"}, "volume");
        synth.expose("Pulse width", {"id":"bassOsc"}, "dutyCycle");
        synth.expose("Filter freq", {"id":"acidFilter"}, "freq");
        synth.expose("Filter Q", {"id":"acidFilter"}, "q");
        synth.expose("Drive", {"id":"softClip"}, "power");
        synth.expose("Output trim", {"id":"bassGlue"}, "volume");
      }
    },
    scratchGlassBell: {
      kind: "sunsynth",
      file: "var/synth-lab/Scratch Glass Bell.sunsynth",
      create: {
          "kind": "metaModule",
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
        project.addModule("MultiSynth", {
          "name": "Note Input",
          "position": {
            "x": 0,
            "y": 512,
            "z": 0
          },
          "id": "noteInput"
        });
        synth.setInputModule({"id":"noteInput"});
        project.addModule("FM", {
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
          },
          "id": "glassStrike"
        });
        project.addModule("FM", {
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
          },
          "id": "crystalBody"
        });
        project.addModule("FM", {
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
          },
          "id": "airRing"
        });
        project.addModule("Filter Pro", {
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
          },
          "id": "glassPolish"
        });
        project.addModule("Reverb", {
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
          },
          "id": "crystalHall"
        });
        project.addModule("Amplifier", {
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
          },
          "id": "bellTrim"
        });
        project.connect({"id":"noteInput"}, {"id":"glassStrike"});
        project.connect({"id":"noteInput"}, {"id":"crystalBody"});
        project.connect({"id":"noteInput"}, {"id":"airRing"});
        project.connect({"id":"glassStrike"}, {"id":"glassPolish"}, {
          "slot": 0
        });
        project.connect({"id":"crystalBody"}, {"id":"glassPolish"}, {
          "slot": 1
        });
        project.connect({"id":"airRing"}, {"id":"glassPolish"}, {
          "slot": 2
        });
        project.connect({"id":"glassPolish"}, {"id":"crystalHall"});
        project.connect({"id":"crystalHall"}, {"id":"bellTrim"});
        project.connect({"id":"bellTrim"}, project.output);
        synth.expose("Strike", {"id":"glassStrike"}, "mVolume");
        synth.expose("Body", {"id":"crystalBody"}, "cVolume");
        synth.expose("Air", {"id":"airRing"}, "cVolume");
        synth.expose("Brightness", {"id":"glassPolish"}, "freq");
        synth.expose("Hall wet", {"id":"crystalHall"}, "wet");
        synth.expose("Output trim", {"id":"bellTrim"}, "volume");
      }
    },
    scratchPWMOrgan: {
      kind: "sunsynth",
      file: "var/synth-lab/Scratch PWM Organ.sunsynth",
      create: {
          "kind": "metaModule",
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
        project.addModule("MultiSynth", {
          "name": "Note Input",
          "position": {
            "x": 0,
            "y": 512,
            "z": 0
          },
          "id": "noteInput"
        });
        synth.setInputModule({"id":"noteInput"});
        project.addModule("Analog generator", {
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
          },
          "id": "pulseA"
        });
        project.addModule("Analog generator", {
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
          },
          "id": "pulseB"
        });
        project.addModule("Filter Pro", {
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
          },
          "id": "toneFilter"
        });
        project.addModule("Amplifier", {
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
          },
          "id": "organWidth"
        });
        project.addModule("Reverb", {
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
          },
          "id": "organRoom"
        });
        project.connect({"id":"noteInput"}, {"id":"pulseA"});
        project.connect({"id":"noteInput"}, {"id":"pulseB"});
        project.connect({"id":"pulseA"}, {"id":"toneFilter"}, {
          "slot": 0
        });
        project.connect({"id":"pulseB"}, {"id":"toneFilter"}, {
          "slot": 1
        });
        project.connect({"id":"toneFilter"}, {"id":"organWidth"});
        project.connect({"id":"organWidth"}, {"id":"organRoom"});
        project.connect({"id":"organRoom"}, project.output);
        synth.expose("Pulse A width", {"id":"pulseA"}, "dutyCycle");
        synth.expose("Pulse B width", {"id":"pulseB"}, "dutyCycle");
        synth.expose("Filter freq", {"id":"toneFilter"}, "freq");
        synth.expose("Stereo width", {"id":"organWidth"}, "stereoWidth");
        synth.expose("Room wet", {"id":"organRoom"}, "wet");
        synth.expose("Output trim", {"id":"organWidth"}, "volume");
      }
    },
    scratchKickSnap: {
      kind: "sunsynth",
      file: "var/synth-lab/Scratch Kick Snap.sunsynth",
      create: {
          "kind": "metaModule",
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
        project.addModule("MultiSynth", {
          "name": "Note Input",
          "position": {
            "x": 0,
            "y": 512,
            "z": 0
          },
          "id": "noteInput"
        });
        synth.setInputModule({"id":"noteInput"});
        project.addModule("Kicker", {
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
          },
          "id": "kick"
        });
        project.addModule("Distortion", {
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
          },
          "id": "transientClip"
        });
        project.addModule("Compressor", {
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
          },
          "id": "kickPunch"
        });
        project.connect({"id":"noteInput"}, {"id":"kick"});
        project.connect({"id":"kick"}, {"id":"transientClip"});
        project.connect({"id":"transientClip"}, {"id":"kickPunch"});
        project.connect({"id":"kickPunch"}, project.output);
        synth.expose("Release", {"id":"kick"}, "release");
        synth.expose("Boost", {"id":"kick"}, "boost");
        synth.expose("Acceleration", {"id":"kick"}, "acceleration");
        synth.expose("Clip power", {"id":"transientClip"}, "power");
        synth.expose("Output trim", {"id":"kickPunch"}, "volume");
      }
    }
  },
};

export default recipe;

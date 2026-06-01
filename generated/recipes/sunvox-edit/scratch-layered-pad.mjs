// @ts-check

/** @satisfies {import("../../../tools/sunvox-edit-recipe.d.ts").SunVoxEditRecipe} */
const recipe = {
  schemaVersion: 1,
  outputs: {
    scratchLayeredPad: {
      kind: "sunsynth",
      file: "var/synth-lab/Scratch Layered Pad.sunsynth",
      create: {
          "module": "MetaModule",
          "name": "Scratch Layered Pad",
          "volume": 256,
          "bpm": 120,
          "tpl": 6,
          "color": "#a7d84f"
        },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput({
          "name": "Output",
          "position": {
            "x": 1088,
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
        const sawL = project.addModule("Analog generator", {
          "name": "Saw L",
          "color": "#9ad92d",
          "position": {
            "x": 192,
            "y": 352,
            "z": 0
          },
          "controllers": {
            "waveform": "saw",
            "volume": 58,
            "panning": 84,
            "attack": 18,
            "release": 128,
            "osc2Pitch": 1006,
            "osc2Volume": 18000,
            "polyphony": 12,
            "mode": "hq",
            "noise": 6
          }
        });
        const sawR = project.addModule("Analog generator", {
          "name": "Saw R",
          "color": "#9ad92d",
          "position": {
            "x": 192,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "waveform": "saw",
            "volume": 58,
            "panning": 172,
            "attack": 18,
            "release": 128,
            "osc2Pitch": 994,
            "osc2Volume": 18000,
            "polyphony": 12,
            "mode": "hq",
            "noise": 6
          }
        });
        const sineBody = project.addModule("Analog generator", {
          "name": "Sine Body",
          "color": "#c5ff6a",
          "position": {
            "x": 192,
            "y": 672,
            "z": 0
          },
          "controllers": {
            "waveform": "sin",
            "volume": 36,
            "panning": 128,
            "attack": 24,
            "release": 160,
            "polyphony": 12,
            "mode": "hq"
          }
        });
        const padFilter = project.addModule("Filter Pro", {
          "name": "Pad Filter",
          "position": {
            "x": 432,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "type": "lp",
            "freq": 7200,
            "q": 10400,
            "rolloff": "db24",
            "mode": "stereoSmoothing",
            "response": 180
          }
        });
        const padWidth = project.addModule("Amplifier", {
          "name": "Pad Width",
          "position": {
            "x": 592,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "volume": 230,
            "stereoWidth": 210,
            "fineVolume": 32768
          }
        });
        const shortEcho = project.addModule("Delay", {
          "name": "Short Echo",
          "position": {
            "x": 752,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "dry": 256,
            "wet": 64,
            "delayL": 180,
            "delayR": 260,
            "delayUnit": "ms",
            "feedback": 3600
          }
        });
        const softGlue = project.addModule("Compressor", {
          "name": "Soft Glue",
          "position": {
            "x": 912,
            "y": 512,
            "z": 0
          },
          "controllers": {
            "volume": 268,
            "threshold": 304,
            "slope": 74,
            "attack": 8,
            "release": 420,
            "mode": "rms"
          }
        });
        project.connect(noteInput, sawL);
        project.connect(noteInput, sawR);
        project.connect(noteInput, sineBody);
        project.connect(sawL, padFilter, {
          "slot": 0
        });
        project.connect(sawR, padFilter, {
          "slot": 1
        });
        project.connect(sineBody, padFilter, {
          "slot": 2
        });
        project.connect(padFilter, padWidth);
        project.connect(padWidth, shortEcho);
        project.connect(shortEcho, softGlue);
        project.connect(softGlue, project.output);
        synth.expose("Filter freq", padFilter, "freq");
        synth.expose("Filter Q", padFilter, "q");
        synth.expose("Stereo width", padWidth, "stereoWidth");
        synth.expose("Delay wet", shortEcho, "wet");
        synth.expose("Delay feedback", shortEcho, "feedback");
        synth.expose("Output trim", softGlue, "volume");
      }
    }
  },
};

export default recipe;

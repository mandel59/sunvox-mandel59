// @ts-check

/** @satisfies {import("../../../tools/sunvox-edit-recipe.d.ts").SunVoxEditRecipe} */
const recipe = {
  schemaVersion: 1,
  inputs: {
    template: { kind: "sunsynth", path: "../../../instruments/mandel59 SuperSaw.sunsynth" },
  },
  outputs: {
    labBrightF6400Q12288: {
      kind: "sunsynth",
      file: "var/synth-lab/mandel59 Lab Bright SuperSaw F6400 Q12288.sunsynth",
      from: "template",
      apply(synth) {
        const project = synth.embeddedProject();
        synth.rootModule.rename("Lab Bright F6400 Q12288");
        synth.rootModule.controllers.set({
          "volume": 256
        });
        project.findModule("Filter Pro").controllers.set({
          "freq": 6400,
          "q": 12288,
          "gain": 18432
        });
        project.findModule("Compressor").controllers.set({
          "volume": 200,
          "threshold": 220,
          "attack": 2,
          "release": 250
        });
        synth.userController("Detune 1").set(7200);
        synth.userController("Stereo width").set(15600);
        synth.userController("Filter freq").set(6400);
        synth.userController("Release").set(1200);
      }
    },
    labBrightF7600Q12288: {
      kind: "sunsynth",
      file: "var/synth-lab/mandel59 Lab Bright SuperSaw F7600 Q12288.sunsynth",
      from: "template",
      apply(synth) {
        const project = synth.embeddedProject();
        synth.rootModule.rename("Lab Bright F7600 Q12288");
        synth.rootModule.controllers.set({
          "volume": 256
        });
        project.findModule("Filter Pro").controllers.set({
          "freq": 7600,
          "q": 12288,
          "gain": 18432
        });
        project.findModule("Compressor").controllers.set({
          "volume": 200,
          "threshold": 220,
          "attack": 2,
          "release": 250
        });
        synth.userController("Detune 1").set(7200);
        synth.userController("Stereo width").set(15600);
        synth.userController("Filter freq").set(7600);
        synth.userController("Release").set(1200);
      }
    },
    labSoftF3200R2400: {
      kind: "sunsynth",
      file: "var/synth-lab/mandel59 Lab Soft SuperSaw F3200 R2400.sunsynth",
      from: "template",
      apply(synth) {
        const project = synth.embeddedProject();
        synth.rootModule.rename("Lab Soft F3200 R2400");
        synth.rootModule.controllers.set({
          "volume": 260
        });
        project.findModule({
          "index": 3
        }).controllers.set({
          "volume": 92,
          "noise": 24,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 4
        }).controllers.set({
          "volume": 92,
          "noise": 24,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 5
        }).controllers.set({
          "volume": 44,
          "noise": 0,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 7
        }).controllers.set({
          "volume": 44,
          "noise": 0,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 8
        }).controllers.set({
          "volume": 44,
          "noise": 0,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 9
        }).controllers.set({
          "volume": 44,
          "noise": 0,
          "osc2Volume": 18000
        });
        project.findModule("Filter Pro").controllers.set({
          "freq": 3200,
          "q": 9800,
          "rolloff": "db24"
        });
        synth.userController("Detune 1").set(5400);
        synth.userController("Stereo width").set(9800);
        synth.userController("Blend 1").set(11200);
        synth.userController("Attack").set(800);
        synth.userController("Release").set(2400);
      }
    },
    labSoftF3200R3600: {
      kind: "sunsynth",
      file: "var/synth-lab/mandel59 Lab Soft SuperSaw F3200 R3600.sunsynth",
      from: "template",
      apply(synth) {
        const project = synth.embeddedProject();
        synth.rootModule.rename("Lab Soft F3200 R3600");
        synth.rootModule.controllers.set({
          "volume": 260
        });
        project.findModule({
          "index": 3
        }).controllers.set({
          "volume": 92,
          "noise": 24,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 4
        }).controllers.set({
          "volume": 92,
          "noise": 24,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 5
        }).controllers.set({
          "volume": 44,
          "noise": 0,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 7
        }).controllers.set({
          "volume": 44,
          "noise": 0,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 8
        }).controllers.set({
          "volume": 44,
          "noise": 0,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 9
        }).controllers.set({
          "volume": 44,
          "noise": 0,
          "osc2Volume": 18000
        });
        project.findModule("Filter Pro").controllers.set({
          "freq": 3200,
          "q": 9800,
          "rolloff": "db24"
        });
        synth.userController("Detune 1").set(5400);
        synth.userController("Stereo width").set(9800);
        synth.userController("Blend 1").set(11200);
        synth.userController("Attack").set(800);
        synth.userController("Release").set(3600);
      }
    },
    labSoftF4200R2400: {
      kind: "sunsynth",
      file: "var/synth-lab/mandel59 Lab Soft SuperSaw F4200 R2400.sunsynth",
      from: "template",
      apply(synth) {
        const project = synth.embeddedProject();
        synth.rootModule.rename("Lab Soft F4200 R2400");
        synth.rootModule.controllers.set({
          "volume": 260
        });
        project.findModule({
          "index": 3
        }).controllers.set({
          "volume": 92,
          "noise": 24,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 4
        }).controllers.set({
          "volume": 92,
          "noise": 24,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 5
        }).controllers.set({
          "volume": 44,
          "noise": 0,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 7
        }).controllers.set({
          "volume": 44,
          "noise": 0,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 8
        }).controllers.set({
          "volume": 44,
          "noise": 0,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 9
        }).controllers.set({
          "volume": 44,
          "noise": 0,
          "osc2Volume": 18000
        });
        project.findModule("Filter Pro").controllers.set({
          "freq": 4200,
          "q": 9800,
          "rolloff": "db24"
        });
        synth.userController("Detune 1").set(5400);
        synth.userController("Stereo width").set(9800);
        synth.userController("Blend 1").set(11200);
        synth.userController("Attack").set(800);
        synth.userController("Release").set(2400);
      }
    },
    labSoftF4200R3600: {
      kind: "sunsynth",
      file: "var/synth-lab/mandel59 Lab Soft SuperSaw F4200 R3600.sunsynth",
      from: "template",
      apply(synth) {
        const project = synth.embeddedProject();
        synth.rootModule.rename("Lab Soft F4200 R3600");
        synth.rootModule.controllers.set({
          "volume": 260
        });
        project.findModule({
          "index": 3
        }).controllers.set({
          "volume": 92,
          "noise": 24,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 4
        }).controllers.set({
          "volume": 92,
          "noise": 24,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 5
        }).controllers.set({
          "volume": 44,
          "noise": 0,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 7
        }).controllers.set({
          "volume": 44,
          "noise": 0,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 8
        }).controllers.set({
          "volume": 44,
          "noise": 0,
          "osc2Volume": 18000
        });
        project.findModule({
          "index": 9
        }).controllers.set({
          "volume": 44,
          "noise": 0,
          "osc2Volume": 18000
        });
        project.findModule("Filter Pro").controllers.set({
          "freq": 4200,
          "q": 9800,
          "rolloff": "db24"
        });
        synth.userController("Detune 1").set(5400);
        synth.userController("Stereo width").set(9800);
        synth.userController("Blend 1").set(11200);
        synth.userController("Attack").set(800);
        synth.userController("Release").set(3600);
      }
    }
  },
};

export default recipe;

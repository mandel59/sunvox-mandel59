// @ts-check

/** @satisfies {import("../../../tools/sunvox-edit-recipe.d.ts").SunVoxEditRecipe} */
const recipe = {
  schemaVersion: 1,
  outputs: {
    karplusString: {
      kind: "sunsynth",
      file: "generated/instruments/Karplus String.sunsynth",
      create: {
        module: "MetaModule",
        name: "Karplus String",
        volume: 256,
        color: "#d0a46a",
      },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput({ position: { x: 920, y: 512, z: 0 } });

        const notes = project.addModule("MultiSynth", {
          name: "Notes",
          position: { x: 0, y: 512, z: 0 },
        });
        synth.setInputModule(notes);

        // Pitch2Ctl's frequency mode sends the note frequency directly to
        // Echo's fourth controller (Delay). Echo must use the Hz delay unit.
        const pitch = project.addModule("Pitch2Ctl", {
          name: "Note to loop Hz",
          position: { x: 240, y: 360, z: 0 },
          controllers: {
            mode: "frequencyHz",
            onNoteOff: "doNothing",
            outController: 4,
          },
        });
        const pluck = project.addModule("Generator", {
          name: "Noise pluck",
          position: { x: 240, y: 640, z: 0 },
          controllers: {
            volume: 160,
            waveform: "noiseSampler",
            attack: 0,
            release: 1,
            sustain: "off",
            polyphony: 1,
            mode: "mono",
          },
        });
        const string = project.addModule("Echo", {
          name: "Filtered string loop",
          position: { x: 576, y: 512, z: 0 },
          controllers: {
            dry: 0,
            wet: 256,
            feedback: 253,
            delay: 220,
            rightChannelOffset: "off",
            delayUnit: "hz",
            filter: "lp6db",
            filterFreq: 10000,
          },
        });

        project.connect(notes, pitch);
        project.connect(notes, pluck);
        project.connect(pitch, string);
        project.connect(pluck, string);
        project.connect(string, project.output);

        synth.expose("Pluck level", pluck, "volume");
        synth.expose("String decay", string, "feedback");
        synth.expose("String brightness", string, "filterFreq");
      },
    },
  },
};

export default recipe;

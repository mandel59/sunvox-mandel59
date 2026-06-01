// @ts-check

/** @satisfies {import("../../../tools/sunvox-edit-recipe.d.ts").SunVoxEditRecipe} */
const recipe = {
  schemaVersion: 1,
  outputs: {
    scratchAnalog: {
      kind: "sunsynth",
      file: "var/synth-lab/Scratch Analog Edit Recipe.sunsynth",
      create: {
        module: "MetaModule",
        name: "Scratch Analog Edit Recipe",
        color: "#ff9a4a",
      },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput();
        const noteInput = project.addModule("MultiSynth", {
          name: "Note Input",
          position: { x: 0, y: 512, z: 0 },
        });
        synth.setInputModule(noteInput);
        const tone = project.addModule("Analog generator", {
          name: "Tone",
          controllers: {
            waveform: "saw",
            volume: 128,
            release: 32,
            polyphony: 8,
          },
        });
        project.connect(noteInput, tone);
        project.connect(tone, project.output);
        synth.expose("Tone volume", tone, "volume");
      },
    },
  },
};

export default recipe;

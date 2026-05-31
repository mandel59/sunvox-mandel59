// @ts-check

/** @satisfies {import("../../../tools/sunsynth-recipe.d.ts").SunSynthRecipe} */
const recipe = {
  outDir: "var/synth-lab",
  variants: [
    {
      name: "Scratch Analog",
      fileName: "Scratch Analog.sunsynth",
      create: { color: "#ff9a4a" },
      apply(synth) {
        synth
          .setOutput()
          .addModule("MultiSynth", {
            name: "Note Input",
            position: { x: 0, y: 512, z: 0 },
          })
          .setInputModule("Note Input")
          .addModule("Analog generator", {
            name: "Tone",
            controllers: {
              waveform: "saw",
              volume: 128,
              release: 32,
              polyphony: 8,
            },
          })
          .connect("Note Input", "Tone")
          .connect("Tone", "Output")
          .exposeController("Tone volume", "Tone", "volume");
      },
    },
  ],
};

export default recipe;

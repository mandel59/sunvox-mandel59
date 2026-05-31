export default {
  outDir: "var/synth-lab",
  variants: [
    {
      name: "Scratch Analog",
      fileName: "Scratch Analog.sunsynth",
      create: { color: "#ff9a4a" },
      apply(synth) {
        synth
          .addOutput()
          .addInput()
          .addModule("Analog generator", {
            name: "Tone",
            controllers: {
              waveform: "saw",
              volume: 128,
              release: 32,
              polyphony: 8,
            },
          })
          .connect("Input", "Tone")
          .connect("Tone", "Output")
          .exposeController("Tone volume", "Tone", "volume");
      },
    },
  ],
};

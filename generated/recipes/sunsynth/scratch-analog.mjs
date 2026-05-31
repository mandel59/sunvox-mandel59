export default {
  outDir: "var/synth-lab",
  variants: [
    {
      name: "Scratch Analog",
      fileName: "mandel59 Scratch Analog.sunsynth",
      create: true,
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

export default {
  outDir: "var/synth-lab",
  variants: [
    {
      name: "Scratch Layered Pad",
      fileName: "mandel59 Scratch Layered Pad.sunsynth",
      create: { volume: 256, bpm: 120, tpl: 6 },
      apply(synth) {
        synth
          .addOutput({
            name: "Output",
            position: { x: 1088, y: 512, z: 0 },
          })
          .addInput({
            name: "Input",
            position: { x: 0, y: 512, z: 0 },
          })
          .addModule("Analog generator", {
            name: "Saw L",
            color: "#9ad92d",
            position: { x: 192, y: 352, z: 0 },
            controllers: {
              waveform: "saw",
              volume: 58,
              panning: 84,
              attack: 18,
              release: 128,
              osc2Pitch: 1006,
              osc2Volume: 18000,
              polyphony: 12,
              mode: "hq",
              noise: 6,
            },
          })
          .addModule("Analog generator", {
            name: "Saw R",
            color: "#9ad92d",
            position: { x: 192, y: 512, z: 0 },
            controllers: {
              waveform: "saw",
              volume: 58,
              panning: 172,
              attack: 18,
              release: 128,
              osc2Pitch: 994,
              osc2Volume: 18000,
              polyphony: 12,
              mode: "hq",
              noise: 6,
            },
          })
          .addModule("Analog generator", {
            name: "Sine Body",
            color: "#c5ff6a",
            position: { x: 192, y: 672, z: 0 },
            controllers: {
              waveform: "sin",
              volume: 36,
              panning: 128,
              attack: 24,
              release: 160,
              polyphony: 12,
              mode: "hq",
            },
          })
          .addModule("Filter Pro", {
            name: "Pad Filter",
            position: { x: 432, y: 512, z: 0 },
            controllers: {
              type: "lp",
              freq: 7200,
              q: 10400,
              rolloff: "db24",
              mode: "stereoSmoothing",
              response: 180,
            },
          })
          .addModule("Amplifier", {
            name: "Pad Width",
            position: { x: 592, y: 512, z: 0 },
            controllers: {
              volume: 230,
              stereoWidth: 210,
              fineVolume: 32768,
            },
          })
          .addModule("Delay", {
            name: "Short Echo",
            position: { x: 752, y: 512, z: 0 },
            controllers: {
              dry: 256,
              wet: 64,
              delayL: 180,
              delayR: 260,
              delayUnit: "ms",
              feedback: 3600,
            },
          })
          .addModule("Compressor", {
            name: "Soft Glue",
            position: { x: 912, y: 512, z: 0 },
            controllers: {
              volume: 268,
              threshold: 304,
              slope: 74,
              attack: 8,
              release: 420,
              mode: "rms",
            },
          })
          .connect("Input", "Saw L")
          .connect("Input", "Saw R")
          .connect("Input", "Sine Body")
          .connect("Saw L", "Pad Filter", { slot: 0 })
          .connect("Saw R", "Pad Filter", { slot: 1 })
          .connect("Sine Body", "Pad Filter", { slot: 2 })
          .connect("Pad Filter", "Pad Width")
          .connect("Pad Width", "Short Echo")
          .connect("Short Echo", "Soft Glue")
          .connect("Soft Glue", "Output")
          .exposeController("Filter freq", "Pad Filter", "freq")
          .exposeController("Filter Q", "Pad Filter", "q")
          .exposeController("Stereo width", "Pad Width", "stereoWidth")
          .exposeController("Delay wet", "Short Echo", "wet")
          .exposeController("Delay feedback", "Short Echo", "feedback")
          .exposeController("Output trim", "Soft Glue", "volume");
      },
    },
  ],
};

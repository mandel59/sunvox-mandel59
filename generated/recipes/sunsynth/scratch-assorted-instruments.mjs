export default {
  outDir: "var/synth-lab",
  variants: [
    {
      name: "Scratch Acid Bass",
      fileName: "mandel59 Scratch Acid Bass.sunsynth",
      create: { volume: 256, bpm: 124, tpl: 6 },
      apply(synth) {
        synth
          .addOutput({
            name: "Output",
            position: { x: 992, y: 512, z: 0 },
          })
          .addInput({
            name: "Input",
            position: { x: 0, y: 512, z: 0 },
          })
          .addModule("Analog generator", {
            name: "Bass Osc",
            color: "#a5f03a",
            position: { x: 208, y: 512, z: 0 },
            controllers: {
              waveform: "square",
              volume: 132,
              panning: 128,
              attack: 0,
              release: 36,
              osc2Pitch: 995,
              osc2Volume: 9000,
              dutyCycle: 420,
              polyphony: 4,
              mode: "hqMono",
            },
          })
          .addModule("Filter Pro", {
            name: "Acid Filter",
            position: { x: 400, y: 512, z: 0 },
            controllers: {
              type: "lp",
              freq: 2600,
              q: 24800,
              rolloff: "db24",
              mode: "monoSmoothing",
              response: 96,
            },
          })
          .addModule("Distortion", {
            name: "Soft Clip",
            position: { x: 576, y: 512, z: 0 },
            controllers: {
              volume: 164,
              type: "saturation4",
              power: 38,
              bitDepth: 16,
              freq: 44100,
            },
          })
          .addModule("Compressor", {
            name: "Bass Glue",
            position: { x: 752, y: 512, z: 0 },
            controllers: {
              volume: 286,
              threshold: 260,
              slope: 82,
              attack: 4,
              release: 160,
              mode: "peak",
            },
          })
          .connect("Input", "Bass Osc")
          .connect("Bass Osc", "Acid Filter")
          .connect("Acid Filter", "Soft Clip")
          .connect("Soft Clip", "Bass Glue")
          .connect("Bass Glue", "Output")
          .exposeController("Osc volume", "Bass Osc", "volume")
          .exposeController("Pulse width", "Bass Osc", "dutyCycle")
          .exposeController("Filter freq", "Acid Filter", "freq")
          .exposeController("Filter Q", "Acid Filter", "q")
          .exposeController("Drive", "Soft Clip", "power")
          .exposeController("Output trim", "Bass Glue", "volume");
      },
    },
    {
      name: "Scratch Glass Bell",
      fileName: "mandel59 Scratch Glass Bell.sunsynth",
      create: { volume: 256, bpm: 120, tpl: 6 },
      apply(synth) {
        synth
          .addOutput({
            name: "Output",
            position: { x: 864, y: 512, z: 0 },
          })
          .addInput({
            name: "Input",
            position: { x: 0, y: 512, z: 0 },
          })
          .addModule("FM", {
            name: "Bell FM",
            color: "#58dfff",
            position: { x: 240, y: 512, z: 0 },
            controllers: {
              cVolume: 158,
              mVolume: 122,
              panning: 128,
              cFreqRatio: 1,
              mFreqRatio: 3,
              mSelfModulation: 18,
              cAttack: 0,
              cDecay: 86,
              cSustain: 0,
              cRelease: 180,
              mAttack: 0,
              mDecay: 68,
              mSustain: 0,
              mRelease: 210,
              mScalingPerKey: 1,
              polyphony: 8,
              mode: "hq",
            },
          })
          .addModule("Reverb", {
            name: "Small Hall",
            position: { x: 448, y: 512, z: 0 },
            controllers: {
              dry: 256,
              wet: 54,
              feedback: 182,
              damp: 148,
              stereoWidth: 230,
              mode: "hq",
              allpassFilter: "improved",
              roomSize: 24,
            },
          })
          .addModule("Amplifier", {
            name: "Bell Trim",
            position: { x: 656, y: 512, z: 0 },
            controllers: {
              volume: 224,
              stereoWidth: 154,
              fineVolume: 32768,
            },
          })
          .connect("Input", "Bell FM")
          .connect("Bell FM", "Small Hall")
          .connect("Small Hall", "Bell Trim")
          .connect("Bell Trim", "Output")
          .exposeController("Carrier volume", "Bell FM", "cVolume")
          .exposeController("Mod volume", "Bell FM", "mVolume")
          .exposeController("Mod ratio", "Bell FM", "mFreqRatio")
          .exposeController("Mod self", "Bell FM", "mSelfModulation")
          .exposeController("Reverb wet", "Small Hall", "wet")
          .exposeController("Output trim", "Bell Trim", "volume");
      },
    },
    {
      name: "Scratch PWM Organ",
      fileName: "mandel59 Scratch PWM Organ.sunsynth",
      create: { volume: 256, bpm: 120, tpl: 6 },
      apply(synth) {
        synth
          .addOutput({
            name: "Output",
            position: { x: 1104, y: 512, z: 0 },
          })
          .addInput({
            name: "Input",
            position: { x: 0, y: 512, z: 0 },
          })
          .addModule("Analog generator", {
            name: "Pulse A",
            color: "#e4ff72",
            position: { x: 224, y: 416, z: 0 },
            controllers: {
              waveform: "square",
              volume: 72,
              panning: 104,
              attack: 2,
              release: 10,
              dutyCycle: 384,
              polyphony: 10,
              mode: "hq",
            },
          })
          .addModule("Analog generator", {
            name: "Pulse B",
            color: "#e4ff72",
            position: { x: 224, y: 608, z: 0 },
            controllers: {
              waveform: "square",
              volume: 66,
              panning: 152,
              attack: 2,
              release: 10,
              osc2Pitch: 1000,
              osc2Volume: 12000,
              dutyCycle: 640,
              polyphony: 10,
              mode: "hq",
            },
          })
          .addModule("Filter Pro", {
            name: "Tone Filter",
            position: { x: 464, y: 512, z: 0 },
            controllers: {
              type: "lp",
              freq: 9600,
              q: 5800,
              rolloff: "db12",
              mode: "stereoSmoothing",
              response: 150,
            },
          })
          .addModule("Amplifier", {
            name: "Organ Width",
            position: { x: 656, y: 512, z: 0 },
            controllers: {
              volume: 232,
              stereoWidth: 186,
              fineVolume: 32768,
            },
          })
          .addModule("Reverb", {
            name: "Organ Room",
            position: { x: 848, y: 512, z: 0 },
            controllers: {
              dry: 256,
              wet: 32,
              feedback: 142,
              damp: 170,
              stereoWidth: 184,
              mode: "hq",
              roomSize: 12,
            },
          })
          .connect("Input", "Pulse A")
          .connect("Input", "Pulse B")
          .connect("Pulse A", "Tone Filter", { slot: 0 })
          .connect("Pulse B", "Tone Filter", { slot: 1 })
          .connect("Tone Filter", "Organ Width")
          .connect("Organ Width", "Organ Room")
          .connect("Organ Room", "Output")
          .exposeController("Pulse A width", "Pulse A", "dutyCycle")
          .exposeController("Pulse B width", "Pulse B", "dutyCycle")
          .exposeController("Filter freq", "Tone Filter", "freq")
          .exposeController("Stereo width", "Organ Width", "stereoWidth")
          .exposeController("Room wet", "Organ Room", "wet")
          .exposeController("Output trim", "Organ Width", "volume");
      },
    },
    {
      name: "Scratch Kick Snap",
      fileName: "mandel59 Scratch Kick Snap.sunsynth",
      create: { volume: 256, bpm: 128, tpl: 6 },
      apply(synth) {
        synth
          .addOutput({
            name: "Output",
            position: { x: 944, y: 512, z: 0 },
          })
          .addInput({
            name: "Input",
            position: { x: 0, y: 512, z: 0 },
          })
          .addModule("Kicker", {
            name: "Kick",
            color: "#58a2ff",
            position: { x: 240, y: 512, z: 0 },
            controllers: {
              volume: 248,
              waveform: "sin",
              panning: 128,
              attack: 0,
              release: 38,
              boost: 430,
              acceleration: 330,
              polyphony: 1,
              noClick: "on",
            },
          })
          .addModule("Distortion", {
            name: "Transient Clip",
            position: { x: 448, y: 512, z: 0 },
            controllers: {
              volume: 142,
              type: "saturation3",
              power: 22,
              bitDepth: 16,
              freq: 44100,
            },
          })
          .addModule("Compressor", {
            name: "Kick Punch",
            position: { x: 656, y: 512, z: 0 },
            controllers: {
              volume: 268,
              threshold: 224,
              slope: 72,
              attack: 1,
              release: 120,
              mode: "peak",
            },
          })
          .connect("Input", "Kick")
          .connect("Kick", "Transient Clip")
          .connect("Transient Clip", "Kick Punch")
          .connect("Kick Punch", "Output")
          .exposeController("Release", "Kick", "release")
          .exposeController("Boost", "Kick", "boost")
          .exposeController("Acceleration", "Kick", "acceleration")
          .exposeController("Clip power", "Transient Clip", "power")
          .exposeController("Output trim", "Kick Punch", "volume");
      },
    },
  ],
};

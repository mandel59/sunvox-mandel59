// @ts-check

/** @satisfies {import("../../../tools/sunsynth-recipe.d.ts").SunSynthRecipe} */
const recipe = {
  outDir: "var/synth-lab",
  variants: [
    {
      name: "Scratch Acid Bass",
      fileName: "Scratch Acid Bass.sunsynth",
      create: { volume: 256, bpm: 124, tpl: 6, color: "#9be13d" },
      apply(synth) {
        synth
          .setOutput({
            name: "Output",
            position: { x: 992, y: 512, z: 0 },
          })
          .addModule("MultiSynth", {
            name: "Note Input",
            position: { x: 0, y: 512, z: 0 },
          })
          .setInputModule("Note Input")
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
          .connect("Note Input", "Bass Osc")
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
      fileName: "Scratch Glass Bell.sunsynth",
      create: { volume: 256, bpm: 120, tpl: 6, color: "#62d9ff" },
      apply(synth) {
        synth
          .setOutput({
            name: "Output",
            position: { x: 1152, y: 512, z: 0 },
          })
          .addModule("MultiSynth", {
            name: "Note Input",
            position: { x: 0, y: 512, z: 0 },
          })
          .setInputModule("Note Input")
          .addModule("FM", {
            name: "Glass Strike",
            color: "#86f5ff",
            position: { x: 224, y: 352, z: 0 },
            controllers: {
              cVolume: 92,
              mVolume: 236,
              panning: 128,
              cFreqRatio: 2,
              mFreqRatio: 11,
              mSelfModulation: 62,
              cAttack: 0,
              cDecay: 26,
              cSustain: 0,
              cRelease: 130,
              mAttack: 0,
              mDecay: 18,
              mSustain: 0,
              mRelease: 70,
              mScalingPerKey: 2,
              polyphony: 12,
              mode: "hq",
            },
          })
          .addModule("FM", {
            name: "Crystal Body",
            color: "#5ee8ff",
            position: { x: 224, y: 512, z: 0 },
            controllers: {
              cVolume: 126,
              mVolume: 116,
              panning: 108,
              cFreqRatio: 1,
              mFreqRatio: 5,
              mSelfModulation: 24,
              cAttack: 0,
              cDecay: 190,
              cSustain: 0,
              cRelease: 380,
              mAttack: 0,
              mDecay: 72,
              mSustain: 0,
              mRelease: 180,
              mScalingPerKey: 1,
              polyphony: 12,
              mode: "hq",
            },
          })
          .addModule("FM", {
            name: "Air Ring",
            color: "#c8fbff",
            position: { x: 224, y: 672, z: 0 },
            controllers: {
              cVolume: 46,
              mVolume: 184,
              panning: 156,
              cFreqRatio: 3,
              mFreqRatio: 13,
              mSelfModulation: 86,
              cAttack: 0,
              cDecay: 122,
              cSustain: 0,
              cRelease: 440,
              mAttack: 0,
              mDecay: 46,
              mSustain: 0,
              mRelease: 160,
              mScalingPerKey: 3,
              polyphony: 12,
              mode: "hq",
            },
          })
          .addModule("Filter Pro", {
            name: "Glass Polish",
            color: "#b4f6ff",
            position: { x: 472, y: 512, z: 0 },
            controllers: {
              type: "hp6db",
              freq: 540,
              q: 16384,
              rolloff: "db12",
              mode: "stereoSmoothing",
              response: 110,
            },
          })
          .addModule("Reverb", {
            name: "Crystal Hall",
            color: "#78cfff",
            position: { x: 688, y: 512, z: 0 },
            controllers: {
              dry: 256,
              wet: 86,
              feedback: 226,
              damp: 78,
              stereoWidth: 256,
              mode: "hq",
              allpassFilter: "improved",
              roomSize: 46,
            },
          })
          .addModule("Amplifier", {
            name: "Bell Trim",
            color: "#a8f4ff",
            position: { x: 920, y: 512, z: 0 },
            controllers: {
              volume: 292,
              stereoWidth: 190,
              fineVolume: 32768,
            },
          })
          .connect("Note Input", "Glass Strike")
          .connect("Note Input", "Crystal Body")
          .connect("Note Input", "Air Ring")
          .connect("Glass Strike", "Glass Polish", { slot: 0 })
          .connect("Crystal Body", "Glass Polish", { slot: 1 })
          .connect("Air Ring", "Glass Polish", { slot: 2 })
          .connect("Glass Polish", "Crystal Hall")
          .connect("Crystal Hall", "Bell Trim")
          .connect("Bell Trim", "Output")
          .exposeController("Strike", "Glass Strike", "mVolume")
          .exposeController("Body", "Crystal Body", "cVolume")
          .exposeController("Air", "Air Ring", "cVolume")
          .exposeController("Brightness", "Glass Polish", "freq")
          .exposeController("Hall wet", "Crystal Hall", "wet")
          .exposeController("Output trim", "Bell Trim", "volume");
      },
    },
    {
      name: "Scratch PWM Organ",
      fileName: "Scratch PWM Organ.sunsynth",
      create: { volume: 256, bpm: 120, tpl: 6, color: "#e8dd5c" },
      apply(synth) {
        synth
          .setOutput({
            name: "Output",
            position: { x: 1104, y: 512, z: 0 },
          })
          .addModule("MultiSynth", {
            name: "Note Input",
            position: { x: 0, y: 512, z: 0 },
          })
          .setInputModule("Note Input")
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
          .connect("Note Input", "Pulse A")
          .connect("Note Input", "Pulse B")
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
      fileName: "Scratch Kick Snap.sunsynth",
      create: { volume: 256, bpm: 128, tpl: 6, color: "#ff626e" },
      apply(synth) {
        synth
          .setOutput({
            name: "Output",
            position: { x: 944, y: 512, z: 0 },
          })
          .addModule("MultiSynth", {
            name: "Note Input",
            position: { x: 0, y: 512, z: 0 },
          })
          .setInputModule("Note Input")
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
          .connect("Note Input", "Kick")
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

export default recipe;

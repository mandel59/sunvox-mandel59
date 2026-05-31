// @ts-check

/** @satisfies {import("../../../tools/sunsynth-recipe.d.ts").SunSynthRecipeFactory} */
const recipe = ({ sweep }) => ({
  template: "instruments/mandel59 SuperSaw.sunsynth",
  outDir: "var/synth-lab",
  variants: [
    ...sweep({
      name: "Lab Bright F{freq} Q{q}",
      fileName: "mandel59 Lab Bright SuperSaw F{freq} Q{q}.sunsynth",
      params: {
        freq: [6400, 7600],
        q: [12288],
      },
      probes: ["C3:96:1.5", "C5:112:1.0"],
      build(synth, { freq, q }) {
        synth
          .setRootControllers({ volume: 256 })
          .module("Filter Pro")
          .set({ freq, q, gain: 18432 })
          .module("Compressor")
          .set({ volume: 200, threshold: 220, attack: 2, release: 250 })
          .userController("Detune 1")
          .set(7200)
          .userController("Stereo width")
          .set(15600)
          .userController("Filter freq")
          .set(freq)
          .userController("Release")
          .set(1200);
      },
    }),
    ...sweep({
      name: "Lab Soft F{freq} R{release}",
      fileName: "mandel59 Lab Soft SuperSaw F{freq} R{release}.sunsynth",
      params: {
        freq: [3200, 4200],
        release: [2400, 3600],
      },
      probes: ["C3:96:1.5", "C5:112:1.0"],
      build(synth, { freq, release }) {
        synth
          .setRootControllers({ volume: 260 })
          .setModulesByType("Analog generator", (_module, _index, ordinal) => ({
            volume: ordinal < 2 ? 92 : 44,
            noise: ordinal < 2 ? 24 : 0,
            osc2Volume: 18000,
          }))
          .module("Filter Pro")
          .set({ freq, q: 9800, rolloff: "db24" })
          .userController("Detune 1")
          .set(5400)
          .userController("Stereo width")
          .set(9800)
          .userController("Blend 1")
          .set(11200)
          .userController("Attack")
          .set(800)
          .userController("Release")
          .set(release);
      },
    }),
  ],
});

export default recipe;

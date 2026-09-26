// @ts-check

/** @satisfies {import("../../../tools/sunvox-edit-recipe.d.ts").SunVoxEditRecipe} */
const recipe = {
  schemaVersion: 1,
  outputs: {
    karplusString4ch: {
      kind: "sunsynth",
      file: "generated/instruments/Karplus-Strong Pluck 4ch.sunsynth",
      create: {
        module: "MetaModule",
        name: "Karplus-Strong Pluck 4ch",
        volume: 256,
        color: "#d0a46a",
      },
      apply(synth) {
        const project = synth.embeddedProject();
        project.setOutput({ position: { x: 1320, y: 520, z: 0 } });

        // Each Echo owns one delay buffer. Route each note to a separate
        // Pitch2Ctl / Generator / Echo path so simultaneous pitches can ring.
        const notes = project.addModule("MultiSynth", {
          name: "Voice allocator",
          position: { x: 0, y: 520, z: 0 },
          dataChunks: [{
            index: 1,
            name: "options",
            options: { outputSlotMode: "roundRobin" },
          }],
        });
        synth.setInputModule(notes);

        const plucks = [];
        const strings = [];
        for (let voice = 0; voice < 4; voice += 1) {
          const y = 80 + voice * 300;
          const input = project.addModule("MultiSynth", {
            name: `Voice ${voice + 1}`,
            position: { x: 220, y: y + 80, z: 0 },
          });
          const pitch = project.addModule("Pitch2Ctl", {
            name: `Pitch ${voice + 1} to delay Hz`,
            position: { x: 440, y, z: 0 },
            controllers: {
              mode: "frequencyHz",
              onNoteOff: "doNothing",
              outController: 4,
            },
          });
          const pluck = project.addModule("Generator", {
            name: `Noise pluck ${voice + 1}`,
            position: { x: 440, y: y + 160, z: 0 },
            controllers: {
              volume: 144,
              waveform: "noiseSampler",
              attack: 0,
              release: 1,
              sustain: "off",
              polyphony: 1,
              mode: "mono",
            },
          });
          const string = project.addModule("Echo", {
            name: `String loop ${voice + 1}`,
            position: { x: 700, y: y + 80, z: 0 },
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

          project.connect(notes, input);
          project.connect(input, pitch);
          project.connect(input, pluck);
          project.connect(pitch, string);
          project.connect(pluck, string);
          plucks.push(pluck);
          strings.push(string);
        }

        const peakGuard = project.addModule("Compressor", {
          name: "Chord peak guard",
          position: { x: 1080, y: 650, z: 0 },
          controllers: {
            volume: 240,
            threshold: 160,
            slope: 50,
            attack: 1,
            release: 120,
            mode: "peak",
          },
        });
        for (const string of strings) project.connect(string, peakGuard);
        project.connect(peakGuard, project.output);

        // MultiCtl sends normalized 0..32768 controller events, even when
        // the target controller's displayed range is 0..256 or 0..22000.
        // Targets also have matching defaults before the first edit.
        const macros = [
          { name: "Pluck level", value: 18432, controller: 1, targets: plucks },
          { name: "String decay", value: 32384, controller: 3, targets: strings },
          { name: "String brightness", value: 14895, controller: 9, targets: strings },
        ];
        for (const [index, macro] of macros.entries()) {
          const control = project.addModule("MultiCtl", {
            name: macro.name,
            position: { x: 920, y: 60 + index * 150, z: 0 },
            controllers: { value: macro.value },
            dataChunks: [{
              index: 0,
              name: "outputSlots",
              slots: macro.targets.map((_, slot) => ({
                index: slot,
                controller: macro.controller,
              })),
            }],
          });
          for (const target of macro.targets) project.connect(control, target);
          synth.expose(macro.name, control, "value");
        }
      },
    },
  },
};

export default recipe;

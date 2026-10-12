import { parseContainer } from "./sunvox-codec.mjs";
import {
  DEFAULT_OFFLINE_INIT_FLAGS,
  assertSunVoxOk,
  mallocString,
  withMallocBytes,
  withSlotLock,
  withSunVoxSlot,
} from "./sunvox-node.mjs";

// Builds SunVox Sampler modules from in-memory WAV files through SunVox Lib
// (sv_sampler_load_from_memory + sv_sampler_par), then returns the decoded
// module documents so music recipes can place them like any other module.

const SAMPLER_PAR = Object.freeze({
  loopBegin: 0,
  loopLength: 1,
  loopType: 2,
  loopRelease: 3,
  volume: 4,
  panning: 5,
  finetune: 6,
  relativeNote: 7,
  startPosition: 8,
});

const NOTE_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function noteIndex(note) {
  if (typeof note === "number") return note;
  const match = /^([A-G])(#?)(\d)$/u.exec(note);
  if (!match) throw new Error(`Invalid note name: ${note}`);
  return Number(match[3]) * 12 + NOTE_NAMES.indexOf(`${match[1]}${match[2]}`);
}

function newSampler(module, slot, name) {
  const typePointer = mallocString(module, "Sampler");
  const namePointer = mallocString(module, name);
  try {
    return withSlotLock(module, slot, () =>
      assertSunVoxOk(module._sv_new_module(slot, typePointer, namePointer, 0, 0, 0), `sv_new_module ${name}`),
    );
  } finally {
    module._free(typePointer);
    module._free(namePointer);
  }
}

function saveSlot(module, slot) {
  const sizePointer = module._malloc(8);
  let dataPointer;
  try {
    module.HEAP32[sizePointer >> 2] = 0;
    module.HEAP32[(sizePointer >> 2) + 1] = 0;
    dataPointer = module._sv_save_to_memory(slot, sizePointer);
    const size = module.HEAP32[sizePointer >> 2];
    if (!dataPointer || size <= 0) throw new Error("sv_save_to_memory failed");
    return Buffer.from(module.HEAPU8.subarray(dataPointer, dataPointer + size));
  } finally {
    if (dataPointer) module._free(dataPointer);
    module._free(sizePointer);
  }
}

/**
 * @param {Array<{
 *   name: string,
 *   samples: Array<{ wav: Buffer, baseNote?: string | number, relativeNote?: number, finetune?: number, volume?: number, panning?: number,
 *     loop?: { begin: number, length: number, type?: 1 | 2, release?: boolean } }>,
 *   noteMap?: Array<[string | number, string | number, number]>,
 * }>} specs
 */
export async function buildSamplerModules(specs) {
  return withSunVoxSlot({ flags: DEFAULT_OFFLINE_INIT_FLAGS }, async ({ module, slot }) => {
    const indices = [];
    for (const spec of specs) {
      const index = newSampler(module, slot, spec.name);
      for (const [sampleSlot, sample] of spec.samples.entries()) {
        withMallocBytes(module, sample.wav, (pointer) =>
          assertSunVoxOk(
            module._sv_sampler_load_from_memory(slot, index, pointer, sample.wav.length, sampleSlot),
            `sv_sampler_load_from_memory ${spec.name}#${sampleSlot}`,
          ),
        );
        // SunVox tunes freshly loaded samples to play at their recorded pitch
        // on C5; baseNote shifts that so a mapped key plays unshifted.
        let relativeNote = sample.relativeNote;
        if (relativeNote === undefined && sample.baseNote !== undefined) {
          const current = module._sv_sampler_par(slot, index, sampleSlot, SAMPLER_PAR.relativeNote, 0, 0);
          relativeNote = current - (noteIndex(sample.baseNote) - noteIndex("C5"));
        }
        const pars = [
          ["relativeNote", relativeNote],
          ["finetune", sample.finetune],
          ["volume", sample.volume],
          ["panning", sample.panning],
          ["loopBegin", sample.loop?.begin],
          ["loopLength", sample.loop?.length],
          ["loopType", sample.loop ? (sample.loop.type ?? 1) : undefined],
          ["loopRelease", sample.loop?.release ? 1 : undefined],
        ];
        for (const [par, value] of pars) {
          if (value === undefined) continue;
          module._sv_sampler_par(slot, index, sampleSlot, SAMPLER_PAR[par], value, 1);
        }
      }
      indices.push(index);
    }
    const document = parseContainer(saveSlot(module, slot));
    return indices.map((index, specIndex) => {
      const decoded = document.modules[index];
      const spec = specs[specIndex];
      const instrument = decoded.dataChunks?.find((chunk) => chunk.name === "instrument")?.instrument;
      if (spec.noteMap && instrument) {
        const map = Array.isArray(instrument.sampleMap) ? instrument.sampleMap : new Array(128).fill(0);
        for (const [from, to, sampleIndex] of spec.noteMap) {
          for (let note = noteIndex(from); note <= noteIndex(to); note += 1) map[note] = sampleIndex;
        }
        instrument.sampleMap = map;
      }
      delete decoded.inputs;
      delete decoded.outputs;
      return decoded;
    });
  });
}

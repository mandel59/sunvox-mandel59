// Each preset fully specifies both tuning and physical key intervals.
export const PERFORMANCE_PRESETS = Object.freeze([
  { id: "12edo-chromatic", label: "12 EDO / クロマチック", edo: 12, horizontal: 1, diagonal: 6 },
  { id: "12edo-isomorphic", label: "12 EDO / 右+5・右上+2", edo: 12, horizontal: 5, diagonal: 2 },
  { id: "19edo-isomorphic", label: "19 EDO / 右+8・右上+3", edo: 19, horizontal: 8, diagonal: 3 },
  { id: "31edo-isomorphic", label: "31 EDO / 右+13・右上+5", edo: 31, horizontal: 13, diagonal: 5 },
  { id: "41edo-isomorphic", label: "41 EDO / 右+17・右上+7", edo: 41, horizontal: 17, diagonal: 7 },
  { id: "53edo-isomorphic", label: "53 EDO / 右+22・右上+9", edo: 53, horizontal: 22, diagonal: 9 },
].map(Object.freeze));
export const DEFAULT_PRESET_ID = "41edo-isomorphic";
export const EDO = 41;
export const wrapStep = (step, edo = EDO) => ((step % edo) + edo) % edo;
export const formatStep = step => step >= 0 ? "+" + step : String(step);
// Physical KeyboardEvent.code positions; labels use the US keyboard legends.
const rows = [
  ["F1 F2 F3 F4 F5 F6 F7 F8 F9 F10", "F1 F2 F3 F4 F5 F6 F7 F8 F9 F10"],
  ["Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal", "1 2 3 4 5 6 7 8 9 0 - ="],
  ["KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight", "Q W E R T Y U I O P [ ]"],
  ["KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote", "A S D F G H J K L ; '"],
  ["KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash", "Z X C V B N M , . /"],
];
// Moving diagonally upward keeps n unchanged; moving right increases n by one.
export function getPreset(id) {
  const preset = PERFORMANCE_PRESETS.find(preset => preset.id === id);
  if (!preset) throw new RangeError("Unknown performance preset: " + id);
  return preset;
}
export function createKeyLayout(preset = getPreset(DEFAULT_PRESET_ID)) {
  const { horizontal, diagonal } = preset;
  return rows.flatMap(([codes, labels], index) => {
    const row = index - 1;
    return codes.split(" ").map((code, position) => {
      const column = position + (row === -1 ? 1 : 0);
      const up = 3 - row;
      const n = column - 1 - up;
      return { code, label: labels.split(" ")[position], row, column, step: up * diagonal + n * horizontal };
    });
  });
}
export const KEY_LAYOUT = createKeyLayout();
export function toneForStep(step, octave = 4, tuning = getPreset(DEFAULT_PRESET_ID)) {
  if (!Number.isInteger(step) || !Number.isInteger(octave) || octave < 2 || octave > 6 || !Number.isInteger(tuning?.edo) || tuning.edo < 1) {
    throw new RangeError("Invalid keyboard pitch");
  }
  const frequency = 440 * 2 ** ((octave - 4) - 9 / 12 + step / tuning.edo);
  const pitch = Math.round(30720 - Math.log2(frequency / 16.333984375) * 3072);
  if (pitch < 0 || pitch > 30720) throw new RangeError("Pitch outside SunVox range");
  return { frequency, pitch };
}

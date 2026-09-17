export const TUNING_PRESETS = Object.freeze([
  { id: "12edo", label: "12 EDO（標準）", edo: 12 },
  { id: "19edo", label: "19 EDO", edo: 19 },
  { id: "31edo", label: "31 EDO", edo: 31 },
  { id: "41edo", label: "41 EDO", edo: 41 },
  { id: "53edo", label: "53 EDO", edo: 53 },
]);
export const LAYOUT_PRESETS = Object.freeze([
  { id: "isomorphic", label: "アイソモーフィック", description: "右へ純正4度、右上へ大全音に近い間隔", intervals: edo => ({ horizontal: Math.round(edo * Math.log2(4 / 3)), diagonal: Math.round(edo * Math.log2(9 / 8)) }) },
  { id: "chromatic", label: "クロマチック", description: "右へ1音、上の段へ完全4度に近い間隔", intervals: edo => ({ horizontal: 1, diagonal: Math.round(edo * Math.log2(4 / 3)) + 1 }) },
]);
export const DEFAULT_TUNING_ID = "41edo";
export const DEFAULT_LAYOUT_ID = "isomorphic";
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
export function getTuning(id) {
  const tuning = TUNING_PRESETS.find(preset => preset.id === id);
  if (!tuning) throw new RangeError("Unknown tuning preset: " + id);
  return tuning;
}
export function getLayout(id) {
  const layout = LAYOUT_PRESETS.find(preset => preset.id === id);
  if (!layout) throw new RangeError("Unknown keyboard layout preset: " + id);
  return layout;
}
export function createKeyLayout(tuning = getTuning(DEFAULT_TUNING_ID), layout = getLayout(DEFAULT_LAYOUT_ID)) {
  const { horizontal, diagonal } = layout.intervals(tuning.edo);
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
export function toneForStep(step, octave = 4, tuning = getTuning(DEFAULT_TUNING_ID)) {
  if (!Number.isInteger(step) || !Number.isInteger(octave) || octave < 2 || octave > 6 || !Number.isInteger(tuning?.edo) || tuning.edo < 1) {
    throw new RangeError("Invalid keyboard pitch");
  }
  const frequency = 440 * 2 ** ((octave - 4) - 9 / 12 + step / tuning.edo);
  const pitch = Math.round(30720 - Math.log2(frequency / 16.333984375) * 3072);
  if (pitch < 0 || pitch > 30720) throw new RangeError("Pitch outside SunVox range");
  return { frequency, pitch };
}

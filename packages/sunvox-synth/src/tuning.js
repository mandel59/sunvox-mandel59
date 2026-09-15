export const EDO = 41;
export const ROW_INTERVAL = 10;
// Physical KeyboardEvent.code positions; labels use the US keyboard legends.
const rows = [
  ["Digit1 Digit2 Digit3 Digit4 Digit5 Digit6 Digit7 Digit8 Digit9 Digit0 Minus Equal", "1 2 3 4 5 6 7 8 9 0 - =", 30],
  ["KeyQ KeyW KeyE KeyR KeyT KeyY KeyU KeyI KeyO KeyP BracketLeft BracketRight", "Q W E R T Y U I O P [ ]", 20],
  ["KeyA KeyS KeyD KeyF KeyG KeyH KeyJ KeyK KeyL Semicolon Quote", "A S D F G H J K L ; '", 10],
  ["KeyZ KeyX KeyC KeyV KeyB KeyN KeyM Comma Period Slash", "Z X C V B N M , . /", 0],
];
export const KEY_LAYOUT = rows.flatMap(([codes, labels, base], row) =>
  codes.split(" ").map((code, column) => ({
    code, label: labels.split(" ")[column], row, column, step: base + column,
  }))
);
export function toneForStep(step, octave = 4) {
  if (!Number.isInteger(step) || !Number.isInteger(octave) || octave < 2 || octave > 6) {
    throw new RangeError("Invalid keyboard pitch");
  }
  const frequency = 440 * 2 ** ((octave - 4) - 9 / 12 + step / EDO);
  const pitch = Math.round(30720 - Math.log2(frequency / 16.333984375) * 3072);
  if (pitch < 0 || pitch > 30720) throw new RangeError("Pitch outside SunVox range");
  return { frequency, pitch };
}

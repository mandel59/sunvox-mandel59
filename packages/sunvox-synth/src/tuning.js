export const EDO = 41;
export const DIAGONAL_INTERVAL = 7;
export const HORIZONTAL_INTERVAL = 17;
export const wrapStep = step => ((step % EDO) + EDO) % EDO;
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
function keyboardStep(row, column) {
  const up = 3 - row;
  const n = column - 1 - up; // X is the origin.
  return up * DIAGONAL_INTERVAL + n * HORIZONTAL_INTERVAL;
}
export const KEY_LAYOUT = rows.flatMap(([codes, labels], index) => {
  const row = index - 1; // Preserve the number/Q/A/Z row coordinates.
  return codes.split(" ").map((code, position) => {
    const column = position + (row === -1 ? 1 : 0); // F1 is diagonally above Digit1.
    return { code, label: labels.split(" ")[position], row, column, step: keyboardStep(row, column) };
  });
});
export function toneForStep(step, octave = 4) {
  if (!Number.isInteger(step) || !Number.isInteger(octave) || octave < 2 || octave > 6) {
    throw new RangeError("Invalid keyboard pitch");
  }
  const frequency = 440 * 2 ** ((octave - 4) - 9 / 12 + step / EDO);
  const pitch = Math.round(30720 - Math.log2(frequency / 16.333984375) * 3072);
  if (pitch < 0 || pitch > 30720) throw new RangeError("Pitch outside SunVox range");
  return { frequency, pitch };
}

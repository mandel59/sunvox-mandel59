import test from 'node:test';
import assert from 'node:assert/strict';
import {KEY_LAYOUT, EDO, toneForStep, formatStep, wrapStep} from '../src/tuning.js';

test('41 EDO grid preserves alternating +24/-17 horizontal steps and exact +13 diagonals', () => {
  assert.equal(new Set(KEY_LAYOUT.map(k => k.code)).size, KEY_LAYOUT.length);
  assert.equal(new Set(KEY_LAYOUT.map(k => ((k.step % EDO) + EDO) % EDO)).size, 41);
  for (const key of KEY_LAYOUT) {
    const right = KEY_LAYOUT.find(k => k.row === key.row && k.column === key.column + 1);
    const above = KEY_LAYOUT.find(k => k.row === key.row - 1 && k.column === key.column);
    if (right) {
      const delta = right.step - key.step;
      assert.ok(delta === 24 || delta === -17);
      const next = KEY_LAYOUT.find(k => k.row === key.row && k.column === key.column + 2);
      if (next) assert.equal(next.step - key.step, 7);
    }
    if (above) assert.equal(wrapStep(above.step - key.step), 30);
    const diagonal = KEY_LAYOUT.find(k => k.row === key.row - 1 && k.column === key.column + 1);
    if (diagonal) assert.equal(diagonal.step - key.step, 13);

  }
  assert.equal(KEY_LAYOUT.length, 55);
  assert.equal(KEY_LAYOUT.find(k => k.code === 'KeyX').step, 0);
  const steps = codes => codes.map(code => KEY_LAYOUT.find(k => k.code === code).step);
  assert.deepEqual(steps(['KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM','Comma','Period','Slash']), [17,0,24,7,31,14,38,21,45,28]);
  assert.deepEqual(steps(['KeyX','KeyD','KeyR','Digit5','F5']), [0,13,26,39,52]);
  assert.deepEqual(steps(Array.from({length:10}, (_, i) => 'F' + (i + 1))), [38,62,45,69,52,76,59,83,66,90]);
  const one = KEY_LAYOUT.find(k => k.code === 'Digit1'), f1 = KEY_LAYOUT.find(k => k.code === 'F1');
  assert.equal(f1.row, one.row - 1);
  assert.equal(f1.column, one.column + 1);
  assert.equal(f1.step - one.step, 13);
  assert.equal(formatStep(-9), '-9');
  for (const key of KEY_LAYOUT) for (const octave of [2, 6]) assert.ok(toneForStep(key.step, octave).frequency > 0);
});
test('tuning preserves octave ratios and sends fractional-semitone pitch', () => {
  const root = toneForStep(0);
  assert.ok(Math.abs(root.frequency - 261.6255653) < 0.00001);
  assert.equal(toneForStep(41).frequency, root.frequency * 2);
  assert.equal(toneForStep(0, 5).frequency, root.frequency * 2);
  for (let i = 0; i < 41; i++) {
    const a = toneForStep(i), b = toneForStep(i + 1);
    assert.ok(Math.abs(b.frequency / a.frequency - 2 ** (1 / 41)) < 1e-12);
    assert.ok(Math.abs((a.pitch - b.pitch) - 3072 / 41) < 1);
  }
  assert.throws(() => toneForStep(NaN));
  assert.throws(() => toneForStep(0, 9));
});

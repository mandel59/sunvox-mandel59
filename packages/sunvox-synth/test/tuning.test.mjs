import test from 'node:test';
import assert from 'node:assert/strict';
import {KEY_LAYOUT, EDO, toneForStep, formatStep} from '../src/tuning.js';

test('41 EDO grid preserves right +11 / up -9 translated intervals', () => {
  assert.equal(new Set(KEY_LAYOUT.map(k => k.code)).size, KEY_LAYOUT.length);
  assert.equal(new Set(KEY_LAYOUT.map(k => ((k.step % EDO) + EDO) % EDO)).size, 40);
  for (const key of KEY_LAYOUT) {
    const right = KEY_LAYOUT.find(k => k.row === key.row && k.column === key.column + 1);
    const above = KEY_LAYOUT.find(k => k.row === key.row - 1 && k.column === key.column);
    if (right) assert.equal(right.step - key.step, 11);
    if (above) assert.equal(above.step - key.step, -9);
  }
  assert.equal(KEY_LAYOUT.find(k => k.code === 'KeyZ').step, 0);
  assert.equal(KEY_LAYOUT.find(k => k.code === 'KeyD').step, 13);
  assert.equal(KEY_LAYOUT.find(k => k.code === 'KeyF').step, 24);
  assert.equal(KEY_LAYOUT.find(k => k.code === 'KeyA').step, -9);
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

import test from 'node:test';
import assert from 'node:assert/strict';
import {KEY_LAYOUT, EDO, PERFORMANCE_PRESETS, createKeyLayout, getPreset, toneForStep, formatStep} from '../src/tuning.js';

test('41 EDO grid preserves +17 horizontal steps and +7 upward-right diagonals', () => {
  assert.equal(new Set(KEY_LAYOUT.map(k => k.code)).size, KEY_LAYOUT.length);
  assert.equal(new Set(KEY_LAYOUT.map(k => ((k.step % EDO) + EDO) % EDO)).size, 21);
  for (const key of KEY_LAYOUT) {
    const right = KEY_LAYOUT.find(k => k.row === key.row && k.column === key.column + 1);
    const above = KEY_LAYOUT.find(k => k.row === key.row - 1 && k.column === key.column);
    if (right) assert.equal(right.step - key.step, 17);
    if (above) assert.equal(above.step - key.step, -10);
    const diagonal = KEY_LAYOUT.find(k => k.row === key.row - 1 && k.column === key.column + 1);
    if (diagonal) assert.equal(diagonal.step - key.step, 7);

  }
  assert.equal(KEY_LAYOUT.length, 55);
  assert.equal(KEY_LAYOUT.find(k => k.code === 'KeyX').step, 0);
  const steps = codes => codes.map(code => KEY_LAYOUT.find(k => k.code === code).step);
  assert.deepEqual(steps(['KeyZ','KeyX','KeyC','KeyV','KeyB','KeyN','KeyM','Comma','Period','Slash']), [-17,0,17,34,51,68,85,102,119,136]);
  assert.deepEqual(steps(['KeyX','KeyD','KeyR','Digit5','F5']), [0,7,14,21,28]);
  assert.deepEqual(steps(Array.from({length:10}, (_, i) => 'F' + (i + 1))), [-40,-23,-6,11,28,45,62,79,96,113]);
  const one = KEY_LAYOUT.find(k => k.code === 'Digit1'), f1 = KEY_LAYOUT.find(k => k.code === 'F1');
  assert.equal(f1.row, one.row - 1);
  assert.equal(f1.column, one.column + 1);
  assert.equal(f1.step - one.step, 7);
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

test('Wicki-Hayden variants place whole tones right and fourths upper-left of F', () => {
  for (const [edo, whole, fourth] of [[12, 2, 5], [19, 3, 8], [31, 5, 13], [41, 7, 17], [53, 9, 22]]) {
    const preset = getPreset(`${edo}edo-wicki-hayden`);
    const keys = createKeyLayout(preset);
    const step = code => keys.find(key => key.code === code).step;
    assert.equal(step('KeyF'), 0);
    assert.equal(step('KeyG'), whole);
    assert.equal(step('KeyR'), fourth);
    assert.equal(step('KeyT'), fourth + whole);
    for (const key of keys) {
      const right = keys.find(k => k.row === key.row && k.column === key.column + 1);
      const upperLeft = keys.find(k => k.row === key.row - 1 && k.column === key.column);
      if (right) assert.equal(right.step - key.step, whole);
      if (upperLeft) assert.equal(upperLeft.step - key.step, fourth);
    }
  }
});

test('every performance preset is playable across all supported octaves', () => {
  for (const tuning of PERFORMANCE_PRESETS) {
      const keys = createKeyLayout(tuning);
      assert.equal(keys.length, 55);
      assert.equal(new Set(keys.map(({ code }) => code)).size, 55);
      assert.equal(keys.find(({ code }) => code === tuning.rootCode).step, 0);
      assert.equal(toneForStep(tuning.edo, 4, tuning).frequency, toneForStep(0, 5, tuning).frequency);
      for (const key of keys) for (let octave = 2; octave <= 6; octave++) {
        const tone = toneForStep(key.step, octave, tuning);
        assert.ok(tone.pitch >= 0 && tone.pitch <= 30720);
      }
  }
  assert.throws(() => getPreset('missing'));
});

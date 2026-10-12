import assert from "node:assert/strict";
import test from "node:test";

import { buildContainer, parseContainer } from "../tools/sunvox-codec.mjs";
import { applySunVoxLibMusicDefaults } from "../tools/sunvox-music-recipe.mjs";
import { integratedLoudness, renderReviewImage } from "../tools/audio-review.mjs";
import { createRng, filter, osc, toWav16 } from "../tools/sample-synth.mjs";
import { applyMuteSolo, renderProjectAudio } from "../tools/sunvox-render-audio.mjs";
import { buildSamplerModules } from "../tools/sunvox-sampler-embed.mjs";
import { SongBuilder, Timeline, noteName, noteNumber } from "../tools/sunvox-song-builder.mjs";
import { decodeWav, encodeWav } from "../tools/wav-io.mjs";

function rms(values) {
  let sum = 0;
  for (const value of values) sum += value * value;
  return Math.sqrt(sum / values.length);
}

test("WAV codec round-trips 16-bit, 24-bit, and float samples", () => {
  const samples = Float32Array.from([0, 0.5, -0.5, 0.25, -1, 0.999]);
  for (const bitDepth of [16, 24, 32]) {
    const decoded = decodeWav(encodeWav(samples, { sampleRate: 44100, channels: 2, bitDepth }));
    assert.equal(decoded.sampleRate, 44100);
    assert.equal(decoded.channels, 2);
    const tolerance = bitDepth === 16 ? 1 / 16384 : 1 / 2 ** 21;
    samples.forEach((value, index) => assert.ok(Math.abs(decoded.samples[index] - value) <= tolerance, `${bitDepth}-bit #${index}`));
  }
});

test("sample synthesis is seeded and filters attenuate out-of-band content", () => {
  const first = createRng(79);
  const second = createRng(79);
  assert.deepEqual([first(), first(), first()], [second(), second(), second()]);
  const high = osc(0.2, 8000);
  const filtered = filter(high, "lowpass", 500);
  assert.ok(rms(filtered.slice(1000)) < rms(high) * 0.02);
  const wav = toWav16(osc(0.01, 440));
  assert.equal(wav.toString("latin1", 0, 4), "RIFF");
  assert.equal(decodeWav(wav).channels, 1);
});

test("integrated loudness follows BS.1770 for a stereo 997 Hz tone", () => {
  const sampleRate = 48000;
  const tone = osc(3, 997, { sampleRate });
  const half = Float64Array.from(tone, (value) => value * 0.5);
  assert.ok(Math.abs(integratedLoudness(tone, tone, sampleRate)) < 0.1);
  assert.ok(Math.abs(integratedLoudness(half, half, sampleRate) + 6.02) < 0.1);
  const silent = new Float64Array(sampleRate);
  assert.equal(integratedLoudness(silent, silent, sampleRate), Number.NEGATIVE_INFINITY);
});

test("review image is a PNG with spectrogram, waveform, and loudness lanes", () => {
  const sampleRate = 44100;
  const left = osc(1, 440);
  const stft = { frames: [{ time: 0.5, power: new Float32Array(2048) }], fftSize: 4096, hop: 1024, binHz: sampleRate / 4096 };
  const png = renderReviewImage({ left, right: left, sampleRate, stft, width: 64, barSeconds: 0.5, startSeconds: 0, labels: [[0, "A"]] });
  assert.deepEqual([...png.subarray(1, 4)], [0x50, 0x4e, 0x47]);
});

test("song builder names notes, fills controller defaults, and guards pattern cells", () => {
  assert.equal(noteNumber("Eb4"), noteNumber("D#4"));
  assert.equal(noteNumber("Cb5"), noteNumber("B4"));
  assert.equal(noteName(57), "A4");
  const song = new SongBuilder({ name: "test", bpm: 120 });
  song.addModule("amp", { type: "Amplifier", name: "Amp", controllers: { volume: 200 }, to: "output" });
  const document = song.build();
  assert.equal(document.modules[1].controllers.volume, 200);
  assert.equal(document.modules[1].controllers.dcOffset, 128);
  assert.deepEqual(document.modules[0].inputs, [{ slot: 0, module: 1 }]);

  const pattern = song.pattern({ name: "p", x: 0, y: 0, lines: 16, tracks: 1 });
  pattern.note({ line: 0, track: 0, note: "C4", module: "amp", gate: 4 });
  pattern.note({ line: 4, track: 0, note: "D4", module: "amp" });
  assert.equal(pattern.events.filter((event) => event.note === "noteOff").length, 0);
  assert.throws(() => pattern.note({ line: 4, track: 0, note: "E4", module: "amp" }), /cell already used/u);
});

test("timeline places note-offs in the next section pattern on the same lane", () => {
  const song = new SongBuilder({ name: "test", bpm: 120 });
  song.addModule("amp", { type: "Amplifier", name: "Amp", to: "output" });
  const timeline = new Timeline(song, {
    sections: [{ key: "a", name: "A", start: 0, bars: 1 }, { key: "b", name: "B", start: 1, bars: 1 }],
    lanes: [{ key: "lane", name: "Lane", y: 0, tracks: 1 }],
  });
  timeline.note("lane", 12, { track: 0, note: "C4", module: "amp", gate: 8 });
  const [first, second] = song.patterns;
  assert.deepEqual(first.events.map((event) => [event.line, event.note]), [[12, "C4"]]);
  assert.deepEqual(second.events.map((event) => [event.line, event.note]), [[4, "noteOff"]]);
  assert.deepEqual(first.flags, { noNotesOff: true });
});

test("sampler embedding loads WAV data, note maps, and base-note compensation", async () => {
  const wav = toWav16(osc(0.05, 440));
  const [module] = await buildSamplerModules([
    { name: "Two", samples: [{ wav }, { wav, baseNote: "D5" }], noteMap: [["D5", "B9", 1]] },
  ]);
  assert.equal(module.type, "Sampler");
  const instrument = module.dataChunks.find((chunk) => chunk.name === "instrument").instrument;
  assert.equal(instrument.samples, 2);
  assert.equal(instrument.sampleMap[noteNumber("C5")], 0);
  assert.equal(instrument.sampleMap[noteNumber("D5")], 1);
  const samples = module.dataChunks.filter((chunk) => chunk.name === "sample").map((chunk) => chunk.sample);
  assert.equal(samples[0].relativeNote - samples[1].relativeNote, 2);
  assert.equal(module.inputs, undefined);
});

test("offline renders support controller overrides, mute, and loop playback", async () => {
  const song = new SongBuilder({ name: "render", bpm: 120 });
  song.addModule("gen", { type: "Analog generator", name: "Gen", controllers: { waveform: "sin", filter: "off" }, to: "output" });
  const pattern = song.pattern({ name: "p", x: 0, y: 0, lines: 8, tracks: 1 });
  pattern.note({ line: 0, track: 0, note: "A4", module: "gen", velocity: 100 });
  const bytes = buildContainer(applySunVoxLibMusicDefaults(song.build()));

  const louder = parseContainer(applyMuteSolo(bytes, { set: ["Gen.volume=160"] }));
  assert.equal(louder.modules[1].controllers.volume, 160);
  const muted = await renderProjectAudio(applyMuteSolo(bytes, { mute: ["Gen"] }), { durationSeconds: 0.5 });
  assert.equal(rms(muted.samples), 0);

  const once = await renderProjectAudio(bytes, { tailSeconds: 0 });
  assert.ok(Math.abs(once.songSeconds - 1) < 0.01);
  const looped = await renderProjectAudio(bytes, { durationSeconds: 1.6, loop: true });
  const frame = Math.round(1.2 * looped.sampleRate) * looped.channels;
  assert.ok(rms(looped.samples.subarray(frame, frame + 2000)) > 0.01, "loop restarts the note");
});

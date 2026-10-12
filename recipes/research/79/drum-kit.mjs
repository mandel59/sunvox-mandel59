// @ts-check
// Procedurally synthesized one-shots for "Midnight Loop Line" (#79).
// Every sound is generated from seeded DSP so the recipe stays reproducible;
// no recorded audio is used.

import {
  createRng,
  expDecay,
  fadeOut,
  filter,
  frames,
  mix,
  multiply,
  noise,
  normalize,
  osc,
  reverse,
  room,
  segments,
  silence,
  softClip,
} from "../../../tools/sample-synth.mjs";

const TR808_METAL_HZ = [205.3, 304.4, 369.6, 522.7, 540.0, 800.0];

function metalBank(seconds, scale = 1, seed = 1) {
  const rng = createRng(seed);
  const length = frames(seconds);
  const out = new Float64Array(length);
  for (const hz of TR808_METAL_HZ) {
    const tone = osc(seconds, hz * scale, { shape: "square", phase: rng() });
    for (let i = 0; i < length; i += 1) out[i] += tone[i] / TR808_METAL_HZ.length;
  }
  return out;
}

export function kick() {
  const seconds = 0.62;
  const length = frames(seconds);
  const body = osc(seconds, (t) => 52 + 120 * Math.exp(-t / 0.03) + 260 * Math.exp(-t / 0.0045));
  const bodyEnv = expDecay(length, 0.15, { attackSeconds: 0.0006, holdSeconds: 0.024 });
  const knock = filter(osc(seconds, (t) => 120 + 90 * Math.exp(-t / 0.01)), "lowpass", 400);
  const knockEnv = expDecay(length, 0.03);
  const click = filter(noise(0.02, 11), "highpass", 2500);
  const clickEnv = expDecay(click.length, 0.0025);
  const raw = mix(
    length,
    [multiply(body, bodyEnv), 1],
    [multiply(knock, knockEnv), 0.35],
    [multiply(click, clickEnv), 0.22],
  );
  return fadeOut(normalize(softClip(raw, 1.6), 0.97), 0.05);
}

export function snare({ seed = 21, tone = 1 } = {}) {
  const seconds = 0.42;
  const length = frames(seconds);
  const shell = mix(
    length,
    [multiply(osc(seconds, (t) => 190 * tone * (1 + 0.18 * Math.exp(-t / 0.012))), expDecay(length, 0.055)), 0.9],
    [multiply(osc(seconds, (t) => 335 * tone * (1 + 0.1 * Math.exp(-t / 0.01))), expDecay(length, 0.035)), 0.45],
  );
  const wires = filter(filter(noise(seconds, seed), "highpass", 1400), "peak", 5200, { q: 0.8, gainDb: 6 });
  const wiresEnv = expDecay(length, 0.105, { attackSeconds: 0.0008 });
  const crack = filter(noise(0.03, seed + 1), "bandpass", 2600, { q: 0.9 });
  const raw = mix(length, [shell, 0.85], [multiply(wires, wiresEnv), 0.62], [multiply(crack, expDecay(crack.length, 0.004)), 0.8]);
  const roomy = room(softClip(raw, 1.3), { seconds: 0.35, decay: 0.42, damp: 0.5, wet: 0.32, seed });
  return fadeOut(normalize(roomy, 0.95), 0.08);
}

export function clap() {
  const seconds = 0.5;
  const length = frames(seconds);
  const source = filter(filter(noise(seconds, 31), "bandpass", 1150, { q: 1.1 }), "highpass", 550);
  const envelope = new Float64Array(length);
  for (const [offset, gain] of [[0, 1], [0.0095, 0.85], [0.0185, 0.9], [0.0285, 1]]) {
    const start = frames(offset);
    for (let i = start; i < length; i += 1) envelope[i] += gain * Math.exp(-(i - start) / (0.0042 * 44100)) * (i - start < 2 ? 0.5 : 1);
  }
  const tailStart = frames(0.0285);
  for (let i = tailStart; i < length; i += 1) envelope[i] += 0.55 * Math.exp(-(i - tailStart) / (0.085 * 44100));
  const roomy = room(multiply(source, envelope), { seconds: 0.3, decay: 0.38, damp: 0.45, wet: 0.35, seed: 33 });
  return fadeOut(normalize(roomy, 0.92), 0.08);
}

function hat(seconds, tau, { seed, centerHz = 9500, lowHz = 7000, sizzle = 0.35 } = {}) {
  const length = frames(seconds);
  const metal = filter(filter(metalBank(seconds, 1.0, seed), "bandpass", centerHz, { q: 0.9 }), "highpass", lowHz);
  const air = filter(noise(seconds, seed + 5), "highpass", 9000);
  const env = expDecay(length, tau, { attackSeconds: 0.0004 });
  return fadeOut(normalize(mix(length, [multiply(metal, env), 1], [multiply(air, env), sizzle]), 0.9), Math.min(0.03, seconds / 3));
}

export const closedHat = () => hat(0.13, 0.022, { seed: 41 });
export const openHat = () => hat(0.75, 0.2, { seed: 43, sizzle: 0.45 });
export const pedalHat = () => hat(0.09, 0.011, { seed: 47, centerHz: 7200, lowHz: 5200, sizzle: 0.2 });

export function shaker({ seed = 51, attack = 0.022 } = {}) {
  const seconds = 0.16;
  const length = frames(seconds);
  const grains = filter(filter(noise(seconds, seed), "bandpass", 6800, { q: 1.4 }), "highpass", 4200);
  const env = segments(length, [[0, 0], [attack, 1], [attack + 0.012, 0.55], [seconds, 0]]);
  return normalize(multiply(grains, env), 0.85);
}

export function tambourine() {
  const seconds = 0.38;
  const length = frames(seconds);
  const rng = createRng(61);
  const jingles = new Float64Array(length);
  for (const hz of [4120, 5630, 7310, 9180, 10950, 12400]) {
    const tone = osc(seconds, hz * (0.995 + rng() * 0.01), { phase: rng() });
    const env = expDecay(length, 0.06 + rng() * 0.06);
    for (let i = 0; i < length; i += 1) jingles[i] += tone[i] * env[i] / 6;
  }
  // Jingle collisions: a few short retriggers right after the hit.
  const bursts = new Float64Array(length);
  for (const offset of [0, 0.011, 0.024, 0.041]) {
    const start = frames(offset);
    for (let i = start; i < length; i += 1) bursts[i] += Math.exp(-(i - start) / (0.006 * 44100));
  }
  const hiss = filter(noise(seconds, 63), "highpass", 6500);
  const out = mix(length, [multiply(jingles, bursts), 1], [multiply(hiss, expDecay(length, 0.08)), 0.5]);
  return fadeOut(normalize(out, 0.85), 0.05);
}

export function tom() {
  const seconds = 0.7;
  const length = frames(seconds);
  const body = osc(seconds, (t) => 110 * (1 + 0.45 * Math.exp(-t / 0.035)));
  const head = filter(noise(0.04, 71), "lowpass", 1500);
  const out = mix(length, [multiply(body, expDecay(length, 0.22, { attackSeconds: 0.0008 })), 1], [multiply(head, expDecay(head.length, 0.006)), 0.4]);
  return fadeOut(normalize(room(softClip(out, 1.2), { seconds: 0.3, wet: 0.2, seed: 73 }), 0.95), 0.1);
}

export function crash({ seed = 81, seconds = 3.4 } = {}) {
  const length = frames(seconds);
  const rng = createRng(seed);
  // Ring-modulated metal banks give a dense inharmonic cluster.
  const a = metalBank(seconds, 2.73, seed);
  const b = metalBank(seconds, 4.11, seed + 1);
  const ring = new Float64Array(length);
  for (let i = 0; i < length; i += 1) ring[i] = a[i] * b[i];
  const partials = new Float64Array(length);
  for (let k = 0; k < 28; k += 1) {
    const hz = 2800 + rng() * 9000;
    const tone = osc(seconds, hz, { phase: rng() });
    const env = expDecay(length, 0.5 + rng() * 1.2);
    for (let i = 0; i < length; i += 1) partials[i] += (tone[i] * env[i]) / 28;
  }
  const wash = filter(filter(noise(seconds, seed + 2), "highpass", 3200), "peak", 7500, { q: 0.6, gainDb: 4 });
  const env = expDecay(length, 0.95, { attackSeconds: 0.002 });
  const strike = expDecay(length, 0.05);
  const body = mix(length, [ring, 0.8], [partials, 1.4], [wash, 0.5]);
  const shaped = new Float64Array(length);
  for (let i = 0; i < length; i += 1) shaped[i] = body[i] * (0.75 * env[i] + 0.6 * strike[i]);
  // Two high-pass stages keep the ring-mod products below 1 kHz from clanging.
  return fadeOut(normalize(filter(filter(shaped, "highpass", 2600), "highpass", 1800), 0.85), 0.6);
}

export function reverseCymbal(seconds = 2.2) {
  const swell = reverse(crash({ seed: 91, seconds }));
  return normalize(multiply(swell, segments(swell.length, [[0, 0], [seconds * 0.72, 0.8], [seconds - 0.03, 1], [seconds, 0]])), 0.8);
}

export function snap() {
  const seconds = 0.25;
  const length = frames(seconds);
  const pop = filter(noise(seconds, 101), "bandpass", 2300, { q: 2.2 });
  const click = filter(noise(0.006, 103), "highpass", 4000);
  const out = mix(length, [multiply(pop, expDecay(length, 0.022, { attackSeconds: 0.0005 })), 1], [click, 0.4]);
  return normalize(room(out, { seconds: 0.25, wet: 0.35, seed: 105 }), 0.85);
}

// Japanese level-crossing bell strike ("kan"), alternated in the pattern.
export function crossingBell() {
  const seconds = 0.9;
  const length = frames(seconds);
  const out = new Float64Array(length);
  for (const [ratio, gain, tau] of [[1, 1, 0.42], [2.41, 0.55, 0.22], [3.93, 0.35, 0.14], [5.4, 0.22, 0.09], [7.2, 0.12, 0.05]]) {
    const tone = osc(seconds, 698 * ratio);
    const env = expDecay(length, tau, { attackSeconds: 0.0008 });
    for (let i = 0; i < length; i += 1) out[i] += tone[i] * env[i] * gain;
  }
  return fadeOut(normalize(out, 0.8), 0.1);
}

// A commuter train passing: rail rumble plus "ta-tan ta-tan" joint clicks.
export function passingTrain() {
  const seconds = 7.5;
  const length = frames(seconds);
  const swell = segments(length, [[0, 0], [2.6, 0.55], [3.8, 1], [5.2, 0.6], [7.5, 0]]);
  const rumble = filter(filter(noise(seconds, 111), "lowpass", (t) => 180 + 260 * Math.max(0, 1 - Math.abs(t - 3.8) / 3.8)), "lowpass", 600);
  const hiss = filter(noise(seconds, 113), "bandpass", (t) => 1600 + 900 * Math.max(0, 1 - Math.abs(t - 3.8) / 3), { q: 0.5 });
  const clicks = silence(seconds);
  const thump = multiply(filter(noise(0.06, 115), "lowpass", 900), expDecay(frames(0.06), 0.012));
  for (let car = 0; car < 9; car += 1) {
    const carStart = 0.45 + car * 0.78;
    for (const offset of [0, 0.11, 0.55, 0.66]) {
      const start = frames(carStart + offset);
      for (let i = 0; i < thump.length && start + i < length; i += 1) clicks[start + i] += thump[i];
    }
  }
  const out = mix(length, [rumble, 1.1], [hiss, 0.25], [clicks, 0.9]);
  return fadeOut(normalize(multiply(out, swell), 0.8), 0.5);
}

export function drumKitSamples({ barSeconds = 2.2 } = {}) {
  return {
    kick: kick(),
    snare: snare(),
    snareGhost: snare({ seed: 25, tone: 1.06 }),
    clap: clap(),
    closedHat: closedHat(),
    openHat: openHat(),
    pedalHat: pedalHat(),
    shaker: shaker(),
    shakerBack: shaker({ seed: 53, attack: 0.045 }),
    tambourine: tambourine(),
    tom: tom(),
    crash: crash(),
    reverseCymbal: reverseCymbal(barSeconds),
    snap: snap(),
    crossingBell: crossingBell(),
    passingTrain: passingTrain(),
  };
}

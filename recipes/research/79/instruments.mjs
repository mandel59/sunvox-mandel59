// @ts-check
// Synth patches for "Midnight Loop Line" (#79): a DX-style tine piano and
// slap-ish FM bass on FMX, analog brass/strings/leads, and an offline
// Karplus-Strong guitar sample for funk cutting.

import { createRng, expDecay, fadeOut, filter, frames, multiply, normalize } from "../../../tools/sample-synth.mjs";

function op(overrides) {
  return {
    volume: 0,
    attack: 0,
    decay: 100,
    sustainLevel: 0,
    release: 100,
    attackCurve: "linear",
    decayCurve: "exp2",
    releaseCurve: "exp1",
    sustain: "off",
    sustainPedal: "off",
    envScaling: 128,
    volumeScaling: 128,
    velocitySensitivity: 192,
    waveform: "sin",
    noise: 0,
    phase: 0,
    freqMul: 1000,
    constPitch: 8192,
    selfMod: 0,
    feedback: 0,
    modulationType: "phase",
    ...overrides,
  };
}

// FMX routing: operator k may feed any later operator or the main output.
// outputMode bit b sends to operator (5 - b); bit 0 is the main output.
const TO_OUT = 1;
const TO_OP = (target) => 1 << (5 - target);

export function tinePiano() {
  return {
    type: "FMX",
    name: "Loop Line Tines",
    color: "#7fc8ff",
    controllers: {
      volume: 3600,
      panning: 146,
      sampleRate: "native",
      polyphony: 12,
      channels: "stereo",
      inputToOperator: 0,
      inputToCustomWave: "off",
      adsrSmoothTransitions: "restartVolumeChange",
      noiseFilter: 32768,
      envelopeGain: 1000,
      operators: [
        // Tine: a 14x modulator that decays fast, giving the bell-like ping.
        op({ volume: 9400, attack: 0, decay: 300, sustain: "off", freqMul: 14000, velocitySensitivity: 176, envScaling: 150, outputMode: TO_OP(2) }),
        // Body: a 1x modulator that slowly mellows the tone.
        op({ volume: 9800, attack: 0, decay: 1700, sustainLevel: 2600, sustain: "on", release: 260, freqMul: 1000, velocitySensitivity: 176, envScaling: 140, outputMode: TO_OP(3) }),
        op({ volume: 15000, attack: 1, decay: 2300, sustainLevel: 0, sustain: "on", release: 320, freqMul: 1003, envScaling: 150, velocitySensitivity: 176, outputMode: TO_OUT }),
        op({ volume: 26000, attack: 1, decay: 5200, sustainLevel: 7000, sustain: "on", release: 360, freqMul: 997, envScaling: 140, velocitySensitivity: 150, outputMode: TO_OUT }),
        op({ volume: 3200, attack: 1, decay: 1500, sustainLevel: 0, sustain: "on", release: 300, freqMul: 2000, envScaling: 150, velocitySensitivity: 200 }),
      ],
    },
  };
}

export function fmBass() {
  return {
    type: "FMX",
    name: "Lately Pop Bass",
    color: "#5dd39e",
    controllers: {
      volume: 14500,
      panning: 128,
      sampleRate: "native",
      polyphony: 2,
      channels: "mono",
      inputToOperator: 0,
      inputToCustomWave: "off",
      adsrSmoothTransitions: "restartVolumeChange",
      noiseFilter: 32768,
      envelopeGain: 1000,
      operators: [
        // 1x index: the sustained growl that carries on small speakers.
        op({ volume: 17000, attack: 0, decay: 260, sustainLevel: 7200, sustain: "on", release: 60, freqMul: 1000, velocitySensitivity: 236, outputMode: TO_OP(4) }),
        // 3x pop: the slap transient.
        op({ volume: 9000, attack: 0, decay: 70, sustainLevel: 0, sustain: "off", freqMul: 3000, velocitySensitivity: 250, outputMode: TO_OP(4) }),
        op({ volume: 6000, attack: 1, decay: 900, sustainLevel: 20000, sustain: "on", release: 70, freqMul: 1000, velocitySensitivity: 120, outputMode: TO_OUT }),
        // 2x body: adds the octave-harmonic "knock" under the pop.
        op({ volume: 5200, attack: 0, decay: 160, sustainLevel: 1800, sustain: "on", release: 60, freqMul: 2000, velocitySensitivity: 220, outputMode: TO_OP(4) }),
        // Carrier self-modulation gives the DX-style saw edge (2500 keeps the fundamental solid).
        op({ volume: 24000, attack: 1, decay: 500, sustainLevel: 21000, sustain: "on", release: 70, freqMul: 1000, selfMod: 2500, velocitySensitivity: 150 }),
      ],
    },
  };
}

export function glassBell() {
  return {
    type: "FMX",
    name: "Neon Glass Bell",
    color: "#e6d2ff",
    controllers: {
      volume: 19000,
      panning: 128,
      sampleRate: "native",
      polyphony: 8,
      channels: "stereo",
      inputToOperator: 0,
      inputToCustomWave: "off",
      adsrSmoothTransitions: "restartVolumeChange",
      noiseFilter: 32768,
      envelopeGain: 1000,
      operators: [
        op({ volume: 9000, decay: 900, sustain: "off", freqMul: 3500, velocitySensitivity: 220, outputMode: TO_OP(4) }),
        op({ volume: 5000, decay: 300, sustain: "off", freqMul: 7000, velocitySensitivity: 220, outputMode: TO_OP(3) }),
        op({ outputMode: 0 }),
        op({ volume: 9000, attack: 1, decay: 700, sustain: "off", release: 200, freqMul: 4000, outputMode: TO_OUT }),
        op({ volume: 22000, attack: 1, decay: 2200, sustain: "off", release: 600, freqMul: 1000 }),
      ],
    },
  };
}

function analog(overrides) {
  return {
    volume: 80,
    waveform: "saw",
    panning: 128,
    attack: 0,
    release: 40,
    sustain: "on",
    expEnvelope: "on",
    dutyCycle: 512,
    osc2Pitch: 1000,
    filter: "lp24db",
    filterFreq: 14000,
    filterResonance: 0,
    filterExpFreq: "on",
    filterAttack: 0,
    filterRelease: 0,
    filterEnvelope: "off",
    polyphony: 8,
    mode: "hq",
    noise: 0,
    osc2Volume: 32768,
    osc2Mode: "add",
    osc2Phase: 0,
    ...overrides,
  };
}

export function synthBrass() {
  return {
    type: "Analog generator",
    name: "Shuto Brass",
    color: "#ffb347",
    controllers: analog({
      volume: 116, waveform: "saw", attack: 6, release: 46, osc2Pitch: 1006, osc2Volume: 26000,
      filter: "lp24db", filterFreq: 7200, filterResonance: 160, filterAttack: 18, filterRelease: 60,
      filterEnvelope: "sustainOn", polyphony: 8,
    }),
  };
}

export function stringPad() {
  return {
    type: "Analog generator",
    name: "Afterglow Strings",
    color: "#ff8fb1",
    controllers: analog({
      volume: 44, waveform: "saw", attack: 70, release: 90, osc2Pitch: 1005, osc2Volume: 30000,
      filter: "lp12db", filterFreq: 4200, filterResonance: 80, polyphony: 10,
    }),
  };
}

// Detuned saw source for the formant "aah" choir layer.
export function choirSource() {
  return {
    type: "Analog generator",
    name: "Night Choir Source",
    color: "#f5c2ff",
    controllers: analog({
      volume: 112, waveform: "saw", attack: 90, release: 110, osc2Pitch: 1009, osc2Volume: 30000,
      filter: "lp12db", filterFreq: 3800, filterResonance: 0, polyphony: 10, noise: 10,
    }),
  };
}

export function leadSynth() {
  return {
    type: "Analog generator",
    name: "Loop Line Lead",
    color: "#ff5ea8",
    controllers: analog({
      volume: 156, waveform: "saw", attack: 3, release: 34, dutyCycle: 380, osc2Pitch: 1004, osc2Volume: 20000,
      osc2Mode: "add", filter: "lp24db", filterFreq: 6800, filterResonance: 260, filterAttack: 6, filterRelease: 70,
      filterEnvelope: "sustainOn", polyphony: 1, mode: "hqMono",
    }),
  };
}

export function softLead() {
  return {
    type: "Analog generator",
    name: "Platform Whistle",
    color: "#9fe8ff",
    controllers: analog({
      volume: 96, waveform: "triangle", attack: 12, release: 60, osc2Pitch: 1768, osc2Volume: 5200,
      filter: "lp12db", filterFreq: 5200, filterResonance: 40, polyphony: 1, mode: "hqMono", noise: 6,
    }),
  };
}

// Offline Karplus-Strong string, used as a pitched Sampler source.
export function karplusGuitar({ hz = 261.6256, seconds = 1.6, damping = 0.996, brightness = 0.5, seed = 201, mute = false } = {}) {
  const rng = createRng(seed);
  const length = frames(seconds);
  // Loop delay = buffer size - interpolation fraction + 0.5 (averaging filter).
  const loopDelay = 44100 / hz - 0.5;
  const size = Math.ceil(loopDelay);
  const frac = size - loopDelay;
  const line = new Float64Array(size);
  // Pick excitation: filtered noise burst with a pick position comb.
  let previous = 0;
  for (let i = 0; i < line.length; i += 1) {
    const white = rng() * 2 - 1;
    previous = previous + brightness * (white - previous);
    line[i] = previous;
  }
  const pickOffset = Math.max(1, Math.round(size * 0.18));
  const excitation = line.map((value, i) => value - line[(i + pickOffset) % line.length] * 0.6);
  const out = new Float64Array(length);
  const buffer = Float64Array.from(excitation);
  let index = 0;
  let last = 0;
  const loss = mute ? 0.93 : damping;
  for (let i = 0; i < length; i += 1) {
    const a = buffer[index];
    const b = buffer[(index + 1) % buffer.length];
    // Fractional delay by linear interpolation keeps tuning accurate.
    const sample = a + (b - a) * frac;
    const averaged = 0.5 * (sample + last);
    last = sample;
    out[i] = sample;
    buffer[index] = averaged * loss;
    index = (index + 1) % buffer.length;
  }
  const body = filter(filter(out, "peak", 180, { q: 1.2, gainDb: 4 }), "highpass", 90);
  const toned = mute ? filter(body, "lowpass", 2400) : filter(body, "highshelf", 3000, { gainDb: -3 });
  const env = expDecay(length, mute ? 0.06 : 0.9, { attackSeconds: 0.0005 });
  return fadeOut(normalize(multiply(toned, env), 0.9), mute ? 0.05 : 0.2);
}

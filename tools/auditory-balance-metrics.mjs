const DEFAULT_FFT_SIZE = 2048;
const DEFAULT_HOP_SIZE = 512;
const DEFAULT_BAND_COUNT = 32;
const DEFAULT_MIN_HZ = 50;
const DEFAULT_MAX_HZ = 16000;
const LOUDNESS_EXPONENT = 0.23;
const ACTIVE_GATE_DB = -18;
const AUDIBILITY_RATIO_THRESHOLD = 0.25;
const EPSILON = 1e-30;

export const AUDITORY_BALANCE_MODEL = Object.freeze({
  id: "erb-partial-loudness-proxy-v1",
  standardConformance: "none",
  calibration: {
    calibrated: false,
    scale: "relative-digital",
    note: "Values are relative proxies, not ISO 532 loudness or standardized sones.",
  },
  auditoryBands: "triangular ERB-rate filterbank",
  partialMethod: "positive specific-loudness difference between full and leave-one-out excitation",
  loudnessExponent: LOUDNESS_EXPONENT,
  activeGateDb: ACTIVE_GATE_DB,
  audibilityRatioThreshold: AUDIBILITY_RATIO_THRESHOLD,
});

export function hzToErbRate(frequencyHz) {
  return 21.4 * Math.log10(1 + 0.00437 * Math.max(0, frequencyHz));
}

export function erbRateToHz(erbRate) {
  return (10 ** (erbRate / 21.4) - 1) / 0.00437;
}

function fft(real, imaginary) {
  const size = real.length;
  for (let index = 1, reverse = 0; index < size; index += 1) {
    let bit = size >> 1;
    for (; reverse & bit; bit >>= 1) reverse ^= bit;
    reverse ^= bit;
    if (index < reverse) {
      [real[index], real[reverse]] = [real[reverse], real[index]];
      [imaginary[index], imaginary[reverse]] = [imaginary[reverse], imaginary[index]];
    }
  }
  for (let length = 2; length <= size; length <<= 1) {
    const angle = (-2 * Math.PI) / length;
    const stepReal = Math.cos(angle);
    const stepImaginary = Math.sin(angle);
    for (let start = 0; start < size; start += length) {
      let weightReal = 1;
      let weightImaginary = 0;
      for (let offset = 0; offset < length / 2; offset += 1) {
        const even = start + offset;
        const odd = even + length / 2;
        const oddReal = real[odd] * weightReal - imaginary[odd] * weightImaginary;
        const oddImaginary = real[odd] * weightImaginary + imaginary[odd] * weightReal;
        real[odd] = real[even] - oddReal;
        imaginary[odd] = imaginary[even] - oddImaginary;
        real[even] += oddReal;
        imaginary[even] += oddImaginary;
        const nextReal = weightReal * stepReal - weightImaginary * stepImaginary;
        weightImaginary = weightReal * stepImaginary + weightImaginary * stepReal;
        weightReal = nextReal;
      }
    }
  }
}

function assertPowerOfTwo(value, name) {
  if (!Number.isInteger(value) || value < 2 || (value & (value - 1)) !== 0) {
    throw new Error(`${name} must be a power of two >= 2`);
  }
}

export function createErbFilterbank(sampleRate, options = {}) {
  const fftSize = options.fftSize ?? DEFAULT_FFT_SIZE;
  const bandCount = options.bandCount ?? DEFAULT_BAND_COUNT;
  const minimumHz = options.minimumHz ?? DEFAULT_MIN_HZ;
  const maximumHz = Math.min(options.maximumHz ?? DEFAULT_MAX_HZ, sampleRate / 2);
  assertPowerOfTwo(fftSize, "fftSize");
  if (!Number.isInteger(bandCount) || bandCount < 2) throw new Error("bandCount must be an integer >= 2");
  if (!(sampleRate > 0) || !(minimumHz >= 0) || !(maximumHz > minimumHz)) {
    throw new Error("invalid sample rate or auditory frequency range");
  }

  const minimumErb = hzToErbRate(minimumHz);
  const maximumErb = hzToErbRate(maximumHz);
  const edgeErb = Array.from(
    { length: bandCount + 2 },
    (_, index) => minimumErb + ((maximumErb - minimumErb) * index) / (bandCount + 1),
  );
  const edgeHz = edgeErb.map(erbRateToHz);
  const binCount = fftSize / 2 + 1;
  const bands = [];
  for (let bandIndex = 0; bandIndex < bandCount; bandIndex += 1) {
    const lowerErb = edgeErb[bandIndex];
    const centerErb = edgeErb[bandIndex + 1];
    const upperErb = edgeErb[bandIndex + 2];
    const weights = [];
    for (let bin = 1; bin < binCount; bin += 1) {
      const frequencyHz = (bin * sampleRate) / fftSize;
      const erb = hzToErbRate(frequencyHz);
      let weight = 0;
      if (erb >= lowerErb && erb <= centerErb) weight = (erb - lowerErb) / (centerErb - lowerErb);
      else if (erb > centerErb && erb <= upperErb) weight = (upperErb - erb) / (upperErb - centerErb);
      if (weight > 0) weights.push({ bin, weight });
    }
    bands.push({
      index: bandIndex,
      lowerHz: edgeHz[bandIndex],
      centerHz: edgeHz[bandIndex + 1],
      upperHz: edgeHz[bandIndex + 2],
      weights,
    });
  }
  return { sampleRate, fftSize, bandCount, minimumHz, maximumHz, bands };
}

function frameBandPowers(samples, channels, startFrame, filterbank) {
  const { fftSize, bands } = filterbank;
  const binPowers = new Float64Array(fftSize / 2 + 1);
  for (let channel = 0; channel < channels; channel += 1) {
    const real = new Float64Array(fftSize);
    const imaginary = new Float64Array(fftSize);
    for (let index = 0; index < fftSize; index += 1) {
      const window = 0.5 - 0.5 * Math.cos((2 * Math.PI * index) / (fftSize - 1));
      real[index] = (samples[(startFrame + index) * channels + channel] ?? 0) * window;
    }
    fft(real, imaginary);
    for (let bin = 1; bin < binPowers.length; bin += 1) {
      binPowers[bin] += real[bin] ** 2 + imaginary[bin] ** 2;
    }
  }
  const normalization = 1 / (fftSize * fftSize * channels);
  return Float64Array.from(bands, (band) =>
    band.weights.reduce((total, item) => total + binPowers[item.bin] * item.weight, 0) * normalization,
  );
}

export function analyzeAuditoryFrames(samples, channels, sampleRate, options = {}) {
  const fftSize = options.fftSize ?? DEFAULT_FFT_SIZE;
  const hopSize = options.hopSize ?? DEFAULT_HOP_SIZE;
  const filterbank = options.filterbank ?? createErbFilterbank(sampleRate, { ...options, fftSize });
  if (!Number.isInteger(channels) || channels < 1) throw new Error("channels must be a positive integer");
  if (!Number.isInteger(hopSize) || hopSize < 1) throw new Error("hopSize must be a positive integer");
  const frameCount = Math.floor(samples.length / channels);
  const frames = [];
  for (let startFrame = 0; startFrame < frameCount; startFrame += hopSize) {
    const bandPowers = frameBandPowers(samples, channels, startFrame, filterbank);
    frames.push({
      startFrame,
      centerSeconds: (startFrame + fftSize / 2) / sampleRate,
      bandPowers,
    });
  }
  return {
    sampleRate,
    channels,
    fftSize,
    hopSize,
    filterbank,
    frames,
  };
}

function specificLoudnessProxy(power) {
  return Math.max(0, power) ** LOUDNESS_EXPONENT;
}

export function computePartialLoudnessFrames(fullAnalysis, maskerAnalysis, soloAnalysis) {
  const count = Math.min(fullAnalysis.frames.length, maskerAnalysis.frames.length, soloAnalysis.frames.length);
  const frames = [];
  for (let index = 0; index < count; index += 1) {
    const full = fullAnalysis.frames[index];
    const masker = maskerAnalysis.frames[index];
    const solo = soloAnalysis.frames[index];
    const bandCount = Math.min(full.bandPowers.length, masker.bandPowers.length, solo.bandPowers.length);
    let partialLoudnessProxy = 0;
    let soloLoudnessProxy = 0;
    for (let band = 0; band < bandCount; band += 1) {
      const fullSpecific = specificLoudnessProxy(full.bandPowers[band]);
      const maskerSpecific = specificLoudnessProxy(masker.bandPowers[band]);
      partialLoudnessProxy += Math.max(0, fullSpecific - maskerSpecific);
      soloLoudnessProxy += specificLoudnessProxy(solo.bandPowers[band]);
    }
    const audibilityRatio = soloLoudnessProxy > 0
      ? Math.max(0, Math.min(1, partialLoudnessProxy / soloLoudnessProxy))
      : 0;
    frames.push({
      index,
      centerSeconds: full.centerSeconds,
      soloLoudnessProxy,
      partialLoudnessProxy,
      partialLevelDb: 10 * Math.log10(Math.max(EPSILON, partialLoudnessProxy)),
      maskingLossDb: 10 * Math.log10(Math.max(EPSILON, soloLoudnessProxy) / Math.max(EPSILON, partialLoudnessProxy)),
      audibilityRatio,
    });
  }
  return frames;
}

export function quantile(values, probability) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return Number.NaN;
  const position = Math.max(0, Math.min(1, probability)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const fraction = position - lower;
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

export function summarizePartialLoudnessWindow(frames, startSeconds, endSeconds, options = {}) {
  const maximumSolo = Math.max(EPSILON, ...frames.map((frame) => frame.soloLoudnessProxy));
  const activeThreshold = maximumSolo * 10 ** ((options.activeGateDb ?? ACTIVE_GATE_DB) / 10);
  const active = frames.filter((frame) =>
    frame.centerSeconds >= startSeconds &&
    frame.centerSeconds < endSeconds &&
    frame.soloLoudnessProxy >= activeThreshold,
  );
  const partial = active.map((frame) => frame.partialLoudnessProxy);
  const solo = active.map((frame) => frame.soloLoudnessProxy);
  const masking = active.map((frame) => frame.maskingLossDb);
  const ratios = active.map((frame) => frame.audibilityRatio);
  const threshold = options.audibilityRatioThreshold ?? AUDIBILITY_RATIO_THRESHOLD;
  return {
    activeFrameCount: active.length,
    soloLoudnessProxy: quantile(solo, 0.5),
    partialLoudnessProxy: quantile(partial, 0.5),
    partialLevelDb: 10 * Math.log10(Math.max(EPSILON, quantile(partial, 0.5))),
    maskingLossDb: quantile(masking, 0.5),
    audibilityFraction: active.length
      ? ratios.filter((ratio) => ratio >= threshold).length / active.length
      : 0,
    quantiles: {
      partialLoudnessProxy: {
        q10: quantile(partial, 0.1),
        q50: quantile(partial, 0.5),
        q90: quantile(partial, 0.9),
      },
      maskingLossDb: {
        q10: quantile(masking, 0.1),
        q50: quantile(masking, 0.5),
        q90: quantile(masking, 0.9),
      },
      audibilityRatio: {
        q10: quantile(ratios, 0.1),
        q50: quantile(ratios, 0.5),
        q90: quantile(ratios, 0.9),
      },
    },
  };
}

export function centerBalanceLevels(items) {
  const active = items.filter((item) => Number.isFinite(item.partialLevelDb) && item.activeFrameCount > 0);
  const mean = active.length
    ? active.reduce((total, item) => total + item.partialLevelDb, 0) / active.length
    : Number.NaN;
  return items.map((item) => ({
    ...item,
    balanceBetaDb: Number.isFinite(mean) && Number.isFinite(item.partialLevelDb)
      ? item.partialLevelDb - mean
      : Number.NaN,
  }));
}

export function buildPairwiseRelations(items) {
  const relations = [];
  const active = items.filter((item) => Number.isFinite(item.balanceBetaDb) && item.activeFrameCount > 0);
  for (let left = 0; left < active.length; left += 1) {
    for (let right = left + 1; right < active.length; right += 1) {
      relations.push({
        leftModuleIndex: active[left].moduleIndex,
        leftName: active[left].name,
        rightModuleIndex: active[right].moduleIndex,
        rightName: active[right].name,
        deltaDb: active[left].balanceBetaDb - active[right].balanceBetaDb,
      });
    }
  }
  return relations;
}

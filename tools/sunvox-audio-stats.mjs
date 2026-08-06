export const DEFAULT_SILENCE_EPSILON = 1e-7;
export const DEFAULT_CLIPPING_THRESHOLD = 1;

export function summarizeAudio(
  samples,
  channels,
  { silenceEpsilon = DEFAULT_SILENCE_EPSILON, clippingThreshold = DEFAULT_CLIPPING_THRESHOLD } = {},
) {
  let peak = 0;
  let sumSquares = 0;
  let nonZeroSamples = 0;
  let clippedSamples = 0;
  let firstNonZeroFrame;
  let lastNonZeroFrame;
  const frameCount = Math.floor(samples.length / channels);
  for (let sampleIndex = 0; sampleIndex < samples.length; sampleIndex += 1) {
    const value = samples[sampleIndex];
    const absolute = Math.abs(value);
    peak = Math.max(peak, absolute);
    sumSquares += value * value;
    if (absolute >= clippingThreshold) {
      clippedSamples += 1;
    }
    if (absolute > silenceEpsilon) {
      nonZeroSamples += 1;
      const frame = Math.floor(sampleIndex / channels);
      firstNonZeroFrame ??= frame;
      lastNonZeroFrame = frame;
    }
  }
  return {
    peak,
    rms: samples.length ? Math.sqrt(sumSquares / samples.length) : 0,
    nonZeroSamples,
    nonZeroFrames:
      firstNonZeroFrame === undefined || lastNonZeroFrame === undefined ? 0 : lastNonZeroFrame - firstNonZeroFrame + 1,
    clippedSamples,
    firstNonZeroFrame,
    lastNonZeroFrame,
    leadingSilenceFrames: firstNonZeroFrame ?? frameCount,
  };
}

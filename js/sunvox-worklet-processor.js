const CONTROL_READ_INDEX = 0;
const CONTROL_WRITE_INDEX = 1;
const CONTROL_CAPACITY_FRAMES = 2;
const CONTROL_CHANNELS = 3;
const CONTROL_STATE = 4;
const CONTROL_GENERATION = 5;
const CONTROL_UNDERRUNS = 6;
const CONTROL_CONSUMED_FRAMES = 7;

const OUTPUT_STOPPED = 0;
const OUTPUT_RUNNING = 1;
const DEFAULT_MASTER_GAIN = 1;
const UNDERRUN_RAMP_IN_FRAMES = 64;
const AUDIBLE_SAMPLE_THRESHOLD = 0.000001;

function clampGain(value) {
  if (!Number.isFinite(value)) {
    return DEFAULT_MASTER_GAIN;
  }
  return Math.max(0, value);
}

class SunVoxWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.channels = 2;
    this.queuedChunks = [];
    this.queuedFrames = 0;
    this.readOffset = 0;
    this.sentinelReportFrames = 0;
    this.reportEveryFrames = 256;
    this.lastLeft = 0;
    this.lastRight = 0;
    this.underrunFadeDurationFrames = 64;
    this.rampInFramesTotal = UNDERRUN_RAMP_IN_FRAMES;
    this.rampInFramesRemaining = 0;
    this.masterGain = DEFAULT_MASTER_GAIN;
    this.sharedControl = null;
    this.sharedAudio = null;
    this.sharedCapacityFrames = 0;
    this.sharedChannels = 0;
    this.sharedGeneration = 0;

    this.port.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  handleMessage(message) {
    if (!message) {
      return;
    }

    if (message.type === "sunvox-shared-buffer") {
      this.sharedControl = new Int32Array(message.controlBuffer);
      this.sharedAudio = new Float32Array(message.audioBuffer);
      this.sharedCapacityFrames = Atomics.load(this.sharedControl, CONTROL_CAPACITY_FRAMES);
      this.sharedChannels = Atomics.load(this.sharedControl, CONTROL_CHANNELS) || this.channels;
      this.resetQueue();
      this.resetOutputContinuity();
      return;
    }

    if (message.type === "sunvox-master-volume") {
      this.masterGain = clampGain(Number(message.gain));
      return;
    }

    if (message.type === "sunvox-clear") {
      this.resetQueue();
      this.resetOutputContinuity();
      return;
    }

    if (message.type !== "sunvox-audio") {
      return;
    }

    const audioData = message.audioData;
    if (!(audioData instanceof Float32Array) || audioData.length === 0) {
      return;
    }

    this.queuedChunks.push(audioData);
    this.queuedFrames += audioData.length / this.channels;
  }

  resetQueue() {
    this.queuedChunks = [];
    this.queuedFrames = 0;
    this.readOffset = 0;
    this.sentinelReportFrames = 0;
  }

  resetLastSample() {
    this.lastLeft = 0;
    this.lastRight = 0;
  }

  resetOutputContinuity() {
    this.resetLastSample();
    this.rampInFramesRemaining = 0;
  }

  scheduleRampInAfterUnderrun(wasAudible) {
    if (wasAudible) {
      this.rampInFramesRemaining = this.rampInFramesTotal;
    }
  }

  consumeRampInGain() {
    if (this.rampInFramesRemaining <= 0) {
      return 1;
    }
    const elapsedFrames = this.rampInFramesTotal - this.rampInFramesRemaining + 1;
    this.rampInFramesRemaining -= 1;
    return elapsedFrames / (this.rampInFramesTotal + 1);
  }

  emitConsumed(frames) {
    this.sentinelReportFrames += frames;
    if (this.sentinelReportFrames >= this.reportEveryFrames) {
      this.port.postMessage({ type: "sunvox-consumed", consumedFrames: this.sentinelReportFrames });
      this.sentinelReportFrames = 0;
    }
  }

  sharedAvailableFrames(readIndex, writeIndex) {
    if (!this.sharedCapacityFrames) {
      return 0;
    }
    if (writeIndex >= readIndex) {
      return writeIndex - readIndex;
    }
    return this.sharedCapacityFrames - readIndex + writeIndex;
  }

  writeFadeToZero(outputLeft, outputRight, written, frameCount) {
    if (written >= frameCount) {
      return;
    }
    const remaining = frameCount - written;
    const fadeStartLeft = this.lastLeft;
    const fadeStartRight = this.lastRight;
    const wasAudible =
      written > 0 ||
      Math.max(Math.abs(fadeStartLeft), Math.abs(fadeStartRight)) > AUDIBLE_SAMPLE_THRESHOLD;
    const fadeFrames = Math.min(this.underrunFadeDurationFrames, remaining);
    for (let i = 0; i < remaining; i += 1) {
      const frameIndex = written + i;
      if (i < fadeFrames) {
        const level = 1 - (i + 1) / (fadeFrames + 1);
        outputLeft[frameIndex] = fadeStartLeft * level;
        outputRight[frameIndex] = fadeStartRight * level;
      } else {
        outputLeft[frameIndex] = 0;
        outputRight[frameIndex] = 0;
      }
    }
    this.resetLastSample();
    this.scheduleRampInAfterUnderrun(wasAudible);
  }

  processShared(outputLeft, outputRight, frameCount) {
    const generation = Atomics.load(this.sharedControl, CONTROL_GENERATION);
    if (generation !== this.sharedGeneration) {
      this.sharedGeneration = generation;
      this.resetOutputContinuity();
    }

    if (Atomics.load(this.sharedControl, CONTROL_STATE) !== OUTPUT_RUNNING) {
      outputLeft.fill(0);
      outputRight.fill(0);
      this.resetOutputContinuity();
      return;
    }

    let readIndex = Atomics.load(this.sharedControl, CONTROL_READ_INDEX);
    const writeIndex = Atomics.load(this.sharedControl, CONTROL_WRITE_INDEX);
    let availableFrames = this.sharedAvailableFrames(readIndex, writeIndex);
    let written = 0;

    while (written < frameCount && availableFrames > 0) {
      const framesToWrite = Math.min(frameCount - written, availableFrames, this.sharedCapacityFrames - readIndex);
      let source = readIndex * this.sharedChannels;
      for (let i = 0; i < framesToWrite; i += 1) {
        const gain = this.masterGain * this.consumeRampInGain();
        outputLeft[written + i] = this.sharedAudio[source] * gain;
        outputRight[written + i] = (this.sharedAudio[source + 1] ?? 0) * gain;
        source += this.sharedChannels;
      }

      written += framesToWrite;
      readIndex = (readIndex + framesToWrite) % this.sharedCapacityFrames;
      availableFrames -= framesToWrite;
    }

    if (written > 0) {
      this.lastLeft = outputLeft[written - 1];
      this.lastRight = outputRight[written - 1];
      Atomics.store(this.sharedControl, CONTROL_READ_INDEX, readIndex);
      Atomics.add(this.sharedControl, CONTROL_CONSUMED_FRAMES, written);
    }

    if (written < frameCount) {
      Atomics.add(this.sharedControl, CONTROL_UNDERRUNS, 1);
      this.writeFadeToZero(outputLeft, outputRight, written, frameCount);
    }
  }

  processQueued(outputLeft, outputRight, frameCount) {
    let written = 0;

    while (written < frameCount && this.queuedFrames > 0) {
      const chunk = this.queuedChunks[0];
      if (!chunk || chunk.length === 0 || this.readOffset >= chunk.length) {
        this.queuedChunks.shift();
        this.readOffset = 0;
        continue;
      }

      const availableChunkFrames = (chunk.length - this.readOffset) / this.channels;
      const framesToWrite = Math.min(frameCount - written, availableChunkFrames);
      let readPos = this.readOffset;
      for (let i = 0; i < framesToWrite; i += 1) {
        const gain = this.masterGain * this.consumeRampInGain();
        outputLeft[written + i] = chunk[readPos] * gain;
        outputRight[written + i] = (chunk[readPos + 1] ?? 0) * gain;
        readPos += this.channels;
      }

      written += framesToWrite;
      this.readOffset = readPos;
      if (this.readOffset >= chunk.length) {
        this.queuedChunks.shift();
        this.readOffset = 0;
      }
      this.queuedFrames -= framesToWrite;
    }

    if (written > 0) {
      this.lastLeft = outputLeft[written - 1];
      this.lastRight = outputRight[written - 1];
    }

    this.writeFadeToZero(outputLeft, outputRight, written, frameCount);
    this.emitConsumed(written);
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output) {
      return true;
    }
    const outputLeft = output[0];
    const outputRight = output[1] || outputLeft;
    const frameCount = outputLeft.length;

    if (this.sharedControl && this.sharedAudio && this.sharedCapacityFrames > 0) {
      this.processShared(outputLeft, outputRight, frameCount);
    } else {
      this.processQueued(outputLeft, outputRight, frameCount);
    }
    return true;
  }
}

registerProcessor("sunvox-worklet-processor", SunVoxWorkletProcessor);

class SunVoxWorkletProcessor extends AudioWorkletProcessor {
  constructor() {
    super();

    this.channels = 2;
    this.queuedChunks = [];
    this.queuedFrames = 0;
    this.readOffset = 0;
    this.maxQueuedFrames = 65536;
    this.sentinelReportFrames = 0;
    this.reportEveryFrames = 256;
    this.lastLeft = 0;
    this.lastRight = 0;
    this.underrunFadeDurationFrames = 64;

    this.port.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  handleMessage(message) {
    if (!message) {
      return;
    }

    if (message.type === "sunvox-clear") {
      this.queuedChunks = [];
      this.queuedFrames = 0;
      this.readOffset = 0;
      this.sentinelReportFrames = 0;
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

  emitConsumed(frames) {
    this.sentinelReportFrames += frames;
    if (this.sentinelReportFrames >= this.reportEveryFrames) {
      this.port.postMessage({ type: "sunvox-consumed", consumedFrames: this.sentinelReportFrames });
      this.sentinelReportFrames = 0;
    }
  }

  process(inputs, outputs) {
    const output = outputs[0];
    if (!output) {
      return true;
    }
    const outputLeft = output[0];
    const outputRight = output[1] || outputLeft;
    const frameCount = outputLeft.length;
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
        outputLeft[written + i] = chunk[readPos];
        outputRight[written + i] = chunk[readPos + 1] ?? 0;
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

    if (written < frameCount) {
      const remaining = frameCount - written;
      const fadeFrames = Math.min(this.underrunFadeDurationFrames, remaining);
      for (let i = 0; i < remaining; i += 1) {
        const frameIndex = written + i;
        if (i < fadeFrames) {
          const level = 1 - (i + 1) / (fadeFrames + 1);
          outputLeft[frameIndex] = this.lastLeft * level;
          outputRight[frameIndex] = this.lastRight * level;
        } else {
          outputLeft[frameIndex] = 0;
          outputRight[frameIndex] = 0;
        }
      }
    }

    this.emitConsumed(written);
    return true;
  }
}

registerProcessor("sunvox-worklet-processor", SunVoxWorkletProcessor);

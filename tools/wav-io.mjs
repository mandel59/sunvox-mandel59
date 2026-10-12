import { readFile, writeFile } from "node:fs/promises";

// Minimal RIFF/WAVE reader and writer for offline review renders.
// Supports PCM 16/24-bit and IEEE float 32-bit interleaved data.

export function encodeWav(samples, { sampleRate, channels, bitDepth = 16 }) {
  if (![16, 24, 32].includes(bitDepth)) {
    throw new Error(`Unsupported WAV bit depth: ${bitDepth}`);
  }
  const bytesPerSample = bitDepth / 8;
  const dataBytes = samples.length * bytesPerSample;
  const buffer = Buffer.alloc(44 + dataBytes);
  const isFloat = bitDepth === 32;
  buffer.write("RIFF", 0, "latin1");
  buffer.writeUInt32LE(36 + dataBytes, 4);
  buffer.write("WAVE", 8, "latin1");
  buffer.write("fmt ", 12, "latin1");
  buffer.writeUInt32LE(16, 16);
  buffer.writeUInt16LE(isFloat ? 3 : 1, 20);
  buffer.writeUInt16LE(channels, 22);
  buffer.writeUInt32LE(sampleRate, 24);
  buffer.writeUInt32LE(sampleRate * channels * bytesPerSample, 28);
  buffer.writeUInt16LE(channels * bytesPerSample, 32);
  buffer.writeUInt16LE(bitDepth, 34);
  buffer.write("data", 36, "latin1");
  buffer.writeUInt32LE(dataBytes, 40);
  let offset = 44;
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]));
    if (isFloat) {
      buffer.writeFloatLE(samples[index], offset);
    } else if (bitDepth === 16) {
      buffer.writeInt16LE(Math.round(value * 32767), offset);
    } else {
      buffer.writeIntLE(Math.round(value * 8388607), offset, 3);
    }
    offset += bytesPerSample;
  }
  return buffer;
}

export function decodeWav(buffer) {
  if (buffer.toString("latin1", 0, 4) !== "RIFF" || buffer.toString("latin1", 8, 12) !== "WAVE") {
    throw new Error("Not a RIFF/WAVE file");
  }
  let offset = 12;
  let format;
  let data;
  while (offset + 8 <= buffer.length) {
    const id = buffer.toString("latin1", offset, offset + 4);
    const size = buffer.readUInt32LE(offset + 4);
    const body = offset + 8;
    if (id === "fmt ") {
      format = {
        audioFormat: buffer.readUInt16LE(body),
        channels: buffer.readUInt16LE(body + 2),
        sampleRate: buffer.readUInt32LE(body + 4),
        bitDepth: buffer.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      data = buffer.subarray(body, Math.min(buffer.length, body + size));
    }
    offset = body + size + (size % 2);
  }
  if (!format || !data) {
    throw new Error("WAV file is missing fmt or data chunk");
  }
  const { audioFormat, channels, sampleRate, bitDepth } = format;
  const bytesPerSample = bitDepth / 8;
  const count = Math.floor(data.length / bytesPerSample);
  const samples = new Float32Array(count);
  for (let index = 0; index < count; index += 1) {
    const position = index * bytesPerSample;
    if (audioFormat === 3 && bitDepth === 32) {
      samples[index] = data.readFloatLE(position);
    } else if (audioFormat === 1 && bitDepth === 16) {
      samples[index] = data.readInt16LE(position) / 32768;
    } else if (audioFormat === 1 && bitDepth === 24) {
      samples[index] = data.readIntLE(position, 3) / 8388608;
    } else {
      throw new Error(`Unsupported WAV format ${audioFormat} / ${bitDepth}-bit`);
    }
  }
  return { samples, sampleRate, channels };
}

export async function writeWavFile(path, samples, options) {
  await writeFile(path, encodeWav(samples, options));
}

export async function readWavFile(path) {
  return decodeWav(await readFile(path));
}

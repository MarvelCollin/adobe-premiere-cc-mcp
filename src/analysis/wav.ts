export interface DecodedAudio {
  sampleRate: number;
  channels: number;
  frames: number;
  samples: Float32Array[];
}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

export function decodeWav(file: Buffer): DecodedAudio {
  if (file.length < 12 || file.toString("ascii", 0, 4) !== "RIFF" || file.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("Not a WAV file");
  }

  let format = 0;
  let channels = 0;
  let sampleRate = 0;
  let bitsPerSample = 0;
  let dataStart = -1;
  let dataLength = 0;

  let offset = 12;
  while (offset + 8 <= file.length) {
    const id = file.toString("ascii", offset, offset + 4);
    const size = file.readUInt32LE(offset + 4);
    const body = offset + 8;

    if (id === "fmt ") {
      format = file.readUInt16LE(body);
      channels = file.readUInt16LE(body + 2);
      sampleRate = file.readUInt32LE(body + 4);
      bitsPerSample = file.readUInt16LE(body + 14);
      if (format === FORMAT_EXTENSIBLE && size >= 40) {
        format = file.readUInt16LE(body + 24);
      }
    } else if (id === "data") {
      dataStart = body;
      dataLength = Math.min(size, file.length - body);
    }

    offset = body + size + (size % 2);
  }

  if (dataStart < 0) throw new Error("WAV file has no data chunk");
  if (!channels || !sampleRate) throw new Error("WAV file has no usable format chunk");
  if (format !== FORMAT_PCM && format !== FORMAT_FLOAT) {
    throw new Error(`Unsupported WAV format ${format}; only PCM and float are handled`);
  }

  const bytesPerSample = bitsPerSample / 8;
  const frames = Math.floor(dataLength / (bytesPerSample * channels));
  const samples: Float32Array[] = [];
  for (let channel = 0; channel < channels; channel += 1) {
    samples.push(new Float32Array(frames));
  }

  for (let frame = 0; frame < frames; frame += 1) {
    for (let channel = 0; channel < channels; channel += 1) {
      const at = dataStart + (frame * channels + channel) * bytesPerSample;
      samples[channel][frame] = readSample(file, at, format, bitsPerSample);
    }
  }

  return { sampleRate, channels, frames, samples };
}

function readSample(file: Buffer, at: number, format: number, bits: number): number {
  if (format === FORMAT_FLOAT) {
    return bits === 64 ? file.readDoubleLE(at) : file.readFloatLE(at);
  }
  if (bits === 8) return (file.readUInt8(at) - 128) / 128;
  if (bits === 16) return file.readInt16LE(at) / 32768;
  if (bits === 24) {
    const raw = file.readUInt8(at) | (file.readUInt8(at + 1) << 8) | (file.readInt8(at + 2) << 16);
    return raw / 8388608;
  }
  if (bits === 32) return file.readInt32LE(at) / 2147483648;
  throw new Error(`Unsupported WAV bit depth ${bits}`);
}

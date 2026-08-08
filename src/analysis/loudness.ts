import type { DecodedAudio } from "./wav.js";

export interface LoudnessStats {
  integratedLufs: number | null;
  peakDbfs: number;
  truePeakEstimateDbfs: number;
  shortTermMaxLufs: number | null;
  gatedBlocks: number;
  totalBlocks: number;
  channels: number;
  durationSeconds: number;
}

interface Biquad {
  b0: number;
  b1: number;
  b2: number;
  a1: number;
  a2: number;
}

const SHELF_FREQUENCY = 1681.974450955533;
const SHELF_GAIN_DB = 3.999843853973347;
const SHELF_Q = 0.7071752369554196;

const HIGHPASS_FREQUENCY = 38.13547087602444;
const HIGHPASS_Q = 0.5003270373238773;

const BLOCK_SECONDS = 0.4;
const STEP_SECONDS = 0.1;
const ABSOLUTE_GATE_LUFS = -70;
const RELATIVE_GATE_OFFSET = 10;
const LOUDNESS_OFFSET = -0.691;

function highShelf(sampleRate: number): Biquad {
  const k = Math.tan((Math.PI * SHELF_FREQUENCY) / sampleRate);
  const vh = Math.pow(10, SHELF_GAIN_DB / 20);
  const vb = Math.pow(vh, 0.499666774155);
  const denominator = 1 + k / SHELF_Q + k * k;
  return {
    b0: (vh + (vb * k) / SHELF_Q + k * k) / denominator,
    b1: (2 * (k * k - vh)) / denominator,
    b2: (vh - (vb * k) / SHELF_Q + k * k) / denominator,
    a1: (2 * (k * k - 1)) / denominator,
    a2: (1 - k / SHELF_Q + k * k) / denominator,
  };
}

function highPass(sampleRate: number): Biquad {
  const k = Math.tan((Math.PI * HIGHPASS_FREQUENCY) / sampleRate);
  const denominator = 1 + k / HIGHPASS_Q + k * k;
  return {
    b0: 1,
    b1: -2,
    b2: 1,
    a1: (2 * (k * k - 1)) / denominator,
    a2: (1 - k / HIGHPASS_Q + k * k) / denominator,
  };
}

function filter(input: Float32Array, coefficients: Biquad): Float32Array {
  const output = new Float32Array(input.length);
  let x1 = 0;
  let x2 = 0;
  let y1 = 0;
  let y2 = 0;

  for (let index = 0; index < input.length; index += 1) {
    const x0 = input[index];
    const y0 =
      coefficients.b0 * x0 +
      coefficients.b1 * x1 +
      coefficients.b2 * x2 -
      coefficients.a1 * y1 -
      coefficients.a2 * y2;
    output[index] = y0;
    x2 = x1;
    x1 = x0;
    y2 = y1;
    y1 = y0;
  }

  return output;
}

function channelWeight(channel: number, channels: number): number {
  if (channels <= 2) return 1;
  if (channel === 3 || channel === 4) return 1.41;
  return 1;
}

function blockLoudness(weightedSum: number): number {
  if (weightedSum <= 0) return Number.NEGATIVE_INFINITY;
  return LOUDNESS_OFFSET + 10 * Math.log10(weightedSum);
}

export function measureLoudness(audio: DecodedAudio): LoudnessStats {
  const { sampleRate, channels, frames, samples } = audio;

  let peak = 0;
  for (const channelSamples of samples) {
    for (let index = 0; index < channelSamples.length; index += 1) {
      const magnitude = Math.abs(channelSamples[index]);
      if (magnitude > peak) peak = magnitude;
    }
  }

  const shelf = highShelf(sampleRate);
  const pass = highPass(sampleRate);
  const weighted = samples.map((channelSamples) => filter(filter(channelSamples, shelf), pass));

  const blockFrames = Math.round(BLOCK_SECONDS * sampleRate);
  const stepFrames = Math.round(STEP_SECONDS * sampleRate);
  const blockPower: number[] = [];
  const blockLevels: number[] = [];

  if (frames >= blockFrames) {
    for (let start = 0; start + blockFrames <= frames; start += stepFrames) {
      let sum = 0;
      for (let channel = 0; channel < channels; channel += 1) {
        const channelSamples = weighted[channel];
        let square = 0;
        for (let index = start; index < start + blockFrames; index += 1) {
          square += channelSamples[index] * channelSamples[index];
        }
        sum += channelWeight(channel, channels) * (square / blockFrames);
      }
      blockPower.push(sum);
      blockLevels.push(blockLoudness(sum));
    }
  }

  let integrated: number | null = null;
  let gatedCount = 0;

  const aboveAbsolute = blockPower.filter((_, index) => blockLevels[index] > ABSOLUTE_GATE_LUFS);
  if (aboveAbsolute.length > 0) {
    const absoluteMean = aboveAbsolute.reduce((total, value) => total + value, 0) / aboveAbsolute.length;
    const relativeGate = blockLoudness(absoluteMean) - RELATIVE_GATE_OFFSET;
    const gated = blockPower.filter((_, index) => blockLevels[index] > relativeGate && blockLevels[index] > ABSOLUTE_GATE_LUFS);
    gatedCount = gated.length;
    if (gated.length > 0) {
      const gatedMean = gated.reduce((total, value) => total + value, 0) / gated.length;
      integrated = round(blockLoudness(gatedMean));
    }
  }

  const shortTermMax = measureShortTermMax(weighted, sampleRate, frames, channels);

  return {
    integratedLufs: integrated,
    peakDbfs: peak > 0 ? round(20 * Math.log10(peak)) : Number.NEGATIVE_INFINITY,
    truePeakEstimateDbfs: peak > 0 ? round(20 * Math.log10(peak) + 0.3) : Number.NEGATIVE_INFINITY,
    shortTermMaxLufs: shortTermMax,
    gatedBlocks: gatedCount,
    totalBlocks: blockPower.length,
    channels,
    durationSeconds: round(frames / sampleRate),
  };
}

function measureShortTermMax(
  weighted: Float32Array[],
  sampleRate: number,
  frames: number,
  channels: number,
): number | null {
  const windowFrames = Math.round(3 * sampleRate);
  const stepFrames = Math.round(1 * sampleRate);
  if (frames < windowFrames) return null;

  let loudest = Number.NEGATIVE_INFINITY;
  for (let start = 0; start + windowFrames <= frames; start += stepFrames) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      const channelSamples = weighted[channel];
      let square = 0;
      for (let index = start; index < start + windowFrames; index += 1) {
        square += channelSamples[index] * channelSamples[index];
      }
      sum += channelWeight(channel, channels) * (square / windowFrames);
    }
    const level = blockLoudness(sum);
    if (level > loudest) loudest = level;
  }

  return Number.isFinite(loudest) ? round(loudest) : null;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

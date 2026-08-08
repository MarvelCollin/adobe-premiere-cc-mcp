import type { DecodedAudio } from "./wav.js";
import { hannWindow, magnitudeSpectrum } from "./fft.js";

export interface BeatAnalysis {
  bpm: number;
  confidence: number;
  beatTimes: number[];
  downbeatTimes: number[];
  beatsPerBar: number;
  onsetRate: number;
  durationSeconds: number;
}

const FRAME_SIZE = 1024;
const HOP_SIZE = 512;
const MIN_BPM = 60;
const MAX_BPM = 200;

function toMono(audio: DecodedAudio): Float32Array {
  const mono = new Float32Array(audio.frames);
  for (let frame = 0; frame < audio.frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < audio.channels; channel += 1) {
      sum += audio.samples[channel][frame];
    }
    mono[frame] = sum / audio.channels;
  }
  return mono;
}

export function onsetEnvelope(audio: DecodedAudio): { envelope: Float32Array; rate: number } {
  const mono = toMono(audio);
  const window = hannWindow(FRAME_SIZE);
  const frameCount = Math.max(0, Math.floor((mono.length - FRAME_SIZE) / HOP_SIZE) + 1);
  const envelope = new Float32Array(Math.max(0, frameCount));

  let previous: Float32Array | null = null;
  const frame = new Float32Array(FRAME_SIZE);

  for (let index = 0; index < frameCount; index += 1) {
    const start = index * HOP_SIZE;
    for (let sample = 0; sample < FRAME_SIZE; sample += 1) {
      frame[sample] = mono[start + sample] * window[sample];
    }

    const spectrum = magnitudeSpectrum(frame);
    if (previous) {
      let flux = 0;
      for (let bin = 0; bin < spectrum.length; bin += 1) {
        const rise = spectrum[bin] - previous[bin];
        if (rise > 0) flux += rise;
      }
      envelope[index] = flux;
    }
    previous = Float32Array.from(spectrum);
  }

  const rate = audio.sampleRate / HOP_SIZE;
  return { envelope, rate };
}

function normalise(envelope: Float32Array): Float32Array {
  const smoothed = new Float32Array(envelope.length);
  const radius = 8;

  for (let index = 0; index < envelope.length; index += 1) {
    let sum = 0;
    let count = 0;
    for (let offset = -radius; offset <= radius; offset += 1) {
      const at = index + offset;
      if (at < 0 || at >= envelope.length) continue;
      sum += envelope[at];
      count += 1;
    }
    const local = sum / Math.max(1, count);
    smoothed[index] = Math.max(0, envelope[index] - local);
  }

  let peak = 0;
  for (const value of smoothed) if (value > peak) peak = value;
  if (peak > 0) {
    for (let index = 0; index < smoothed.length; index += 1) smoothed[index] /= peak;
  }
  return smoothed;
}

function bestTempo(envelope: Float32Array, rate: number): { bpm: number; strength: number } {
  const minLag = Math.floor((60 / MAX_BPM) * rate);
  const maxLag = Math.ceil((60 / MIN_BPM) * rate);

  let bestLag = minLag;
  let bestScore = -1;

  for (let lag = minLag; lag <= maxLag && lag < envelope.length; lag += 1) {
    let score = 0;
    for (let index = 0; index + lag < envelope.length; index += 1) {
      score += envelope[index] * envelope[index + lag];
    }
    const normalised = score / (envelope.length - lag);
    if (normalised > bestScore) {
      bestScore = normalised;
      bestLag = lag;
    }
  }

  let mean = 0;
  for (const value of envelope) mean += value;
  mean /= Math.max(1, envelope.length);
  const reference = mean * mean;

  return {
    bpm: (60 * rate) / bestLag,
    strength: reference > 0 ? bestScore / reference : 0,
  };
}

function alignPhase(envelope: Float32Array, rate: number, bpm: number): number {
  const period = (60 / bpm) * rate;
  let bestOffset = 0;
  let bestScore = -1;

  for (let offset = 0; offset < period; offset += 1) {
    let score = 0;
    for (let position = offset; position < envelope.length; position += period) {
      const index = Math.round(position);
      if (index >= envelope.length) break;
      score += envelope[index];
    }
    if (score > bestScore) {
      bestScore = score;
      bestOffset = offset;
    }
  }
  return bestOffset;
}

function pickDownbeat(envelope: Float32Array, beatFrames: number[], beatsPerBar: number): number {
  let bestPhase = 0;
  let bestScore = -1;

  for (let phase = 0; phase < beatsPerBar; phase += 1) {
    let score = 0;
    for (let index = phase; index < beatFrames.length; index += beatsPerBar) {
      const at = Math.round(beatFrames[index]);
      if (at >= 0 && at < envelope.length) score += envelope[at];
    }
    if (score > bestScore) {
      bestScore = score;
      bestPhase = phase;
    }
  }
  return bestPhase;
}

export function detectBeats(audio: DecodedAudio, beatsPerBar = 4): BeatAnalysis {
  const { envelope: raw, rate } = onsetEnvelope(audio);
  const durationSeconds = audio.frames / audio.sampleRate;

  if (raw.length < rate * 2) {
    throw new Error("Need at least two seconds of audio to find a tempo");
  }

  const envelope = normalise(raw);
  const { bpm, strength } = bestTempo(envelope, rate);
  const period = (60 / bpm) * rate;
  const offset = alignPhase(envelope, rate, bpm);

  const beatFrames: number[] = [];
  for (let position = offset; position < envelope.length; position += period) {
    beatFrames.push(position);
  }

  const downbeatPhase = pickDownbeat(envelope, beatFrames, beatsPerBar);
  const beatTimes = beatFrames.map((frame) => Math.round((frame / rate) * 1000) / 1000);
  const downbeatTimes = beatTimes.filter((_, index) => (index - downbeatPhase) % beatsPerBar === 0);

  return {
    bpm: Math.round(bpm * 10) / 10,
    confidence: Math.round(Math.min(1, strength / 12) * 100) / 100,
    beatTimes,
    downbeatTimes,
    beatsPerBar,
    onsetRate: rate,
    durationSeconds: Math.round(durationSeconds * 1000) / 1000,
  };
}

export function subdivide(beatTimes: number[], divisions: number): number[] {
  if (divisions <= 1) return beatTimes.slice();
  const output: number[] = [];
  for (let index = 0; index < beatTimes.length; index += 1) {
    output.push(beatTimes[index]);
    const next = beatTimes[index + 1];
    if (next === undefined) continue;
    const step = (next - beatTimes[index]) / divisions;
    for (let part = 1; part < divisions; part += 1) {
      output.push(Math.round((beatTimes[index] + step * part) * 1000) / 1000);
    }
  }
  return output;
}

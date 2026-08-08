import { describe, expect, it } from "vitest";
import { detectBeats, onsetEnvelope, subdivide } from "../src/analysis/beats.js";
import { magnitudeSpectrum, nextPowerOfTwo } from "../src/analysis/fft.js";
import type { DecodedAudio } from "../src/analysis/wav.js";

const SAMPLE_RATE = 48_000;

function clickTrack(bpm: number, seconds: number, options: { accentEvery?: number } = {}): DecodedAudio {
  const frames = Math.floor(SAMPLE_RATE * seconds);
  const mono = new Float32Array(frames);
  const period = (60 / bpm) * SAMPLE_RATE;
  const accentEvery = options.accentEvery ?? 0;

  let beat = 0;
  for (let position = 0; position < frames; position += period) {
    const start = Math.round(position);
    const accented = accentEvery > 0 && beat % accentEvery === 0;
    const amplitude = accented ? 1 : 0.55;
    const length = Math.round(SAMPLE_RATE * 0.02);

    for (let sample = 0; sample < length && start + sample < frames; sample += 1) {
      const decay = Math.exp(-sample / (SAMPLE_RATE * 0.004));
      const tone = Math.sin((2 * Math.PI * 1800 * sample) / SAMPLE_RATE);
      mono[start + sample] += amplitude * decay * tone;
    }
    beat += 1;
  }

  return { sampleRate: SAMPLE_RATE, channels: 1, frames, samples: [mono] };
}

describe("fft", () => {
  it("rounds up to a power of two", () => {
    expect(nextPowerOfTwo(1000)).toBe(1024);
    expect(nextPowerOfTwo(1024)).toBe(1024);
  });

  it("puts a pure tone in the expected bin", () => {
    const size = 1024;
    const frequency = SAMPLE_RATE / size * 64;
    const frame = new Float32Array(size);
    for (let sample = 0; sample < size; sample += 1) {
      frame[sample] = Math.sin((2 * Math.PI * frequency * sample) / SAMPLE_RATE);
    }

    const spectrum = magnitudeSpectrum(frame);
    let peakBin = 0;
    for (let bin = 1; bin < spectrum.length; bin += 1) {
      if (spectrum[bin] > spectrum[peakBin]) peakBin = bin;
    }
    expect(peakBin).toBe(64);
  });

  it("rejects a non power of two frame", () => {
    expect(() => magnitudeSpectrum(new Float32Array(1000))).toThrow(/power of two/);
  });
});

describe("onset envelope", () => {
  it("spikes once per click", () => {
    const { envelope, rate } = onsetEnvelope(clickTrack(120, 8));
    expect(rate).toBeCloseTo(SAMPLE_RATE / 512, 5);

    let peak = 0;
    for (const value of envelope) if (value > peak) peak = value;
    let spikes = 0;
    for (const value of envelope) if (value > peak * 0.5) spikes += 1;

    expect(spikes).toBeGreaterThanOrEqual(12);
    expect(spikes).toBeLessThanOrEqual(34);
  });
});

describe("detectBeats against a known tempo", () => {
  for (const bpm of [90, 100, 120, 128, 140]) {
    it(`recovers ${bpm} bpm`, () => {
      const analysis = detectBeats(clickTrack(bpm, 16));
      expect(Math.abs(analysis.bpm - bpm), `got ${analysis.bpm}`).toBeLessThanOrEqual(1.5);
    });
  }

  it("places beats on the clicks", () => {
    const bpm = 120;
    const analysis = detectBeats(clickTrack(bpm, 16));
    const period = 60 / bpm;

    for (const time of analysis.beatTimes.slice(1, 12)) {
      const nearest = Math.round(time / period) * period;
      expect(Math.abs(time - nearest), `beat at ${time}s drifted`).toBeLessThan(0.05);
    }
  });

  it("spaces beats by one period", () => {
    const analysis = detectBeats(clickTrack(100, 16));
    const gaps = analysis.beatTimes.slice(1).map((time, index) => time - analysis.beatTimes[index]);
    for (const gap of gaps) {
      expect(Math.abs(gap - 0.6)).toBeLessThan(0.03);
    }
  });

  it("finds downbeats on the accented click", () => {
    const analysis = detectBeats(clickTrack(120, 20, { accentEvery: 4 }), 4);
    expect(analysis.downbeatTimes.length).toBeGreaterThan(3);

    const period = 60 / 120;
    for (const time of analysis.downbeatTimes.slice(1, 4)) {
      const beatIndex = Math.round(time / period);
      expect(beatIndex % 4, `downbeat at ${time}s is not on a bar line`).toBe(0);
    }
  });

  it("refuses audio too short to hold a tempo", () => {
    expect(() => detectBeats(clickTrack(120, 1))).toThrow(/two seconds/);
  });
});

describe("subdivide", () => {
  it("returns the beats unchanged for one division", () => {
    expect(subdivide([0, 0.5, 1], 1)).toEqual([0, 0.5, 1]);
  });

  it("inserts offbeats", () => {
    expect(subdivide([0, 1, 2], 2)).toEqual([0, 0.5, 1, 1.5, 2]);
  });

  it("inserts triplets", () => {
    expect(subdivide([0, 1], 3)).toEqual([0, 0.333, 0.667, 1]);
  });
});

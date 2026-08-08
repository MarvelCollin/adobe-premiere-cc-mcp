import { describe, expect, it } from "vitest";
import { findAudioFaults } from "../src/analysis/audio-faults.js";
import type { DecodedAudio } from "../src/analysis/wav.js";

const SAMPLE_RATE = 48_000;

function build(seconds: number, fill: (time: number, index: number) => number): DecodedAudio {
  const frames = Math.floor(SAMPLE_RATE * seconds);
  const mono = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    mono[index] = fill(index / SAMPLE_RATE, index);
  }
  return { sampleRate: SAMPLE_RATE, channels: 1, frames, samples: [mono] };
}

const noise = (amplitude: number) => (): number => (Math.sin(Date.now()) * 0 + Math.random() * 2 - 1) * amplitude;

describe("findAudioFaults", () => {
  it("reports a clean quiet bed as having no faults", () => {
    const audio = build(3, (_, index) => Math.sin((2 * Math.PI * 200 * index) / SAMPLE_RATE) * 0.2);
    const faults = findAudioFaults(audio);
    expect(faults.clippedRanges).toHaveLength(0);
    expect(faults.silentRanges).toHaveLength(0);
  });

  it("finds a silent stretch", () => {
    const audio = build(4, (time, index) =>
      time > 1 && time < 2.5 ? 0 : Math.sin((2 * Math.PI * 300 * index) / SAMPLE_RATE) * 0.3,
    );
    const faults = findAudioFaults(audio);
    expect(faults.silentRanges.length).toBeGreaterThanOrEqual(1);
    expect(faults.silentRanges[0].fromSeconds).toBeGreaterThanOrEqual(0.95);
    expect(faults.silentRanges[0].toSeconds).toBeLessThanOrEqual(2.6);
  });

  it("finds clipping", () => {
    const audio = build(2, (time, index) => {
      const tone = Math.sin((2 * Math.PI * 400 * index) / SAMPLE_RATE);
      return time > 0.5 && time < 0.8 ? Math.sign(tone) : tone * 0.3;
    });
    const faults = findAudioFaults(audio);
    expect(faults.clippedRanges.length).toBeGreaterThanOrEqual(1);
    expect(faults.summary).toMatch(/clipped/i);
  });

  it("separates active audio from a noise floor", () => {
    const audio = build(6, (time, index) => {
      const floor = noise(0.005)();
      const talking = time % 2 < 1;
      return talking ? floor + Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE) * 0.4 : floor;
    });
    const faults = findAudioFaults(audio);
    expect(faults.activeRanges.length).toBeGreaterThanOrEqual(2);
    expect(faults.activeSharePercent).toBeGreaterThan(25);
    expect(faults.activeSharePercent).toBeLessThan(75);
  });

  it("flags a high noise floor", () => {
    const audio = build(3, () => noise(0.2)());
    const faults = findAudioFaults(audio);
    expect(faults.noiseFloorDb).toBeGreaterThan(-45);
    expect(faults.summary).toMatch(/noise floor/i);
  });

  it("handles audio too short to measure", () => {
    const audio: DecodedAudio = { sampleRate: SAMPLE_RATE, channels: 1, frames: 10, samples: [new Float32Array(10)] };
    expect(findAudioFaults(audio).summary).toMatch(/too short/i);
  });
});

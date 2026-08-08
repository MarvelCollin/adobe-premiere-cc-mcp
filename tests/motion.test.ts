import { describe, expect, it } from "vitest";
import { frameDifference, motionSignature, readMotion } from "../src/analysis/motion.js";
import type { DecodedImage } from "../src/analysis/png.js";

function blank(value: number, size = 96): DecodedImage {
  const pixels = Buffer.alloc(size * size * 3, value);
  return { width: size, height: size, channels: 3, pixels };
}

function withBox(x: number, size = 96, boxSize = 24): DecodedImage {
  const image = blank(20, size);
  for (let row = 30; row < 30 + boxSize; row += 1) {
    for (let column = x; column < x + boxSize && column < size; column += 1) {
      const at = (row * size + column) * 3;
      image.pixels[at] = 240;
      image.pixels[at + 1] = 240;
      image.pixels[at + 2] = 240;
    }
  }
  return image;
}

describe("frameDifference", () => {
  it("is zero between identical frames", () => {
    const signature = motionSignature(blank(120));
    expect(frameDifference(signature, signature)).toBe(0);
  });

  it("grows as the subject moves further", () => {
    const start = motionSignature(withBox(10));
    const near = motionSignature(withBox(16));
    const far = motionSignature(withBox(60));

    const smallMove = frameDifference(start, near);
    const bigMove = frameDifference(start, far);

    expect(smallMove).toBeGreaterThan(0);
    expect(bigMove).toBeGreaterThan(smallMove);
  });
});

describe("readMotion", () => {
  it("says so when nothing moves", () => {
    const samples = [0, 0.1, 0, 0.2, 0].map((motion, index) => ({ atSeconds: index * 0.2, motion }));
    const reading = readMotion(samples);
    expect(reading.peaks).toEqual([]);
    expect(reading.steadiness).toMatch(/nothing moves/i);
  });

  it("finds a single burst and calls it the cut point", () => {
    const samples = [1, 1.2, 1, 40, 1.1, 1, 1.2].map((motion, index) => ({
      atSeconds: index * 0.2,
      motion,
    }));
    const reading = readMotion(samples);

    expect(reading.peaks.length).toBeGreaterThanOrEqual(1);
    expect(reading.peaks[0].atSeconds).toBeCloseTo(0.6, 5);
    expect(reading.peaks[0].share).toBe(1);
    expect(reading.steadiness).toMatch(/one clear burst/i);
  });

  it("ranks the strongest peak first", () => {
    const samples = [1, 20, 1, 45, 1, 30, 1].map((motion, index) => ({
      atSeconds: index * 0.5,
      motion,
    }));
    const reading = readMotion(samples);
    expect(reading.peaks[0].motion).toBe(45);
    expect(reading.peaks[1].motion).toBe(30);
  });

  it("recognises constant movement", () => {
    const samples = Array.from({ length: 12 }, (_, index) => ({
      atSeconds: index * 0.2,
      motion: 18 + (index % 2),
    }));
    expect(readMotion(samples).steadiness).toMatch(/throughout/i);
  });

  it("handles an empty measurement", () => {
    expect(readMotion([]).peakMotion).toBe(0);
  });
});

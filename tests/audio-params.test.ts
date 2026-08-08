import { describe, expect, it } from "vitest";
import {
  compressorAttackToNormalised,
  compressorGainToNormalised,
  compressorRatioToNormalised,
  compressorReleaseToNormalised,
  compressorThresholdToNormalised,
  eqFrequencyToNormalised,
  normalisedToCompressorGain,
  normalisedToCompressorRatio,
  normalisedToCompressorThreshold,
  normalisedToEqFrequency,
} from "../src/premiere/audio-params.js";

describe("Parametric Equalizer frequency mapping", () => {
  it("reproduces the defaults Premiere ships, which is how the mapping was found", () => {
    const observed: [number, number][] = [
      [40, 0.00083402806194],
      [50, 0.00125104002655],
      [200, 0.00750626018271],
      [800, 0.03252710029483],
      [3200, 0.13261100649834],
      [12800, 0.53294402360916],
      [18000, 0.74979197978973],
    ];
    for (const [hz, normalised] of observed) {
      expect(normalisedToEqFrequency(normalised), `${hz} Hz default`).toBeCloseTo(hz, 1);
    }
  });

  it("decodes the shipped band centres as a clean four times series", () => {
    const centres = [0.00125104002655, 0.00750626018271, 0.03252710029483, 0.13261100649834, 0.53294402360916].map(
      (value) => Math.round(normalisedToEqFrequency(value)),
    );
    expect(centres).toEqual([50, 200, 800, 3200, 12800]);
  });

  it("matches what a rendered high pass actually measured", () => {
    expect(eqFrequencyToNormalised(500)).toBeCloseTo(0.02001668, 7);
    expect(eqFrequencyToNormalised(1500)).toBeCloseTo(0.0617181, 7);
  });

  it("round trips", () => {
    for (const hz of [40, 80, 120, 500, 1500, 8000]) {
      expect(normalisedToEqFrequency(eqFrequencyToNormalised(hz))).toBeCloseTo(hz, 6);
    }
  });

  it("clamps rather than sending the host a value outside its range", () => {
    expect(eqFrequencyToNormalised(0)).toBe(0);
    expect(eqFrequencyToNormalised(96_000)).toBe(1);
  });
});

describe("Single-band Compressor mapping", () => {
  it("reproduces the defaults Premiere ships", () => {
    expect(compressorThresholdToNormalised(0)).toBeCloseTo(1, 10);
    expect(compressorRatioToNormalised(1)).toBeCloseTo(0, 10);
    expect(compressorAttackToNormalised(10)).toBeCloseTo(0.02, 10);
    expect(compressorReleaseToNormalised(100)).toBeCloseTo(0.02, 10);
    expect(compressorGainToNormalised(0)).toBeCloseTo(0.5, 10);
  });

  it("matches the makeup gain measured from a render", () => {
    expect(compressorGainToNormalised(6)).toBeCloseTo(0.6, 10);
    expect(normalisedToCompressorGain(0.6)).toBeCloseTo(6, 10);
  });

  it("spans the ranges the effect exposes", () => {
    expect(compressorThresholdToNormalised(-60)).toBe(0);
    expect(normalisedToCompressorThreshold(0.5)).toBeCloseTo(-30, 10);
    expect(normalisedToCompressorRatio(1)).toBeCloseTo(30, 10);
    expect(compressorRatioToNormalised(3)).toBeCloseTo(2 / 29, 10);
  });

  it("clamps out of range requests", () => {
    expect(compressorThresholdToNormalised(12)).toBe(1);
    expect(compressorThresholdToNormalised(-120)).toBe(0);
    expect(compressorRatioToNormalised(100)).toBe(1);
    expect(compressorAttackToNormalised(9000)).toBe(1);
  });
});

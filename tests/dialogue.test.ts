import { describe, expect, it } from "vitest";
import { COMPRESSOR_HEADROOM_DB, measureDialogue, planDialogueChain } from "../src/analysis/dialogue.js";
import type { DecodedAudio } from "../src/analysis/wav.js";

const SAMPLE_RATE = 48_000;

function build(seconds: number, fill: (time: number, index: number) => number): DecodedAudio {
  const frames = Math.floor(SAMPLE_RATE * seconds);
  const mono = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) mono[index] = fill(index / SAMPLE_RATE, index);
  return { sampleRate: SAMPLE_RATE, channels: 1, frames, samples: [mono] };
}

const tone = (hz: number, index: number, amplitude: number): number =>
  Math.sin((2 * Math.PI * hz * index) / SAMPLE_RATE) * amplitude;

describe("measureDialogue", () => {
  it("finds the share of energy sitting below the high pass point", () => {
    const audio = build(6, (_, index) => tone(40, index, 0.3) + tone(1000, index, 0.3));
    const measurement = measureDialogue(audio, 80);
    expect(measurement.measurable).toBe(true);
    expect(measurement.rumbleDb).toBeGreaterThan(-4);
    expect(measurement.rumbleDb).toBeLessThan(-2);
  });

  it("reports almost nothing below the high pass point when the rumble is gone", () => {
    const audio = build(6, (_, index) => tone(1000, index, 0.3));
    expect(measureDialogue(audio, 80).rumbleDb).toBeLessThan(-40);
  });

  it("separates the level a track peaks at from the level it averages", () => {
    const audio = build(8, (time, index) => {
      const loud = time % 2 < 0.2;
      return tone(300, index, loud ? 0.8 : 0.08);
    });
    const measurement = measureDialogue(audio, 80);
    expect(measurement.peakTypicalDb).toBeGreaterThan(measurement.loudDb);
    expect(measurement.peakTypicalDb).toBeGreaterThan(-3);
  });

  it("measures the spread between the loud and quiet stretches, ignoring the room tone", () => {
    const speech = (quietAmplitude: number) =>
      build(12, (time, index) => {
        const phase = time % 3;
        if (phase < 1) return tone(300, index, 0.0008);
        return tone(300, index, phase < 2 ? quietAmplitude : 0.5);
      });
    const wide = measureDialogue(speech(0.05), 80);
    const narrow = measureDialogue(speech(0.35), 80);
    expect(wide.measurable).toBe(true);
    expect(narrow.measurable).toBe(true);
    expect(wide.levelSpreadDb).toBeGreaterThan(narrow.levelSpreadDb + 5);
  });

  it("refuses a silent render rather than describing it", () => {
    const measurement = measureDialogue(build(4, () => 0), 80);
    expect(measurement.measurable).toBe(false);
    expect(measurement.reason).toMatch(/silent/i);
  });

  it("refuses a render too short to measure", () => {
    const measurement = measureDialogue(
      { sampleRate: SAMPLE_RATE, channels: 1, frames: 100, samples: [new Float32Array(100)] },
      80,
    );
    expect(measurement.measurable).toBe(false);
    expect(measurement.reason).toMatch(/too short/i);
  });
});

describe("planDialogueChain", () => {
  const measurement = measureDialogue(
    build(8, (time, index) => tone(300, index, time % 2 < 0.3 ? 0.7 : 0.07)),
    80,
  );

  it("sets the threshold off the peaks, not off the average", () => {
    const plan = planDialogueChain(measurement, { highPassHz: 80, ratio: 3, attackMs: 10, releaseMs: 100 });
    expect(plan.thresholdDb).toBeCloseTo(measurement.peakTypicalDb - COMPRESSOR_HEADROOM_DB, 1);
    expect(plan.thresholdDb).toBeGreaterThan(measurement.loudDb - COMPRESSOR_HEADROOM_DB);
  });

  it("sets makeup to what the ratio takes off a peak, so the level lands back where it was", () => {
    const plan = planDialogueChain(measurement, { highPassHz: 80, ratio: 3, attackMs: 10, releaseMs: 100 });
    expect(plan.makeupDb).toBeCloseTo(COMPRESSOR_HEADROOM_DB * (1 - 1 / 3), 1);
  });

  it("asks for no makeup at all when the ratio is one to one", () => {
    const plan = planDialogueChain(measurement, { highPassHz: 80, ratio: 1, attackMs: 10, releaseMs: 100 });
    expect(plan.makeupDb).toBe(0);
  });

  it("honours an explicit threshold and says it was told to", () => {
    const plan = planDialogueChain(measurement, {
      highPassHz: 80,
      ratio: 4,
      attackMs: 10,
      releaseMs: 100,
      thresholdDb: -30,
    });
    expect(plan.thresholdDb).toBe(-30);
    expect(plan.reasoning.join(" ")).toMatch(/as asked/);
  });

  it("keeps the threshold inside the range the effect exposes", () => {
    const quiet = measureDialogue(build(6, (_, index) => tone(300, index, 0.00002)), 80);
    const plan = planDialogueChain(quiet, { highPassHz: 80, ratio: 3, attackMs: 10, releaseMs: 100 });
    expect(plan.thresholdDb).toBeGreaterThanOrEqual(-60);
    expect(plan.thresholdDb).toBeLessThanOrEqual(0);
  });
});

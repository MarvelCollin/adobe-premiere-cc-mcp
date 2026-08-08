import { describe, expect, it } from "vitest";
import { LEVEL_WINDOW_SECONDS, findAudioFaults } from "../src/analysis/audio-faults.js";
import {
  clipIsDucked,
  duckEnvelope,
  duckFactor,
  duckWindows,
  factorAt,
  findDuckTriggers,
  planClipKeys,
  probesForClip,
  type ClipSpan,
  type DuckShape,
} from "../src/analysis/ducking.js";
import type { DecodedAudio } from "../src/analysis/wav.js";

const SHAPE: DuckShape = {
  attackSeconds: 0.25,
  holdSeconds: 0.3,
  releaseSeconds: 0.6,
  duckDb: -12,
};

const SAMPLE_RATE = 48_000;

function build(seconds: number, fill: (time: number, index: number) => number): DecodedAudio {
  const frames = Math.floor(SAMPLE_RATE * seconds);
  const mono = new Float32Array(frames);
  for (let index = 0; index < frames; index += 1) {
    mono[index] = fill(index / SAMPLE_RATE, index);
  }
  return { sampleRate: SAMPLE_RATE, channels: 1, frames, samples: [mono] };
}

function triggersFor(audio: DecodedAudio) {
  return findDuckTriggers(findAudioFaults(audio).windows, LEVEL_WINDOW_SECONDS);
}

describe("duckFactor", () => {
  it("turns decibels into a linear multiplier", () => {
    expect(duckFactor(0)).toBeCloseTo(1, 10);
    expect(duckFactor(-6)).toBeCloseTo(0.5012, 4);
    expect(duckFactor(-12)).toBeCloseTo(0.2512, 4);
  });
});

describe("duckWindows", () => {
  it("wraps one line in an attack, a hold and a release", () => {
    const [window] = duckWindows([{ fromSeconds: 5, toSeconds: 6 }], SHAPE);
    expect(window).toEqual({
      rampStartSeconds: 4.75,
      downSeconds: 5,
      upSeconds: 6.3,
      rampEndSeconds: 6.9,
    });
  });

  it("merges lines close enough that the bed would pump between them", () => {
    const windows = duckWindows(
      [
        { fromSeconds: 5, toSeconds: 6 },
        { fromSeconds: 6.5, toSeconds: 7 },
      ],
      SHAPE,
    );
    expect(windows).toHaveLength(1);
    expect(windows[0].downSeconds).toBe(5);
    expect(windows[0].upSeconds).toBe(7.3);
    expect(windows[0].rampEndSeconds).toBeCloseTo(7.9, 4);
  });

  it("keeps lines apart when the bed has room to come back up", () => {
    const windows = duckWindows(
      [
        { fromSeconds: 5, toSeconds: 6 },
        { fromSeconds: 20, toSeconds: 21 },
      ],
      SHAPE,
    );
    expect(windows).toHaveLength(2);
  });

  it("never asks for a negative time when a line starts at the top", () => {
    const [window] = duckWindows([{ fromSeconds: 0.1, toSeconds: 1 }], SHAPE);
    expect(window.rampStartSeconds).toBe(0);
    expect(window.downSeconds).toBe(0.1);
  });

  it("drops ranges with no length", () => {
    expect(duckWindows([{ fromSeconds: 4, toSeconds: 4 }], SHAPE)).toHaveLength(0);
  });
});

describe("factorAt", () => {
  const points = duckEnvelope(duckWindows([{ fromSeconds: 5, toSeconds: 6 }], SHAPE), SHAPE.duckDb);

  it("leaves the bed alone outside the duck", () => {
    expect(factorAt(points, 0)).toBeCloseTo(1, 6);
    expect(factorAt(points, 30)).toBeCloseTo(1, 6);
  });

  it("holds the bed at the duck level across the line", () => {
    expect(factorAt(points, 5.5)).toBeCloseTo(duckFactor(-12), 4);
    expect(factorAt(points, 6.2)).toBeCloseTo(duckFactor(-12), 4);
  });

  it("ramps rather than steps", () => {
    const half = factorAt(points, 4.875);
    expect(half).toBeLessThan(1);
    expect(half).toBeGreaterThan(duckFactor(-12));
  });

  it("returns unity when nothing is ducked", () => {
    expect(factorAt([], 12)).toBe(1);
  });
});

describe("planClipKeys", () => {
  const points = duckEnvelope(duckWindows([{ fromSeconds: 5, toSeconds: 6 }], SHAPE), SHAPE.duckDb);
  const clip: ClipSpan = { startSeconds: 0, endSeconds: 20, inPointSeconds: 12 };

  it("maps timeline seconds onto the clip's own source time", () => {
    const keys = planClipKeys(points, clip);
    expect(keys[0]).toEqual({ sequenceSeconds: 0, sourceSeconds: 12, factor: 1 });
    const down = keys.find((key) => key.sequenceSeconds === 5);
    expect(down?.sourceSeconds).toBe(17);
    expect(down?.factor).toBeCloseTo(duckFactor(-12), 4);
  });

  it("anchors both ends of the clip", () => {
    const keys = planClipKeys(points, clip);
    expect(keys[0].sequenceSeconds).toBe(0);
    expect(keys[keys.length - 1].sequenceSeconds).toBe(20);
  });

  it("starts a clip already ducked when the line began before it", () => {
    const late: ClipSpan = { startSeconds: 5.5, endSeconds: 12, inPointSeconds: 0 };
    const keys = planClipKeys(points, late);
    expect(keys[0].factor).toBeCloseTo(duckFactor(-12), 4);
  });

  it("keeps existing keyframe times so a fade already on the clip survives", () => {
    const keys = planClipKeys(points, clip, [1, 2]);
    expect(keys.map((key) => key.sequenceSeconds)).toContain(1);
    expect(keys.map((key) => key.sequenceSeconds)).toContain(2);
  });

  it("ignores existing keyframe times outside the clip", () => {
    const keys = planClipKeys(points, clip, [-4, 99]);
    expect(keys.every((key) => key.sequenceSeconds >= 0 && key.sequenceSeconds <= 20)).toBe(true);
  });

  it("reports a clip no line touches as untouched", () => {
    const far: ClipSpan = { startSeconds: 40, endSeconds: 50, inPointSeconds: 0 };
    expect(clipIsDucked(planClipKeys(points, far))).toBe(false);
    expect(clipIsDucked(planClipKeys(points, clip))).toBe(true);
  });

  it("writes no duplicate times", () => {
    const keys = planClipKeys(points, clip, [5, 5.0001, 6.3]);
    const times = keys.map((key) => key.sequenceSeconds);
    expect(new Set(times).size).toBe(times.length);
  });
});

describe("probesForClip", () => {
  const windows = duckWindows(
    [
      { fromSeconds: 5, toSeconds: 6 },
      { fromSeconds: 20, toSeconds: 21 },
    ],
    SHAPE,
  );
  const clip: ClipSpan = { startSeconds: 0, endSeconds: 30, inPointSeconds: 0 };

  it("checks the bed both under a line and in the gap after it", () => {
    const probes = probesForClip(windows, clip, -12);
    expect(probes.some((probe) => probe.kind === "ducked")).toBe(true);
    expect(probes.some((probe) => probe.kind === "open")).toBe(true);
  });

  it("expects the duck level under a line and unity in the gaps", () => {
    for (const probe of probesForClip(windows, clip, -12)) {
      expect(probe.factor).toBeCloseTo(probe.kind === "ducked" ? duckFactor(-12) : 1, 4);
    }
  });

  it("only probes inside the clip", () => {
    const short: ClipSpan = { startSeconds: 19, endSeconds: 24, inPointSeconds: 3 };
    for (const probe of probesForClip(windows, short, -12)) {
      expect(probe.sequenceSeconds).toBeGreaterThan(19);
      expect(probe.sequenceSeconds).toBeLessThan(24);
      expect(probe.sourceSeconds).toBeCloseTo(probe.sequenceSeconds - 16, 4);
    }
  });
});

describe("findDuckTriggers", () => {
  it("finds the talking in a track that alternates speech and room tone", () => {
    const audio = build(8, (time, index) => {
      const room = (Math.random() * 2 - 1) * 0.002;
      const talking = time % 2 < 1;
      return talking ? room + Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE) * 0.35 : room;
    });
    const detection = triggersFor(audio);
    expect(detection.usable).toBe(true);
    expect(detection.ranges.length).toBeGreaterThanOrEqual(3);
    expect(detection.ranges[0].fromSeconds).toBeLessThan(0.2);
    expect(detection.ranges[0].toSeconds).toBeGreaterThan(0.8);
    expect(detection.ranges[0].toSeconds).toBeLessThan(1.3);
  });

  it("refuses a flat track rather than inventing a rhythm from noise", () => {
    const audio = build(6, () => (Math.random() * 2 - 1) * 0.1);
    const detection = triggersFor(audio);
    expect(detection.usable).toBe(false);
    expect(detection.ranges).toHaveLength(0);
    expect(detection.reason).toMatch(/too flat/i);
  });

  it("does not treat dither above digital silence as talking", () => {
    const audio = build(8, (time, index) => {
      const talking = time > 6;
      const dither = (Math.random() * 2 - 1) * 1e-5;
      return talking ? Math.sin((2 * Math.PI * 220 * index) / SAMPLE_RATE) * 0.4 : dither;
    });
    const detection = triggersFor(audio);
    expect(detection.usable).toBe(true);
    expect(detection.ranges).toHaveLength(1);
    expect(detection.ranges[0].fromSeconds).toBeGreaterThan(5.8);
  });

  it("joins words separated by a breath instead of pumping between them", () => {
    const audio = build(8, (time, index) => {
      const room = (Math.random() * 2 - 1) * 0.002;
      const word = time < 1 || (time > 1.2 && time < 2.2);
      return word ? room + Math.sin((2 * Math.PI * 200 * index) / SAMPLE_RATE) * 0.35 : room;
    });
    const detection = triggersFor(audio);
    const early = detection.ranges.filter((range) => range.fromSeconds < 3);
    expect(early).toHaveLength(1);
    expect(early[0].toSeconds).toBeGreaterThan(2);
  });

  it("calls a silent track silent rather than flat", () => {
    const audio = build(4, () => 0);
    const detection = triggersFor(audio);
    expect(detection.usable).toBe(false);
    expect(detection.ranges).toHaveLength(0);
    expect(detection.reason).toMatch(/rendered silent/i);
  });

  it("still calls a loud but featureless track flat", () => {
    const audio = build(6, () => (Math.random() * 2 - 1) * 0.1);
    expect(triggersFor(audio).reason).toMatch(/too flat/i);
  });

  it("handles a render too short to measure", () => {
    const detection = findDuckTriggers([], LEVEL_WINDOW_SECONDS);
    expect(detection.usable).toBe(false);
    expect(detection.reason).toMatch(/too short/i);
  });
});

describe("the whole plan for a bed under a two line read", () => {
  it("ducks under each line and comes back up between them", () => {
    const speech = [
      { fromSeconds: 2, toSeconds: 4 },
      { fromSeconds: 10, toSeconds: 12 },
    ];
    const windows = duckWindows(speech, SHAPE);
    const points = duckEnvelope(windows, SHAPE.duckDb);
    const clip: ClipSpan = { startSeconds: 0, endSeconds: 16, inPointSeconds: 30 };
    const keys = planClipKeys(points, clip);

    expect(keys[0].factor).toBe(1);
    expect(keys[keys.length - 1].factor).toBe(1);
    expect(factorAt(points, 3)).toBeCloseTo(duckFactor(-12), 4);
    expect(factorAt(points, 7)).toBeCloseTo(1, 6);
    expect(factorAt(points, 11)).toBeCloseTo(duckFactor(-12), 4);
    expect(keys.every((key) => key.sourceSeconds === key.sequenceSeconds + 30)).toBe(true);
  });
});

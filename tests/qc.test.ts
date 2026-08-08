import { describe, expect, it } from "vitest";
import { inspectFrames, type FrameProbe } from "../src/analysis/qc.js";

function signature(value: number, cells = 576): Float32Array {
  return Float32Array.from({ length: cells }, () => value);
}

function probe(atSeconds: number, luma: number, options: { white?: number } = {}): FrameProbe {
  return {
    atSeconds,
    meanLuma: luma,
    whitePoint: options.white ?? Math.min(255, luma + 40),
    peakSaturation: 10,
    signature: signature(luma),
  };
}

function moving(atSeconds: number, luma: number, seed: number): FrameProbe {
  const cells = Float32Array.from({ length: 576 }, (_, index) => luma + ((index * seed) % 17));
  return { atSeconds, meanLuma: luma, whitePoint: luma + 40, peakSaturation: 10, signature: cells };
}

describe("inspectFrames", () => {
  it("passes ordinary footage", () => {
    const probes = [moving(0, 100, 3), moving(0.5, 104, 5), moving(1, 98, 7), moving(1.5, 101, 11)];
    const report = inspectFrames(probes);
    expect(report.clean, JSON.stringify(report.findings)).toBe(true);
  });

  it("finds a black frame", () => {
    const report = inspectFrames([moving(0, 100, 3), probe(0.5, 1, { white: 2 }), moving(1, 100, 5)]);
    const black = report.findings.filter((finding) => finding.kind === "black_frame");
    expect(black).toHaveLength(1);
    expect(black[0].fromSeconds).toBe(0.5);
    expect(black[0].toSeconds).toBe(0.5);
    expect(black[0].frames).toBe(1);
    expect(black[0].severity).toBe("fail");
  });

  it("finds a freeze", () => {
    const still = signature(120);
    const probes: FrameProbe[] = [0, 0.5, 1].map((atSeconds) => ({
      atSeconds,
      meanLuma: 120,
      whitePoint: 160,
      peakSaturation: 8,
      signature: still,
    }));
    expect(report(probes, "freeze_frame")).toBeGreaterThan(0);
  });

  it("flags flashing above the photosensitivity guideline", () => {
    const probes: FrameProbe[] = [];
    for (let index = 0; index < 10; index += 1) {
      const bright = index % 2 === 0;
      probes.push({
        atSeconds: index * 0.1,
        meanLuma: bright ? 220 : 20,
        whitePoint: bright ? 255 : 40,
        peakSaturation: 5,
        signature: signature(bright ? 220 : 20),
      });
    }
    const found = inspectFrames(probes);
    expect(found.findings.some((finding) => finding.kind === "flash")).toBe(true);
    expect(found.flashRatePerSecond).toBeGreaterThanOrEqual(3);
  });

  it("ignores a slow fade, which is not a flash", () => {
    const probes: FrameProbe[] = [];
    for (let index = 0; index < 8; index += 1) {
      const luma = 20 + index * 25;
      probes.push({
        atSeconds: index * 1.0,
        meanLuma: luma,
        whitePoint: luma + 30,
        peakSaturation: 5,
        signature: signature(luma),
      });
    }
    const found = inspectFrames(probes);
    expect(found.findings.some((finding) => finding.kind === "flash")).toBe(false);
  });

  it("handles nothing sampled", () => {
    expect(inspectFrames([]).clean).toBe(true);
  });

  it("collapses a run of black frames into one range", () => {
    const probes = [moving(0, 100, 3)];
    for (let index = 1; index <= 5; index += 1) probes.push(probe(index * 0.5, 1, { white: 2 }));
    probes.push(moving(3.5, 100, 5));

    const black = inspectFrames(probes).findings.filter((finding) => finding.kind === "black_frame");
    expect(black).toHaveLength(1);
    expect(black[0].frames).toBe(5);
    expect(black[0].fromSeconds).toBe(0.5);
    expect(black[0].toSeconds).toBe(2.5);
  });
});

function report(probes: FrameProbe[], kind: string): number {
  return inspectFrames(probes).findings.filter((finding) => finding.kind === kind).length;
}

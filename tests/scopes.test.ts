import { describe, expect, it } from "vitest";
import { planShotMatch, readScopes } from "../src/analysis/scopes.js";
import type { DecodedImage } from "../src/analysis/png.js";

function solid(red: number, green: number, blue: number, size = 64): DecodedImage {
  const pixels = Buffer.alloc(size * size * 3);
  for (let index = 0; index < size * size; index += 1) {
    pixels[index * 3] = red;
    pixels[index * 3 + 1] = green;
    pixels[index * 3 + 2] = blue;
  }
  return { width: size, height: size, channels: 3, pixels };
}

function ramp(from: number, to: number, size = 64): DecodedImage {
  const pixels = Buffer.alloc(size * size * 3);
  for (let row = 0; row < size; row += 1) {
    for (let column = 0; column < size; column += 1) {
      const value = Math.round(from + ((to - from) * column) / (size - 1));
      const at = (row * size + column) * 3;
      pixels[at] = value;
      pixels[at + 1] = value;
      pixels[at + 2] = value;
    }
  }
  return { width: size, height: size, channels: 3, pixels };
}

describe("readScopes", () => {
  it("reads a mid grey as neutral and unsaturated", () => {
    const scopes = readScopes(solid(128, 128, 128));
    expect(scopes.waveform.mid).toBe(128);
    expect(scopes.vectorscope.meanSaturation).toBeLessThan(1);
    expect(scopes.parade.red.mean).toBeCloseTo(scopes.parade.blue.mean, 5);
  });

  it("separates the channels on a colour cast", () => {
    const scopes = readScopes(solid(200, 120, 90));
    expect(scopes.parade.red.mean).toBeGreaterThan(scopes.parade.green.mean);
    expect(scopes.parade.green.mean).toBeGreaterThan(scopes.parade.blue.mean);
    expect(scopes.vectorscope.meanSaturation).toBeGreaterThan(10);
  });

  it("reports the full range of a ramp", () => {
    const scopes = readScopes(ramp(0, 255));
    expect(scopes.waveform.black).toBeLessThan(10);
    expect(scopes.waveform.white).toBeGreaterThan(245);
  });

  it("flags illegal levels", () => {
    const legal = readScopes(ramp(20, 230));
    expect(legal.illegal.belowBlack).toBe(0);
    expect(legal.illegal.aboveWhite).toBe(0);

    const illegal = readScopes(ramp(0, 255));
    expect(illegal.illegal.belowBlack).toBeGreaterThan(0);
    expect(illegal.illegal.aboveWhite).toBeGreaterThan(0);
  });

  it("finds skin near the skin tone line", () => {
    const scopes = readScopes(solid(215, 160, 130));
    expect(scopes.skin).not.toBeNull();
    expect(Math.abs(scopes.skin!.deviationDegrees), scopes.skin!.verdict).toBeLessThan(20);
  });

  it("reports no skin when there is none", () => {
    expect(readScopes(solid(30, 90, 200)).skin).toBeNull();
  });
});

describe("planShotMatch", () => {
  it("asks for nothing when the shots already match", () => {
    const scopes = readScopes(solid(140, 130, 120));
    expect(planShotMatch(scopes, scopes)).toEqual([]);
  });

  it("moves a dark target towards a brighter reference", () => {
    const moves = planShotMatch(readScopes(ramp(20, 230)), readScopes(ramp(5, 150)));
    const fields = moves.map((move) => move.field);
    expect(fields).toContain("whites");
    expect(moves.find((move) => move.field === "whites")!.amount).toBeGreaterThan(0);
  });

  it("cools a target that is warmer than the reference", () => {
    const moves = planShotMatch(readScopes(solid(150, 150, 150)), readScopes(solid(200, 150, 110)));
    const temperature = moves.find((move) => move.field === "temperature");
    expect(temperature, "expected a temperature move").toBeDefined();
    expect(temperature!.amount).toBeLessThan(0);
  });

  it("keeps every move inside the Lumetri range", () => {
    const moves = planShotMatch(readScopes(solid(255, 255, 255)), readScopes(solid(0, 0, 0)));
    for (const move of moves) {
      if (move.field === "exposure") expect(Math.abs(move.amount)).toBeLessThanOrEqual(2);
      else if (move.field === "saturation") expect(move.amount).toBeGreaterThanOrEqual(40);
      else expect(Math.abs(move.amount)).toBeLessThanOrEqual(60);
    }
  });
});

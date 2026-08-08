import { describe, expect, it } from "vitest";
import { allTools } from "../src/tools/index.js";
import { decibelsToLevel, levelToDecibels } from "../src/premiere/constants.js";

describe("tool registry", () => {
  it("exposes a stable set of tools", () => {
    expect(allTools.length).toBeGreaterThan(0);
  });

  it("has no duplicate names", () => {
    const names = allTools.map((tool) => tool.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it("uses snake_case names", () => {
    for (const tool of allTools) {
      expect(tool.name).toMatch(/^[a-z][a-z0-9_]*$/);
    }
  });

  it("describes every tool well enough for a model to choose it", () => {
    for (const tool of allTools) {
      expect(tool.description.length, `${tool.name} description`).toBeGreaterThan(40);
    }
  });

  it("describes every parameter", () => {
    for (const tool of allTools) {
      for (const [field, schema] of Object.entries(tool.schema)) {
        const described = (schema as { description?: string }).description !== undefined;
        // Enums and defaults are self documenting; everything else needs prose.
        if (!described) {
          expect(
            (schema as { _def?: { typeName?: string } })._def?.typeName,
            `${tool.name}.${field} needs a description`,
          ).toMatch(/ZodEnum|ZodDefault|ZodOptional/);
        }
      }
    }
  });

  it("exposes a handler for every tool", () => {
    for (const tool of allTools) {
      expect(typeof tool.handler, tool.name).toBe("function");
    }
  });
});

describe("decibel conversion", () => {
  it("treats 0 dB as unity", () => {
    expect(decibelsToLevel(0)).toBeCloseTo(1, 10);
  });

  it("round trips", () => {
    for (const db of [-26, -14, -6, 0]) {
      expect(levelToDecibels(decibelsToLevel(db))).toBeCloseTo(db, 6);
    }
  });

  it("matches the levels observed in Premiere", () => {
    expect(decibelsToLevel(-14)).toBeCloseTo(0.1995, 4);
    expect(decibelsToLevel(-26)).toBeCloseTo(0.0501, 4);
  });
});

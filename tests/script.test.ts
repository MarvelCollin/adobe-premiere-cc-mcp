import { describe, expect, it } from "vitest";
import { esc, wrapScript } from "../src/bridge/script.js";

describe("esc", () => {
  it("escapes characters that would break out of a generated string literal", () => {
    expect(esc('say "hi"')).toBe('say \\"hi\\"');
    expect(esc("C:\\Users\\me")).toBe("C:\\\\Users\\\\me");
    expect(esc("line1\nline2")).toBe("line1\\nline2");
  });

  it("keeps a Windows path usable inside ExtendScript source", () => {
    const generated = `var f = new File("${esc("C:\\Users\\kowlin\\clip.png")}");`;
    expect(generated).toBe('var f = new File("C:\\\\Users\\\\kowlin\\\\clip.png");');
  });
});

describe("wrapScript", () => {
  const script = wrapScript('return __result({ ok: 1 });');

  it("wraps the body in an IIFE the panel can evaluate directly", () => {
    expect(script.startsWith("(function () {")).toBe(true);
    expect(script.trimEnd().endsWith("})();")).toBe(true);
  });

  it("provides the helpers tools rely on", () => {
    for (const helper of [
      "__result",
      "__error",
      "__findClip",
      "__qeClipAt",
      "__qeTrackFor",
      "__component",
      "__property",
      "__componentNames",
      "__clearKeys",
      "__ticksToSeconds",
      "__secondsToTicks",
    ]) {
      expect(script).toContain(`function ${helper}(`);
    }
  });

  it("catches host errors so a throw still returns an envelope", () => {
    expect(script).toContain("catch (err)");
    expect(script).toContain('__error("ExtendScript error: "');
  });

  it("stays ES3: no let, const or arrow functions in generated helpers", () => {
    const helpers = script.slice(0, script.indexOf("try {"));
    expect(helpers).not.toMatch(/\blet\s/);
    expect(helpers).not.toMatch(/\bconst\s/);
    expect(helpers).not.toMatch(/=>/);
  });
});

import { describe, expect, it } from "vitest";
import { toHostPath } from "../src/premiere/paths.js";

describe("toHostPath", () => {
  it("converts forward slashes to native Windows separators", () => {
    expect(toHostPath("C:/Users/me/clip.mp4")).toBe("C:\\Users\\me\\clip.mp4");
  });

  it("leaves an already native path alone", () => {
    expect(toHostPath("C:\\Users\\me\\clip.mp4")).toBe("C:\\Users\\me\\clip.mp4");
  });

  it("handles mixed separators", () => {
    expect(toHostPath("C:\\DATA/Adobe/preset.epr")).toBe("C:\\DATA\\Adobe\\preset.epr");
  });

  it("preserves spaces and punctuation used in Adobe preset names", () => {
    expect(toHostPath("C:/DATA/Adobe Premiere Pro 2026/00 - Match Source - High bitrate.epr")).toBe(
      "C:\\DATA\\Adobe Premiere Pro 2026\\00 - Match Source - High bitrate.epr",
    );
  });
});

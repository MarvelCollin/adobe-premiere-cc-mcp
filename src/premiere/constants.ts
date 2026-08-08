export const LUMETRI_PROPERTY = {
  temperature: 14,
  tint: 15,
  saturation: 16,
  exposure: 19,
  contrast: 20,
  highlights: 21,
  shadows: 22,
  whites: 23,
  blacks: 24,
  lookName: 33,
  lookIntensity: 38,
} as const;

export type LumetriField = keyof typeof LUMETRI_PROPERTY;

export const WARP_PROPERTY = {
  result: 3,
  smoothness: 4,
  method: 5,
  framing: 9,
  autoScale: 10,
  maxScale: 11,
} as const;

export const WARP_RESULT = {
  smooth_motion: 0,
  no_motion: 1,
} as const;

export type WarpMode = keyof typeof WARP_RESULT;

export const PRESET_SUBFOLDERS = [
  "MediaIO/systempresets",
  "Settings/EncoderPresets",
  "Settings/IngestPresets",
] as const;

export const decibelsToLevel = (db: number): number => Math.pow(10, db / 20);
export const levelToDecibels = (level: number): number =>
  level <= 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(level);

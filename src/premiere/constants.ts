/**
 * Property indexes for Premiere's built-in effects.
 *
 * Lumetri and Warp Stabilizer both repeat display names across sub-sections, so
 * looking a property up by name returns the wrong one. Index access is the only
 * reliable route. These were read back off a live Premiere Pro 26.2 host.
 */

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
  /** Readable, but assigning it does NOT load the LUT. Pick looks in the Lumetri panel. */
  lookName: 33,
  lookIntensity: 38,
} as const;

export type LumetriField = keyof typeof LUMETRI_PROPERTY;

export const WARP_PROPERTY = {
  /** 0 = Smooth Motion (keeps camera movement), 1 = No Motion (locked frame). */
  result: 3,
  smoothness: 4,
  method: 5,
  framing: 9,
  /** Its DISPLAY NAME carries the solve state: a percentage means analysed. */
  autoScale: 10,
  maxScale: 11,
} as const;

export const WARP_RESULT = {
  smooth_motion: 0,
  no_motion: 1,
} as const;

export type WarpMode = keyof typeof WARP_RESULT;

/** Premiere ships its own presets; Media Encoder does not have to be installed. */
export const PRESET_SUBFOLDERS = [
  "MediaIO/systempresets",
  "Settings/EncoderPresets",
  "Settings/IngestPresets",
] as const;

export const decibelsToLevel = (db: number): number => Math.pow(10, db / 20);
export const levelToDecibels = (level: number): number =>
  level <= 0 ? Number.NEGATIVE_INFINITY : 20 * Math.log10(level);

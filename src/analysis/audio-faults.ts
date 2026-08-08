import type { DecodedAudio } from "./wav.js";

export interface LevelWindow {
  atSeconds: number;
  rmsDb: number;
  peakDb: number;
}

export interface AudioFaults {
  windows: LevelWindow[];
  silentRanges: { fromSeconds: number; toSeconds: number }[];
  clippedRanges: { fromSeconds: number; toSeconds: number; samples: number }[];
  activeRanges: { fromSeconds: number; toSeconds: number }[];
  noiseFloorDb: number;
  activeSharePercent: number;
  summary: string;
}

const WINDOW_SECONDS = 0.05;
const SILENCE_DB = -60;
const CLIP_THRESHOLD = 0.999;
const ACTIVE_MARGIN_DB = 12;

function toDb(value: number): number {
  return value <= 0 ? -Infinity : Math.round(20 * Math.log10(value) * 100) / 100;
}

function mergeRanges(
  times: number[],
  windowSeconds: number,
  gapTolerance: number,
): { fromSeconds: number; toSeconds: number }[] {
  const ranges: { fromSeconds: number; toSeconds: number }[] = [];
  for (const time of times) {
    const last = ranges[ranges.length - 1];
    if (last && time - last.toSeconds <= gapTolerance) {
      last.toSeconds = Math.round((time + windowSeconds) * 1000) / 1000;
      continue;
    }
    ranges.push({
      fromSeconds: Math.round(time * 1000) / 1000,
      toSeconds: Math.round((time + windowSeconds) * 1000) / 1000,
    });
  }
  return ranges;
}

export function findAudioFaults(audio: DecodedAudio): AudioFaults {
  const windowSize = Math.max(1, Math.round(audio.sampleRate * WINDOW_SECONDS));
  const windows: LevelWindow[] = [];
  const silentAt: number[] = [];
  const clippedWindows: { atSeconds: number; samples: number }[] = [];

  for (let start = 0; start + windowSize <= audio.frames; start += windowSize) {
    let sum = 0;
    let peak = 0;
    let clipped = 0;

    for (let channel = 0; channel < audio.channels; channel += 1) {
      const samples = audio.samples[channel];
      for (let offset = 0; offset < windowSize; offset += 1) {
        const value = samples[start + offset];
        sum += value * value;
        const magnitude = Math.abs(value);
        if (magnitude > peak) peak = magnitude;
        if (magnitude >= CLIP_THRESHOLD) clipped += 1;
      }
    }

    const rms = Math.sqrt(sum / (windowSize * audio.channels));
    const atSeconds = Math.round((start / audio.sampleRate) * 1000) / 1000;
    const rmsDb = toDb(rms);

    windows.push({ atSeconds, rmsDb: rmsDb === -Infinity ? -120 : rmsDb, peakDb: toDb(peak) === -Infinity ? -120 : toDb(peak) });
    if (rmsDb < SILENCE_DB) silentAt.push(atSeconds);
    if (clipped > 0) clippedWindows.push({ atSeconds, samples: clipped });
  }

  if (windows.length === 0) {
    return {
      windows,
      silentRanges: [],
      clippedRanges: [],
      activeRanges: [],
      noiseFloorDb: -120,
      activeSharePercent: 0,
      summary: "The audio is too short to measure.",
    };
  }

  const sorted = windows.map((window) => window.rmsDb).sort((a, b) => a - b);
  const noiseFloorDb = sorted[Math.floor(sorted.length * 0.1)];
  const activeThreshold = noiseFloorDb + ACTIVE_MARGIN_DB;

  const activeAt = windows
    .filter((window) => window.rmsDb > activeThreshold)
    .map((window) => window.atSeconds);

  const activeRanges = mergeRanges(activeAt, WINDOW_SECONDS, WINDOW_SECONDS * 6).filter(
    (range) => range.toSeconds - range.fromSeconds >= 0.15,
  );

  const clippedRanges = mergeRanges(
    clippedWindows.map((entry) => entry.atSeconds),
    WINDOW_SECONDS,
    WINDOW_SECONDS * 2,
  ).map((range) => ({
    ...range,
    samples: clippedWindows
      .filter((entry) => entry.atSeconds >= range.fromSeconds && entry.atSeconds <= range.toSeconds)
      .reduce((total, entry) => total + entry.samples, 0),
  }));

  const activeSeconds = activeRanges.reduce(
    (total, range) => total + (range.toSeconds - range.fromSeconds),
    0,
  );
  const duration = audio.frames / audio.sampleRate;
  const activeSharePercent = duration > 0 ? Math.round((activeSeconds / duration) * 1000) / 10 : 0;

  const notes: string[] = [];
  if (clippedRanges.length > 0) notes.push(`${clippedRanges.length} clipped passage(s)`);
  const silentRanges = mergeRanges(silentAt, WINDOW_SECONDS, WINDOW_SECONDS * 4).filter(
    (range) => range.toSeconds - range.fromSeconds >= 0.5,
  );
  if (silentRanges.length > 0) notes.push(`${silentRanges.length} silent stretch(es)`);
  if (noiseFloorDb > -45) notes.push(`a high noise floor at ${noiseFloorDb} dB`);

  return {
    windows,
    silentRanges,
    clippedRanges,
    activeRanges,
    noiseFloorDb,
    activeSharePercent,
    summary: notes.length === 0 ? "No silence, clipping or excessive noise found." : `Found ${notes.join(", ")}.`,
  };
}

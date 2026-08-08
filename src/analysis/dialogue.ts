import { hannWindow, magnitudeSpectrum } from "./fft.js";
import type { DecodedAudio } from "./wav.js";

export interface DialogueMeasurement {
  loudDb: number;
  floorDb: number;
  peakDb: number;
  peakTypicalDb: number;
  crestDb: number;
  levelSpreadDb: number;
  rumbleDb: number;
  sibilanceDb: number;
  activeSharePercent: number;
  measurable: boolean;
  reason: string | null;
}

export interface DialoguePlan {
  highPassHz: number;
  thresholdDb: number;
  ratio: number;
  attackMs: number;
  releaseMs: number;
  makeupDb: number;
  reasoning: string[];
}

const SPECTRUM_SIZE = 8192;
const ACTIVE_MARGIN_DB = 12;
const SIBILANCE_FROM_HZ = 5_000;
const SIBILANCE_TO_HZ = 9_000;

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function toDb(value: number): number {
  return value > 0 ? 20 * Math.log10(value) : -120;
}

function mono(audio: DecodedAudio, index: number): number {
  let sum = 0;
  for (let channel = 0; channel < audio.channels; channel += 1) sum += audio.samples[channel][index];
  return sum / audio.channels;
}

export function measureDialogue(audio: DecodedAudio, rumbleBelowHz: number): DialogueMeasurement {
  const blank: DialogueMeasurement = {
    loudDb: -120,
    floorDb: -120,
    peakDb: -120,
    peakTypicalDb: -120,
    crestDb: 0,
    levelSpreadDb: 0,
    rumbleDb: -120,
    sibilanceDb: -120,
    activeSharePercent: 0,
    measurable: false,
    reason: "The render was too short to measure.",
  };

  const windowSize = Math.max(1, Math.round(audio.sampleRate * 0.05));
  if (audio.frames < windowSize * 8) return blank;

  const windowDb: number[] = [];
  const windowPeakDb: number[] = [];
  for (let start = 0; start + windowSize <= audio.frames; start += windowSize) {
    let sum = 0;
    let windowPeak = 0;
    for (let index = start; index < start + windowSize; index += 1) {
      const value = mono(audio, index);
      sum += value * value;
      const magnitude = Math.abs(value);
      if (magnitude > windowPeak) windowPeak = magnitude;
    }
    windowDb.push(toDb(Math.sqrt(sum / windowSize)));
    windowPeakDb.push(toDb(windowPeak));
  }

  const sorted = windowDb.slice().sort((a, b) => a - b);
  const floorDb = sorted[Math.floor(sorted.length * 0.1)];
  const loudDb = sorted[Math.floor(sorted.length * 0.95)];

  if (loudDb <= -70) {
    return { ...blank, floorDb: round(floorDb), loudDb: round(loudDb), reason: "The render is silent." };
  }

  const activeThreshold = Math.min(loudDb - 1, Math.max(floorDb + ACTIVE_MARGIN_DB, loudDb - 25));
  const activeWindows: number[] = [];
  for (let index = 0; index < windowDb.length; index += 1) {
    if (windowDb[index] > activeThreshold) activeWindows.push(index);
  }

  if (activeWindows.length < 4) {
    return {
      ...blank,
      floorDb: round(floorDb),
      loudDb: round(loudDb),
      reason: "Too little of the track rises above its own noise floor to measure a dialogue chain against.",
    };
  }

  let activeSquares = 0;
  let activeSamples = 0;
  let peak = 0;
  for (const window of activeWindows) {
    const start = window * windowSize;
    for (let index = start; index < start + windowSize; index += 1) {
      const value = mono(audio, index);
      activeSquares += value * value;
      activeSamples += 1;
      const magnitude = Math.abs(value);
      if (magnitude > peak) peak = magnitude;
    }
  }
  const activeRms = Math.sqrt(activeSquares / activeSamples);
  const activePeaks = activeWindows.map((index) => windowPeakDb[index]).sort((a, b) => a - b);
  const peakTypicalDb = activePeaks[Math.floor(activePeaks.length * 0.95)];
  const activeLevels = activeWindows.map((index) => windowDb[index]).sort((a, b) => a - b);
  const levelSpreadDb =
    activeLevels[Math.floor(activeLevels.length * 0.95)] - activeLevels[Math.floor(activeLevels.length * 0.2)];

  const window = hannWindow(SPECTRUM_SIZE);
  const spectrum = new Float64Array(SPECTRUM_SIZE / 2);
  let frames = 0;
  for (const activeIndex of activeWindows) {
    const start = activeIndex * windowSize;
    if (start + SPECTRUM_SIZE > audio.frames) continue;
    const frame = new Float32Array(SPECTRUM_SIZE);
    for (let index = 0; index < SPECTRUM_SIZE; index += 1) frame[index] = mono(audio, start + index) * window[index];
    const magnitudes = magnitudeSpectrum(frame);
    for (let bin = 0; bin < spectrum.length; bin += 1) spectrum[bin] += magnitudes[bin] * magnitudes[bin];
    frames += 1;
    if (frames >= 60) break;
  }

  if (frames === 0) {
    return {
      ...blank,
      floorDb: round(floorDb),
      loudDb: round(loudDb),
      reason: "No stretch of the track was long enough for a spectrum.",
    };
  }

  const binHz = audio.sampleRate / SPECTRUM_SIZE;
  let total = 0;
  let rumble = 0;
  let sibilance = 0;
  for (let bin = 1; bin < spectrum.length; bin += 1) {
    const energy = spectrum[bin];
    const hz = bin * binHz;
    total += energy;
    if (hz < rumbleBelowHz) rumble += energy;
    if (hz >= SIBILANCE_FROM_HZ && hz <= SIBILANCE_TO_HZ) sibilance += energy;
  }

  return {
    loudDb: round(loudDb),
    floorDb: round(floorDb),
    peakDb: round(toDb(peak)),
    peakTypicalDb: round(peakTypicalDb),
    crestDb: round(toDb(peak) - toDb(activeRms)),
    levelSpreadDb: round(levelSpreadDb),
    rumbleDb: round(total > 0 ? 10 * Math.log10(Math.max(rumble, 1e-20) / total) : -120),
    sibilanceDb: round(total > 0 ? 10 * Math.log10(Math.max(sibilance, 1e-20) / total) : -120),
    activeSharePercent: round((activeWindows.length / windowDb.length) * 100),
    measurable: true,
    reason: null,
  };
}

export const COMPRESSOR_HEADROOM_DB = 10;

export function planDialogueChain(
  measurement: DialogueMeasurement,
  options: {
    highPassHz: number;
    ratio: number;
    attackMs: number;
    releaseMs: number;
    thresholdDb?: number;
  },
): DialoguePlan {
  const reasoning: string[] = [];

  reasoning.push(
    `High pass at ${options.highPassHz} Hz. Energy below that point currently sits ${Math.abs(measurement.rumbleDb)} dB under the band as a whole, and speech has nothing to lose down there.`,
  );

  const automatic = round(measurement.peakTypicalDb - COMPRESSOR_HEADROOM_DB);
  const thresholdDb = Math.max(-60, Math.min(0, options.thresholdDb ?? automatic));

  if (options.thresholdDb === undefined) {
    reasoning.push(
      `Threshold ${thresholdDb} dB, ${COMPRESSOR_HEADROOM_DB} under the ${measurement.peakTypicalDb} dB this track actually peaks at. The threshold has to be read off the peaks, not off the average: this track averages ${measurement.loudDb} dB, and a threshold set down there would sit under everything and just turn the whole take down instead of levelling it.`,
    );
  } else {
    reasoning.push(`Threshold ${thresholdDb} dB, as asked, against peaks of ${measurement.peakTypicalDb} dB.`);
  }

  const overshoot = Math.max(0, measurement.peakTypicalDb - thresholdDb);
  const makeupDb = round(Math.min(18, overshoot * (1 - 1 / options.ratio)));
  reasoning.push(
    `Makeup ${makeupDb} dB, which is what ${options.ratio}:1 takes off a peak that far over, so the loud parts land back where they were and the quiet parts come up under them. The test of that is the spread between the loud and quiet stretches, currently ${measurement.levelSpreadDb} dB, which should narrow.`,
  );

  return {
    highPassHz: options.highPassHz,
    thresholdDb,
    ratio: options.ratio,
    attackMs: options.attackMs,
    releaseMs: options.releaseMs,
    makeupDb,
    reasoning,
  };
}

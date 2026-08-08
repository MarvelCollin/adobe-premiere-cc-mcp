export const EQ_PROPERTY = {
  lowShelfFrequency: 1,
  lowShelfGain: 2,
  highShelfFrequency: 3,
  highShelfGain: 4,
  masterGain: 25,
  highPassEnable: 38,
  highPassFrequency: 39,
  highPassSlope: 40,
  lowPassEnable: 41,
  lowPassFrequency: 42,
  bypass: 44,
} as const;

export const COMPRESSOR_PROPERTY = {
  gain: 1,
  threshold: 2,
  ratio: 3,
  attack: 4,
  release: 5,
  autoMakeupGain: 6,
} as const;

export const EQ_FREQUENCY_FLOOR_HZ = 20;
export const EQ_FREQUENCY_SPAN_HZ = 23_980;

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value));

export function eqFrequencyToNormalised(hz: number): number {
  return clamp01((hz - EQ_FREQUENCY_FLOOR_HZ) / EQ_FREQUENCY_SPAN_HZ);
}

export function normalisedToEqFrequency(value: number): number {
  return EQ_FREQUENCY_FLOOR_HZ + clamp01(value) * EQ_FREQUENCY_SPAN_HZ;
}

export function compressorThresholdToNormalised(db: number): number {
  return clamp01((db + 60) / 60);
}

export function normalisedToCompressorThreshold(value: number): number {
  return clamp01(value) * 60 - 60;
}

export function compressorRatioToNormalised(ratio: number): number {
  return clamp01((ratio - 1) / 29);
}

export function normalisedToCompressorRatio(value: number): number {
  return 1 + clamp01(value) * 29;
}

export function compressorAttackToNormalised(milliseconds: number): number {
  return clamp01(milliseconds / 500);
}

export function compressorReleaseToNormalised(milliseconds: number): number {
  return clamp01(milliseconds / 5000);
}

export function compressorGainToNormalised(db: number): number {
  return clamp01((db + 30) / 60);
}

export function normalisedToCompressorGain(value: number): number {
  return clamp01(value) * 60 - 30;
}

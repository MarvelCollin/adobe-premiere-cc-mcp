import type { DecodedImage } from "./png.js";

export interface MotionSample {
  atSeconds: number;
  motion: number;
}

export interface MotionPeak {
  atSeconds: number;
  motion: number;
  share: number;
}

export interface MotionReading {
  samples: MotionSample[];
  meanMotion: number;
  peakMotion: number;
  peaks: MotionPeak[];
  steadiness: string;
}

const GRID = 24;
const MIN_PEAK_MOTION = 2;

export function motionSignature(image: DecodedImage): Float32Array {
  const { width, height, channels, pixels } = image;
  const signature = new Float32Array(GRID * GRID);
  const cellWidth = Math.max(1, Math.floor(width / GRID));
  const cellHeight = Math.max(1, Math.floor(height / GRID));

  for (let row = 0; row < GRID; row += 1) {
    for (let column = 0; column < GRID; column += 1) {
      let sum = 0;
      let count = 0;
      const startY = row * cellHeight;
      const startX = column * cellWidth;

      for (let y = startY; y < startY + cellHeight && y < height; y += 2) {
        for (let x = startX; x < startX + cellWidth && x < width; x += 2) {
          const at = (y * width + x) * channels;
          sum += 0.2126 * pixels[at] + 0.7152 * pixels[at + 1] + 0.0722 * pixels[at + 2];
          count += 1;
        }
      }
      signature[row * GRID + column] = count > 0 ? sum / count : 0;
    }
  }
  return signature;
}

export function frameDifference(before: Float32Array, after: Float32Array): number {
  let total = 0;
  for (let cell = 0; cell < before.length; cell += 1) {
    total += Math.abs(after[cell] - before[cell]);
  }
  return Math.round((total / before.length) * 100) / 100;
}

export function readMotion(samples: MotionSample[]): MotionReading {
  if (samples.length === 0) {
    return { samples, meanMotion: 0, peakMotion: 0, peaks: [], steadiness: "Nothing measured." };
  }

  let sum = 0;
  let peakMotion = 0;
  for (const sample of samples) {
    sum += sample.motion;
    if (sample.motion > peakMotion) peakMotion = sample.motion;
  }
  const meanMotion = Math.round((sum / samples.length) * 100) / 100;

  const peaks: MotionPeak[] = [];
  for (let index = 1; index < samples.length - 1; index += 1) {
    const previous = samples[index - 1].motion;
    const current = samples[index].motion;
    const next = samples[index + 1].motion;
    if (
      current > previous &&
      current >= next &&
      current > meanMotion * 1.4 &&
      current >= MIN_PEAK_MOTION
    ) {
      peaks.push({
        atSeconds: samples[index].atSeconds,
        motion: current,
        share: peakMotion > 0 ? Math.round((current / peakMotion) * 100) / 100 : 0,
      });
    }
  }
  peaks.sort((a, b) => b.motion - a.motion);

  let steadiness: string;
  if (peakMotion < 2) {
    steadiness = "Almost nothing moves, so there is no action to cut on.";
  } else if (peakMotion > meanMotion * 3) {
    steadiness = "One clear burst of movement, which is the natural cut point.";
  } else if (meanMotion > 12) {
    steadiness = "Movement throughout, so the cut can land almost anywhere without jarring.";
  } else {
    steadiness = "Movement is even, with no single dominant action.";
  }

  return { samples, meanMotion, peakMotion, peaks: peaks.slice(0, 8), steadiness };
}

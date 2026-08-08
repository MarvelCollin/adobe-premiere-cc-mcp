import type { DecodedImage } from "./png.js";

export interface ChannelStats {
  black: number;
  shadow: number;
  mid: number;
  highlight: number;
  white: number;
  mean: number;
}

export interface SkinReading {
  pixelShare: number;
  meanHueDegrees: number;
  deviationDegrees: number;
  meanSaturation: number;
  verdict: string;
}

export interface ScopeReading {
  waveform: ChannelStats;
  parade: { red: ChannelStats; green: ChannelStats; blue: ChannelStats };
  vectorscope: { meanHueDegrees: number; meanSaturation: number; peakSaturation: number };
  illegal: { belowBlack: number; aboveWhite: number };
  skin: SkinReading | null;
}

const SKIN_TONE_LINE_DEGREES = 123;
const SAMPLE_TARGET = 60_000;

function percentileFrom(histogram: Uint32Array, count: number, fraction: number): number {
  const target = count * fraction;
  let seen = 0;
  for (let value = 0; value < histogram.length; value += 1) {
    seen += histogram[value];
    if (seen >= target) return value;
  }
  return histogram.length - 1;
}

function statsFrom(histogram: Uint32Array, count: number, sum: number): ChannelStats {
  return {
    black: percentileFrom(histogram, count, 0.01),
    shadow: percentileFrom(histogram, count, 0.25),
    mid: percentileFrom(histogram, count, 0.5),
    highlight: percentileFrom(histogram, count, 0.75),
    white: percentileFrom(histogram, count, 0.99),
    mean: Math.round((sum / count) * 100) / 100,
  };
}

function hueAngle(red: number, green: number, blue: number): number {
  const chromaB = -0.168736 * red - 0.331264 * green + 0.5 * blue;
  const chromaR = 0.5 * red - 0.418688 * green - 0.081312 * blue;
  const degrees = (Math.atan2(chromaR, chromaB) * 180) / Math.PI;
  return degrees < 0 ? degrees + 360 : degrees;
}

function chromaMagnitude(red: number, green: number, blue: number): number {
  const chromaB = -0.168736 * red - 0.331264 * green + 0.5 * blue;
  const chromaR = 0.5 * red - 0.418688 * green - 0.081312 * blue;
  return Math.sqrt(chromaB * chromaB + chromaR * chromaR);
}

function looksLikeSkin(red: number, green: number, blue: number): boolean {
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  return (
    red > 95 &&
    green > 40 &&
    blue > 20 &&
    max - min > 15 &&
    Math.abs(red - green) > 15 &&
    red > green &&
    green > blue
  );
}

export function readScopes(image: DecodedImage): ScopeReading {
  const { width, height, channels, pixels } = image;
  const total = width * height;
  const step = Math.max(1, Math.floor(total / SAMPLE_TARGET));

  const luma = new Uint32Array(256);
  const redHistogram = new Uint32Array(256);
  const greenHistogram = new Uint32Array(256);
  const blueHistogram = new Uint32Array(256);

  let count = 0;
  let lumaSum = 0;
  let redSum = 0;
  let greenSum = 0;
  let blueSum = 0;
  let belowBlack = 0;
  let aboveWhite = 0;

  let hueX = 0;
  let hueY = 0;
  let saturationSum = 0;
  let peakSaturation = 0;

  let skinCount = 0;
  let skinHueX = 0;
  let skinHueY = 0;
  let skinSaturation = 0;

  for (let index = 0; index < total; index += step) {
    const at = index * channels;
    const red = pixels[at];
    const green = pixels[at + 1];
    const blue = pixels[at + 2];

    const value = Math.round(0.2126 * red + 0.7152 * green + 0.0722 * blue);
    luma[value] += 1;
    redHistogram[red] += 1;
    greenHistogram[green] += 1;
    blueHistogram[blue] += 1;

    lumaSum += value;
    redSum += red;
    greenSum += green;
    blueSum += blue;
    if (value < 16) belowBlack += 1;
    if (value > 235) aboveWhite += 1;

    const saturation = chromaMagnitude(red, green, blue);
    const angle = (hueAngle(red, green, blue) * Math.PI) / 180;
    hueX += Math.cos(angle) * saturation;
    hueY += Math.sin(angle) * saturation;
    saturationSum += saturation;
    if (saturation > peakSaturation) peakSaturation = saturation;

    if (looksLikeSkin(red, green, blue)) {
      skinCount += 1;
      skinHueX += Math.cos(angle) * saturation;
      skinHueY += Math.sin(angle) * saturation;
      skinSaturation += saturation;
    }

    count += 1;
  }

  const round = (value: number): number => Math.round(value * 100) / 100;
  const meanAngle = (x: number, y: number): number => {
    const degrees = (Math.atan2(y, x) * 180) / Math.PI;
    return degrees < 0 ? degrees + 360 : degrees;
  };

  let skin: SkinReading | null = null;
  if (skinCount > count * 0.01) {
    const angle = meanAngle(skinHueX, skinHueY);
    let deviation = angle - SKIN_TONE_LINE_DEGREES;
    while (deviation > 180) deviation -= 360;
    while (deviation < -180) deviation += 360;

    skin = {
      pixelShare: round((skinCount / count) * 100),
      meanHueDegrees: round(angle),
      deviationDegrees: round(deviation),
      meanSaturation: round(skinSaturation / skinCount),
      verdict:
        Math.abs(deviation) <= 8
          ? "On the skin tone line."
          : deviation > 0
            ? "Skin sits red of the line, which usually reads sunburnt."
            : "Skin sits yellow or green of the line, which usually reads sickly.",
    };
  }

  return {
    waveform: statsFrom(luma, count, lumaSum),
    parade: {
      red: statsFrom(redHistogram, count, redSum),
      green: statsFrom(greenHistogram, count, greenSum),
      blue: statsFrom(blueHistogram, count, blueSum),
    },
    vectorscope: {
      meanHueDegrees: round(meanAngle(hueX, hueY)),
      meanSaturation: round(saturationSum / count),
      peakSaturation: round(peakSaturation),
    },
    illegal: {
      belowBlack: round((belowBlack / count) * 100),
      aboveWhite: round((aboveWhite / count) * 100),
    },
    skin,
  };
}

export interface MatchMove {
  field: string;
  amount: number;
  reason: string;
}

const DAMPING = 0.6;

export function planShotMatch(reference: ScopeReading, target: ScopeReading): MatchMove[] {
  const moves: MatchMove[] = [];
  const round = (value: number): number => Math.round(value * 100) / 100;

  const blackGap = reference.waveform.black - target.waveform.black;
  if (Math.abs(blackGap) > 3) {
    moves.push({
      field: "blacks",
      amount: round(Math.max(-60, Math.min(60, blackGap * 1.6 * DAMPING))),
      reason: `Reference sits at ${reference.waveform.black} in the shadows, target at ${target.waveform.black}.`,
    });
  }

  const whiteGap = reference.waveform.white - target.waveform.white;
  if (Math.abs(whiteGap) > 3) {
    moves.push({
      field: "whites",
      amount: round(Math.max(-60, Math.min(60, whiteGap * 1.6 * DAMPING))),
      reason: `Reference peaks at ${reference.waveform.white}, target at ${target.waveform.white}.`,
    });
  }

  const midGap = reference.waveform.mid - target.waveform.mid;
  if (Math.abs(midGap) > 4) {
    moves.push({
      field: "exposure",
      amount: round(Math.max(-2, Math.min(2, (midGap / 40) * DAMPING))),
      reason: `Midtones differ by ${round(midGap)} levels.`,
    });
  }

  const referenceWarmth = reference.parade.red.mean - reference.parade.blue.mean;
  const targetWarmth = target.parade.red.mean - target.parade.blue.mean;
  const warmthGap = referenceWarmth - targetWarmth;
  if (Math.abs(warmthGap) > 3) {
    moves.push({
      field: "temperature",
      amount: round(Math.max(-40, Math.min(40, warmthGap * 0.9 * DAMPING))),
      reason: `Red minus blue is ${round(referenceWarmth)} on the reference and ${round(targetWarmth)} on the target.`,
    });
  }

  const referenceGreen = reference.parade.green.mean - (reference.parade.red.mean + reference.parade.blue.mean) / 2;
  const targetGreen = target.parade.green.mean - (target.parade.red.mean + target.parade.blue.mean) / 2;
  const greenGap = referenceGreen - targetGreen;
  if (Math.abs(greenGap) > 2) {
    moves.push({
      field: "tint",
      amount: round(Math.max(-40, Math.min(40, greenGap * -1.2 * DAMPING))),
      reason: `Green balance differs by ${round(greenGap)} levels.`,
    });
  }

  const saturationRatio =
    target.vectorscope.meanSaturation > 0
      ? reference.vectorscope.meanSaturation / target.vectorscope.meanSaturation
      : 1;
  if (Math.abs(saturationRatio - 1) > 0.08) {
    moves.push({
      field: "saturation",
      amount: round(Math.max(40, Math.min(180, 100 * (1 + (saturationRatio - 1) * DAMPING)))),
      reason: `Reference carries ${reference.vectorscope.meanSaturation} mean chroma against ${target.vectorscope.meanSaturation}.`,
    });
  }

  return moves;
}

const MOVE_WEIGHT: Record<string, number> = {
  blacks: 1,
  whites: 1,
  exposure: 30,
  temperature: 1,
  tint: 1,
  saturation: 0.5,
};

export function matchError(moves: MatchMove[]): number {
  let total = 0;
  for (const move of moves) {
    const weight = MOVE_WEIGHT[move.field] ?? 1;
    const amount = move.field === "saturation" ? Math.abs(move.amount - 100) : Math.abs(move.amount);
    total += amount * weight;
  }
  return Math.round(total * 100) / 100;
}

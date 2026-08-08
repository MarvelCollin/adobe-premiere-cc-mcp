import type { DecodedImage } from "./png.js";

export interface FrameStats {
  sampledPixels: number;
  meanLuma: number;
  blackPoint: number;
  whitePoint: number;
  contrastRange: number;
  clippedBlacksPercent: number;
  clippedWhitesPercent: number;
  meanSaturation: number;
  channelMeans: { red: number; green: number; blue: number };
  colourCast: string;
}

export interface GradeSuggestion {
  field: string;
  direction: "raise" | "lower";
  amount: number;
  reason: string;
}

const SAMPLE_TARGET = 40_000;

export function measureFrame(image: DecodedImage): FrameStats {
  const { width, height, channels, pixels } = image;
  const total = width * height;
  const step = Math.max(1, Math.floor(total / SAMPLE_TARGET));

  const histogram = new Uint32Array(256);
  let sampled = 0;
  let sumLuma = 0;
  let sumSaturation = 0;
  let sumRed = 0;
  let sumGreen = 0;
  let sumBlue = 0;

  for (let index = 0; index < total; index += step) {
    const at = index * channels;
    const red = pixels[at];
    const green = pixels[at + 1];
    const blue = pixels[at + 2];

    const luma = 0.2126 * red + 0.7152 * green + 0.0722 * blue;
    const max = Math.max(red, green, blue);
    const min = Math.min(red, green, blue);
    const saturation = max === 0 ? 0 : (max - min) / max;

    histogram[Math.round(luma)]++;
    sumLuma += luma;
    sumSaturation += saturation;
    sumRed += red;
    sumGreen += green;
    sumBlue += blue;
    sampled++;
  }

  const percentile = (fraction: number): number => {
    const target = sampled * fraction;
    let seen = 0;
    for (let value = 0; value < 256; value++) {
      seen += histogram[value];
      if (seen >= target) return value;
    }
    return 255;
  };

  const round = (value: number): number => Math.round(value * 100) / 100;

  const meanRed = sumRed / sampled;
  const meanGreen = sumGreen / sampled;
  const meanBlue = sumBlue / sampled;
  const channelSpread = Math.max(meanRed, meanGreen, meanBlue) - Math.min(meanRed, meanGreen, meanBlue);

  let cast = "neutral";
  if (channelSpread > 8) {
    if (meanBlue > meanRed && meanBlue >= meanGreen) cast = "cool, blue heavy";
    else if (meanRed > meanBlue && meanRed >= meanGreen) cast = "warm, red heavy";
    else if (meanGreen > meanRed && meanGreen > meanBlue) cast = "green heavy";
  }

  const blackPoint = percentile(0.01);
  const whitePoint = percentile(0.99);

  return {
    sampledPixels: sampled,
    meanLuma: round(sumLuma / sampled),
    blackPoint,
    whitePoint,
    contrastRange: whitePoint - blackPoint,
    clippedBlacksPercent: round((histogram[0] / sampled) * 100),
    clippedWhitesPercent: round((histogram[255] / sampled) * 100),
    meanSaturation: round((sumSaturation / sampled) * 100),
    channelMeans: { red: round(meanRed), green: round(meanGreen), blue: round(meanBlue) },
    colourCast: cast,
  };
}

export function suggestGrade(stats: FrameStats): GradeSuggestion[] {
  const suggestions: GradeSuggestion[] = [];

  if (stats.contrastRange < 140) {
    const amount = stats.contrastRange < 100 ? 25 : 15;
    suggestions.push({
      field: "contrast",
      direction: "raise",
      amount,
      reason: `Only ${stats.contrastRange} levels between the black and white point, so the image is flat. Haze and log footage both look like this.`,
    });
  }

  if (stats.blackPoint > 24) {
    suggestions.push({
      field: "blacks",
      direction: "lower",
      amount: -Math.min(30, Math.round((stats.blackPoint - 12) * 1.2)),
      reason: `The darkest tones sit at ${stats.blackPoint} rather than near 0, so nothing reads as true black.`,
    });
  } else if (stats.clippedBlacksPercent > 2) {
    suggestions.push({
      field: "shadows",
      direction: "raise",
      amount: Math.min(30, Math.round(stats.clippedBlacksPercent * 4)),
      reason: `${stats.clippedBlacksPercent}% of the frame is crushed to pure black, losing shadow detail.`,
    });
  }

  if (stats.whitePoint < 215) {
    suggestions.push({
      field: "whites",
      direction: "raise",
      amount: Math.min(25, Math.round((215 - stats.whitePoint) / 3)),
      reason: `The brightest tones only reach ${stats.whitePoint}, so highlights look dull.`,
    });
  } else if (stats.clippedWhitesPercent > 2) {
    suggestions.push({
      field: "highlights",
      direction: "lower",
      amount: -Math.min(30, Math.round(stats.clippedWhitesPercent * 4)),
      reason: `${stats.clippedWhitesPercent}% of the frame is blown to pure white, which cannot be recovered.`,
    });
  }

  if (stats.meanLuma < 70) {
    suggestions.push({
      field: "exposure",
      direction: "raise",
      amount: Math.min(1, Math.round(((70 - stats.meanLuma) / 70) * 100) / 100),
      reason: `Average brightness is ${stats.meanLuma} of 255, which is underexposed for most footage.`,
    });
  } else if (stats.meanLuma > 175) {
    suggestions.push({
      field: "exposure",
      direction: "lower",
      amount: -Math.min(1, Math.round(((stats.meanLuma - 175) / 80) * 100) / 100),
      reason: `Average brightness is ${stats.meanLuma} of 255, which is bright enough to risk clipping.`,
    });
  }

  if (stats.meanSaturation < 18) {
    suggestions.push({
      field: "saturation",
      direction: "raise",
      amount: 115,
      reason: `Mean saturation is ${stats.meanSaturation}%, so colour reads as washed out.`,
    });
  } else if (stats.meanSaturation > 55) {
    suggestions.push({
      field: "saturation",
      direction: "lower",
      amount: 90,
      reason: `Mean saturation is ${stats.meanSaturation}%, high enough that skin tones usually suffer.`,
    });
  }

  if (stats.colourCast === "cool, blue heavy") {
    suggestions.push({
      field: "temperature",
      direction: "raise",
      amount: 8,
      reason: "Blue dominates the channel averages, so the frame reads cold.",
    });
  } else if (stats.colourCast === "warm, red heavy") {
    suggestions.push({
      field: "temperature",
      direction: "lower",
      amount: -6,
      reason: "Red dominates the channel averages, so the frame reads over warm.",
    });
  } else if (stats.colourCast === "green heavy") {
    suggestions.push({
      field: "tint",
      direction: "raise",
      amount: 8,
      reason: "Green dominates the channel averages, which usually means a tint problem rather than a look.",
    });
  }

  return suggestions;
}

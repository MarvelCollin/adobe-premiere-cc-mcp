import type { LevelWindow } from "./audio-faults.js";

export interface TimeRange {
  fromSeconds: number;
  toSeconds: number;
}

export interface TriggerOptions {
  minTriggerSeconds: number;
  minGapSeconds: number;
  openMarginDb: number;
  rangeMarginDb: number;
  hysteresisDb: number;
  minSeparationDb: number;
  silentBelowDb: number;
}

export const TRIGGER_DEFAULTS: TriggerOptions = {
  minTriggerSeconds: 0.2,
  minGapSeconds: 0.35,
  openMarginDb: 12,
  rangeMarginDb: 20,
  hysteresisDb: 6,
  minSeparationDb: 12,
  silentBelowDb: -70,
};

export interface TriggerDetection {
  ranges: TimeRange[];
  floorDb: number;
  loudDb: number;
  separationDb: number;
  openDb: number;
  closeDb: number;
  usable: boolean;
  reason: string | null;
}

export interface DuckShape {
  attackSeconds: number;
  releaseSeconds: number;
  holdSeconds: number;
  duckDb: number;
}

export interface DuckWindow {
  rampStartSeconds: number;
  downSeconds: number;
  upSeconds: number;
  rampEndSeconds: number;
}

export interface EnvelopePoint {
  atSeconds: number;
  factor: number;
}

export interface ClipSpan {
  startSeconds: number;
  endSeconds: number;
  inPointSeconds: number;
}

export interface PlannedKey {
  sequenceSeconds: number;
  sourceSeconds: number;
  factor: number;
}

export interface Probe {
  sequenceSeconds: number;
  sourceSeconds: number;
  factor: number;
  kind: "ducked" | "open";
}

const EPSILON = 1e-4;

function round(value: number): number {
  return Math.round(value * 10_000) / 10_000;
}

export function duckFactor(duckDb: number): number {
  return Math.pow(10, duckDb / 20);
}

function percentile(sorted: number[], share: number): number {
  if (sorted.length === 0) return -120;
  const at = Math.min(sorted.length - 1, Math.max(0, Math.floor(sorted.length * share)));
  return sorted[at];
}

export function findDuckTriggers(
  windows: LevelWindow[],
  windowSeconds: number,
  options: Partial<TriggerOptions> = {},
): TriggerDetection {
  const settings = { ...TRIGGER_DEFAULTS, ...options };
  const empty = {
    ranges: [] as TimeRange[],
    floorDb: -120,
    loudDb: -120,
    separationDb: 0,
    openDb: -120,
    closeDb: -120,
  };

  if (windows.length < 4) {
    return { ...empty, usable: false, reason: "The isolated render was too short to measure." };
  }

  const sorted = windows.map((window) => window.rmsDb).sort((a, b) => a - b);
  const floorDb = round(percentile(sorted, 0.1));
  const loudDb = round(percentile(sorted, 0.95));
  const separationDb = round(loudDb - floorDb);

  if (loudDb <= settings.silentBelowDb) {
    return {
      ...empty,
      floorDb,
      loudDb,
      separationDb,
      usable: false,
      reason: `The isolated track rendered silent: its loudest twentieth still sits at ${loudDb} dB. Nothing on that track reaches the mix, so check whether the source clips actually carry audio before ducking against them.`,
    };
  }

  if (separationDb < settings.minSeparationDb) {
    return {
      ...empty,
      floorDb,
      loudDb,
      separationDb,
      usable: false,
      reason: `The isolated track only spans ${separationDb} dB between its quiet tenth and its loud twentieth. That is too flat to tell talking from background, so any duck built from it would be guesswork.`,
    };
  }

  const openDb = round(Math.max(floorDb + settings.openMarginDb, loudDb - settings.rangeMarginDb));
  const closeDb = round(openDb - settings.hysteresisDb);

  const raw: TimeRange[] = [];
  let openAt: number | null = null;
  for (const window of windows) {
    if (openAt === null) {
      if (window.rmsDb >= openDb) openAt = window.atSeconds;
      continue;
    }
    if (window.rmsDb < closeDb) {
      raw.push({ fromSeconds: openAt, toSeconds: round(window.atSeconds + windowSeconds) });
      openAt = null;
    }
  }
  if (openAt !== null) {
    const last = windows[windows.length - 1];
    raw.push({ fromSeconds: openAt, toSeconds: round(last.atSeconds + windowSeconds) });
  }

  const merged: TimeRange[] = [];
  for (const range of raw) {
    const last = merged[merged.length - 1];
    if (last && range.fromSeconds - last.toSeconds <= settings.minGapSeconds) {
      last.toSeconds = Math.max(last.toSeconds, range.toSeconds);
      continue;
    }
    merged.push({ ...range });
  }

  const ranges = merged.filter((range) => range.toSeconds - range.fromSeconds >= settings.minTriggerSeconds);

  return {
    ranges,
    floorDb,
    loudDb,
    separationDb,
    openDb,
    closeDb,
    usable: true,
    reason: ranges.length === 0 ? "Nothing on the isolated track ever rose above its own noise floor." : null,
  };
}

export function duckWindows(speech: TimeRange[], shape: DuckShape): DuckWindow[] {
  const sorted = speech
    .filter((range) => range.toSeconds > range.fromSeconds)
    .slice()
    .sort((a, b) => a.fromSeconds - b.fromSeconds);

  const windows: DuckWindow[] = [];
  for (const range of sorted) {
    const down = Math.max(0, range.fromSeconds);
    const up = Math.max(down, range.toSeconds) + shape.holdSeconds;
    const rampStart = Math.max(0, down - shape.attackSeconds);
    const rampEnd = up + shape.releaseSeconds;

    const last = windows[windows.length - 1];
    if (last && rampStart <= last.rampEndSeconds + EPSILON) {
      last.upSeconds = Math.max(last.upSeconds, up);
      last.rampEndSeconds = Math.max(last.rampEndSeconds, rampEnd);
      continue;
    }
    windows.push({
      rampStartSeconds: round(rampStart),
      downSeconds: round(down),
      upSeconds: round(up),
      rampEndSeconds: round(rampEnd),
    });
  }

  for (const window of windows) {
    window.upSeconds = round(window.upSeconds);
    window.rampEndSeconds = round(window.rampEndSeconds);
  }
  return windows;
}

export function duckEnvelope(windows: DuckWindow[], duckDb: number): EnvelopePoint[] {
  const ducked = duckFactor(duckDb);
  const points: EnvelopePoint[] = [];
  for (const window of windows) {
    points.push({ atSeconds: window.rampStartSeconds, factor: 1 });
    points.push({ atSeconds: window.downSeconds, factor: ducked });
    points.push({ atSeconds: window.upSeconds, factor: ducked });
    points.push({ atSeconds: window.rampEndSeconds, factor: 1 });
  }

  const collapsed: EnvelopePoint[] = [];
  for (const point of points) {
    const last = collapsed[collapsed.length - 1];
    if (last && Math.abs(last.atSeconds - point.atSeconds) < EPSILON) {
      last.factor = Math.min(last.factor, point.factor);
      continue;
    }
    collapsed.push({ ...point });
  }
  return collapsed;
}

export function factorAt(points: EnvelopePoint[], atSeconds: number): number {
  if (points.length === 0) return 1;
  if (atSeconds <= points[0].atSeconds) return points[0].factor;
  if (atSeconds >= points[points.length - 1].atSeconds) return points[points.length - 1].factor;

  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const next = points[index];
    if (atSeconds > next.atSeconds) continue;
    const span = next.atSeconds - previous.atSeconds;
    if (span <= 0) return next.factor;
    const share = (atSeconds - previous.atSeconds) / span;
    return previous.factor + (next.factor - previous.factor) * share;
  }
  return 1;
}

export function planClipKeys(points: EnvelopePoint[], clip: ClipSpan, extraSequenceTimes: number[] = []): PlannedKey[] {
  const wanted: number[] = [clip.startSeconds, clip.endSeconds];
  for (const point of points) {
    if (point.atSeconds > clip.startSeconds + EPSILON && point.atSeconds < clip.endSeconds - EPSILON) {
      wanted.push(point.atSeconds);
    }
  }
  for (const time of extraSequenceTimes) {
    if (time >= clip.startSeconds - EPSILON && time <= clip.endSeconds + EPSILON) {
      wanted.push(Math.min(clip.endSeconds, Math.max(clip.startSeconds, time)));
    }
  }

  const unique: number[] = [];
  for (const time of wanted.sort((a, b) => a - b)) {
    const last = unique[unique.length - 1];
    if (last !== undefined && Math.abs(last - time) < EPSILON) continue;
    unique.push(time);
  }

  return unique.map((time) => ({
    sequenceSeconds: round(time),
    sourceSeconds: round(clip.inPointSeconds + (time - clip.startSeconds)),
    factor: round(factorAt(points, time)),
  }));
}

export function clipIsDucked(keys: PlannedKey[]): boolean {
  return keys.some((key) => key.factor < 1 - EPSILON);
}

export function probesForClip(windows: DuckWindow[], clip: ClipSpan, duckDb: number): Probe[] {
  const ducked = round(duckFactor(duckDb));
  const probes: Probe[] = [];
  const inside = (time: number): boolean =>
    time > clip.startSeconds + EPSILON && time < clip.endSeconds - EPSILON;

  const push = (time: number, factor: number, kind: Probe["kind"]): void => {
    if (!inside(time)) return;
    probes.push({
      sequenceSeconds: round(time),
      sourceSeconds: round(clip.inPointSeconds + (time - clip.startSeconds)),
      factor,
      kind,
    });
  };

  for (let index = 0; index < windows.length; index += 1) {
    const window = windows[index];
    if (window.upSeconds - window.downSeconds > EPSILON) {
      push((window.downSeconds + window.upSeconds) / 2, ducked, "ducked");
    }
    const nextStart = index + 1 < windows.length ? windows[index + 1].rampStartSeconds : clip.endSeconds;
    const gapFrom = window.rampEndSeconds;
    if (nextStart - gapFrom > EPSILON) push((gapFrom + nextStart) / 2, 1, "open");
  }

  if (windows.length > 0 && windows[0].rampStartSeconds - clip.startSeconds > EPSILON) {
    push((clip.startSeconds + windows[0].rampStartSeconds) / 2, 1, "open");
  }

  return probes.sort((a, b) => a.sequenceSeconds - b.sequenceSeconds);
}

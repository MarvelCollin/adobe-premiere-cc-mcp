export interface FrameProbe {
  atSeconds: number;
  meanLuma: number;
  whitePoint: number;
  peakSaturation: number;
  signature: Float32Array;
}

export interface QcFinding {
  kind: string;
  atSeconds: number;
  detail: string;
  severity: "fail" | "warn";
}

export interface QcRange {
  kind: string;
  fromSeconds: number;
  toSeconds: number;
  frames: number;
  detail: string;
  severity: "fail" | "warn";
}

export interface QcReport {
  sampled: number;
  findings: QcRange[];
  flashRatePerSecond: number;
  clean: boolean;
  summary: string;
}

function collapse(findings: QcFinding[], gapTolerance: number): QcRange[] {
  const byKind = new Map<string, QcFinding[]>();
  for (const finding of findings) {
    const list = byKind.get(finding.kind) ?? [];
    list.push(finding);
    byKind.set(finding.kind, list);
  }

  const ranges: QcRange[] = [];
  for (const [kind, list] of byKind) {
    list.sort((a, b) => a.atSeconds - b.atSeconds);
    let run: QcFinding[] = [];

    const flush = (): void => {
      if (run.length === 0) return;
      ranges.push({
        kind,
        fromSeconds: run[0].atSeconds,
        toSeconds: run[run.length - 1].atSeconds,
        frames: run.length,
        detail: run[0].detail,
        severity: run[0].severity,
      });
      run = [];
    };

    for (const finding of list) {
      if (run.length === 0) {
        run.push(finding);
        continue;
      }
      const previous = run[run.length - 1];
      if (finding.atSeconds - previous.atSeconds <= gapTolerance) run.push(finding);
      else {
        flush();
        run.push(finding);
      }
    }
    flush();
  }

  ranges.sort((a, b) => a.fromSeconds - b.fromSeconds);
  return ranges;
}


const BLACK_LUMA = 4;
const FREEZE_DIFFERENCE = 0.4;
const FLASH_LUMA_SWING = 20;
const FLASH_HZ_LIMIT = 3;
const FLASH_AREA_SHARE = 0.25;

function changedShare(before: Float32Array, after: Float32Array, threshold: number): number {
  let changed = 0;
  for (let cell = 0; cell < before.length; cell += 1) {
    if (Math.abs(after[cell] - before[cell]) > threshold) changed += 1;
  }
  return changed / before.length;
}

export function inspectFrames(probes: FrameProbe[]): QcReport {
  const findings: QcFinding[] = [];
  if (probes.length === 0) {
    return { sampled: 0, findings: [], flashRatePerSecond: 0, clean: true, summary: "Nothing sampled." };
  }

  let flashes = 0;

  for (let index = 0; index < probes.length; index += 1) {
    const probe = probes[index];

    if (probe.meanLuma < BLACK_LUMA && probe.whitePoint < BLACK_LUMA) {
      findings.push({
        kind: "black_frame",
        atSeconds: probe.atSeconds,
        detail: "The frame is entirely black, which is usually a gap or a missing clip.",
        severity: "fail",
      });
    }

    if (index === 0) continue;
    const previous = probes[index - 1];

    const difference = changedShare(previous.signature, probe.signature, 1);
    if (difference < FREEZE_DIFFERENCE / 100) {
      findings.push({
        kind: "freeze_frame",
        atSeconds: probe.atSeconds,
        detail: "The picture is identical to the previous sample, which reads as a freeze.",
        severity: "warn",
      });
    }

    const swing = Math.abs(probe.meanLuma - previous.meanLuma);
    const area = changedShare(previous.signature, probe.signature, FLASH_LUMA_SWING);
    const gap = probe.atSeconds - previous.atSeconds;
    if (swing > FLASH_LUMA_SWING && area > FLASH_AREA_SHARE) {
      flashes += 1;
      if (gap > 0 && 1 / gap >= FLASH_HZ_LIMIT) {
        findings.push({
          kind: "flash",
          atSeconds: probe.atSeconds,
          detail: `Luminance jumped ${Math.round(swing)} levels across ${Math.round(area * 100)}% of the frame, fast enough to be a photosensitivity risk.`,
          severity: "fail",
        });
      }
    }
  }

  const span = probes[probes.length - 1].atSeconds - probes[0].atSeconds;
  const flashRate = span > 0 ? Math.round((flashes / span) * 100) / 100 : 0;

  if (flashRate >= FLASH_HZ_LIMIT) {
    findings.push({
      kind: "flash_rate",
      atSeconds: probes[0].atSeconds,
      detail: `Large luminance changes occur ${flashRate} times a second, above the 3 Hz photosensitivity guideline.`,
      severity: "fail",
    });
  }

  const sampleGap = probes.length > 1 ? probes[1].atSeconds - probes[0].atSeconds : 1;
  const ranges = collapse(findings, sampleGap * 1.5);
  const failures = ranges.filter((range) => range.severity === "fail").length;
  const warnings = ranges.length - failures;

  return {
    sampled: probes.length,
    findings: ranges,
    flashRatePerSecond: flashRate,
    clean: ranges.length === 0,
    summary:
      ranges.length === 0
        ? "Nothing found. No black frames, freezes or flashing."
        : `${failures} failure(s) and ${warnings} warning(s) across ${probes.length} sampled frames.`,
  };
}

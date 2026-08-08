import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { measureLoudness } from "../analysis/loudness.js";
import { decodeWav } from "../analysis/wav.js";
import { PRESET_SUBFOLDERS } from "../premiere/constants.js";
import { toHostPath } from "../premiere/paths.js";
import { defineTools } from "./types.js";

const TARGETS: Record<string, number> = {
  broadcast: -23,
  streaming: -16,
  social: -14,
  podcast: -16,
};

type ExportRange = "entire" | "in_to_out" | "work_area";

function scopeExpression(range: ExportRange): string {
  if (range === "in_to_out") return "app.encoder.ENCODE_IN_TO_OUT";
  if (range === "work_area") return "app.encoder.ENCODE_WORKAREA";
  return "app.encoder.ENCODE_ENTIRE";
}

async function renderAudio(range: ExportRange, timeoutMs: number): Promise<{ path: string; preset: string }> {
  const wavPath = join(tmpdir(), `premiere-mcp-loudness-${Date.now()}.wav`);

  const rendered = await evaluate<{ preset: string }>(
    `
    var seq = __seq();
    if (!seq) return __error("No active sequence");

    var roots = [];
    var startup = Folder.startup.fsName;
    ${PRESET_SUBFOLDERS.map(
      (sub) => `(function () { var f = new Folder(startup + "/${sub}"); if (f.exists) roots.push(f); })();`,
    ).join("\n    ")}

    var preset = null;
    function walk(folder, depth) {
      if (!folder || !folder.exists || depth > 4 || preset) return;
      var entries = folder.getFiles();
      for (var i = 0; i < entries.length; i++) {
        if (preset) return;
        var entry = entries[i];
        if (entry instanceof Folder) { walk(entry, depth + 1); continue; }
        var fileName = decodeURI(entry.displayName);
        if (fileName.slice(-4).toLowerCase() !== ".epr") continue;
        if (fileName.toLowerCase().indexOf("waveform audio") === 0) { preset = entry; return; }
      }
    }
    for (var r = 0; r < roots.length; r++) walk(roots[r], 0);
    if (!preset) return __error("No Waveform Audio .epr preset found; cannot render audio to measure it");

    var scope = ${scopeExpression(range)};
    if (typeof scope !== "number") {
      return __error("This Premiere build does not expose the ${range} export scope");
    }

    var reported = seq.exportAsMediaDirect("${esc(toHostPath(wavPath))}", preset.fsName, scope);
    var written = new File("${esc(toHostPath(wavPath))}");
    if (!written.exists) {
      return __error("Audio render reported '" + reported + "' but wrote no file");
    }
    return __result({ preset: decodeURI(preset.displayName) });
  `,
    { timeoutMs },
  );

  return { path: wavPath, preset: rendered.preset };
}

async function measureSequence(range: ExportRange, timeoutMs: number) {
  const { path } = await renderAudio(range, timeoutMs);
  try {
    return measureLoudness(decodeWav(readFileSync(path)));
  } finally {
    try {
      rmSync(path, { force: true });
    } catch {
      /* the temp render is disposable */
    }
  }
}

const PEAK_CEILING_DBFS = -1;

export const loudnessTools = defineTools([
  {
    name: "normalise_loudness",
    description:
      "Measure the sequence loudness and then actually move the audio to hit the target, in one pass. Moves every audio track by default, because loudness is a property of the whole mix; naming one track only moves that track, which cannot reach a whole-sequence target when other tracks also make noise. Refuses to push the mix into clipping: if the gain needed would take the estimated true peak above -1 dBFS, it applies only what fits and says how much was left on the table. Re-measures afterwards and reports whether the target was actually reached, rather than assuming the move worked.",
    schema: {
      target: z
        .enum(["broadcast", "streaming", "social", "podcast"])
        .default("social")
        .describe("Delivery target: social -14, streaming and podcast -16, broadcast -23 LUFS"),
      track_index: z
        .number()
        .int()
        .min(0)
        .optional()
        .describe("Restrict to one audio track, A1 is 0. Omit to move the whole mix, which is usually what you want"),
      range: z.enum(["entire", "in_to_out", "work_area"]).default("entire"),
      allow_clipping: z
        .boolean()
        .default(false)
        .describe("Apply the full gain even when it takes peaks above -1 dBFS"),
      timeout_ms: z.number().int().positive().default(900_000),
    },
    handler: async ({
      target = "social",
      track_index,
      range = "entire",
      allow_clipping = false,
      timeout_ms = 900_000,
    }: {
      target?: keyof typeof TARGETS;
      track_index?: number;
      range?: "entire" | "in_to_out" | "work_area";
      allow_clipping?: boolean;
      timeout_ms?: number;
    }) => {
      const before = await measureSequence(range, timeout_ms);
      if (before.integratedLufs === null) {
        return { applied: false, reason: "The audio is silent or below the -70 LUFS gate, so there is nothing to normalise." };
      }

      const wanted = TARGETS[target];
      const ideal = wanted - before.integratedLufs;
      const headroom = PEAK_CEILING_DBFS - before.truePeakEstimateDbfs;
      const limited = !allow_clipping && ideal > headroom;
      const gain = limited ? Math.min(ideal, headroom) : ideal;

      if (Math.abs(gain) < 0.05) {
        return {
          applied: false,
          reason: `Already at ${before.integratedLufs} LUFS, within 0.05 dB of the ${wanted} LUFS target.`,
          measured: before,
        };
      }

      const moved = await evaluate<{
        changed: { track: number; name: string; fromDb: number; toDb: number }[];
        tracksTouched: number;
      }>(`
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var onlyTrack = ${track_index === undefined ? "-1" : track_index};
        if (onlyTrack >= 0 && onlyTrack >= seq.audioTracks.numTracks) {
          return __error("No audio track at index " + onlyTrack);
        }

        var changed = [];
        var tracksTouched = 0;
        for (var t = 0; t < seq.audioTracks.numTracks; t++) {
          if (onlyTrack >= 0 && t !== onlyTrack) continue;
          var track = seq.audioTracks[t];
          if (track.clips.numItems === 0) continue;
          tracksTouched++;

          for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            var volume = __component(clip, "Volume");
            if (!volume) continue;
            var level = __property(volume, "Level");
            if (!level) continue;

            __clearKeys(level);
            var current = level.getValue();
            var currentDb = current > 0 ? 20 * (Math.log(current) / Math.LN10) : -96;
            var nextDb = currentDb + ${gain};
            if (nextDb > 15) nextDb = 15;
            level.setValue(Math.pow(10, nextDb / 20), true);

            changed.push({
              track: t,
              name: String(clip.name),
              fromDb: Math.round(currentDb * 100) / 100,
              toDb: Math.round(nextDb * 100) / 100
            });
          }
        }

        if (changed.length === 0) return __error("No audio clip exposed a Volume level to move");
        return __result({ changed: changed, tracksTouched: tracksTouched });
      `);

      const after = await measureSequence(range, timeout_ms);
      const missedBy =
        after.integratedLufs === null ? null : Math.round((after.integratedLufs - wanted) * 100) / 100;
      const reached = missedBy !== null && Math.abs(missedBy) <= 0.5;

      return {
        applied: true,
        target,
        targetLufs: wanted,
        appliedGainDb: Math.round(gain * 100) / 100,
        reachedTarget: reached,
        missedByDb: missedBy,
        clippingLimited: limited,
        limitNote: limited
          ? `Wanted ${Math.round(ideal * 100) / 100} dB but only ${Math.round(headroom * 100) / 100} dB fits under the ${PEAK_CEILING_DBFS} dBFS ceiling. Pull the peaks down or pass allow_clipping to override.`
          : null,
        tracksMoved: moved.tracksTouched,
        clipsMoved: moved.changed.length,
        clips: moved.changed,
        before,
        after,
        verdict:
          after.integratedLufs === null
            ? "Re-measured as silent, which should not happen; check the track."
            : reached
              ? `Now ${after.integratedLufs} LUFS, on target for ${target}.`
              : `Now ${after.integratedLufs} LUFS, still ${Math.abs(missedBy ?? 0)} dB ${(missedBy ?? 0) > 0 ? "above" : "below"} the ${wanted} LUFS target.${
                  limited
                    ? " The peak ceiling blocked the rest."
                    : track_index !== undefined
                      ? " Only one track was moved, so audio on other tracks is holding the level; omit track_index to move the whole mix."
                      : " Applying the gain did not move the measurement as far as expected, which usually means something downstream is limiting."
                }`,
      };
    },
  },

  {
    name: "analyse_loudness",
    description:
      "Measure how loud the sequence actually is, in LUFS to ITU-R BS.1770, by rendering its audio to a temporary WAV and analysing it here. Premiere exposes no loudness measurement to scripting, so this is the only honest way to answer 'is this too quiet for Instagram'. Reports integrated loudness, short term maximum and peak, then says how many dB to move the mix to hit a target. Slow, since it renders the audio first.",
    schema: {
      target: z
        .enum(["broadcast", "streaming", "social", "podcast"])
        .default("social")
        .describe("Delivery target: social -14, streaming and podcast -16, broadcast -23 LUFS"),
      range: z
        .enum(["entire", "in_to_out", "work_area"])
        .default("entire")
        .describe("Which part of the sequence to measure"),
      timeout_ms: z.number().int().positive().default(600_000).describe("Default 10 minutes"),
    },
    handler: async ({
      target = "social",
      range = "entire",
      timeout_ms = 600_000,
    }: {
      target?: keyof typeof TARGETS;
      range?: "entire" | "in_to_out" | "work_area";
      timeout_ms?: number;
    }) => {
      const stats = await measureSequence(range, timeout_ms);
      const wanted = TARGETS[target];

      if (stats.integratedLufs === null) {
        return {
          target,
          targetLufs: wanted,
          measured: stats,
          verdict: "The rendered audio is silent or below the -70 LUFS gate, so there is nothing to measure.",
        };
      }

      const gain = Math.round((wanted - stats.integratedLufs) * 100) / 100;
      const headroom = Math.round((PEAK_CEILING_DBFS - stats.truePeakEstimateDbfs) * 100) / 100;

      return {
        target,
        targetLufs: wanted,
        measured: stats,
        gainToTargetDb: gain,
        verdict:
          Math.abs(gain) < 0.5
            ? `Already within half a dB of ${wanted} LUFS.`
            : `Move the mix ${gain > 0 ? "up" : "down"} ${Math.abs(gain)} dB to reach ${wanted} LUFS.`,
        peakWarning:
          stats.truePeakEstimateDbfs > PEAK_CEILING_DBFS
            ? `Estimated true peak is ${stats.truePeakEstimateDbfs} dBFS, which is above the ${PEAK_CEILING_DBFS} dBFS ceiling most platforms want; raising the level by ${gain} dB would clip. Pull peaks down first, or accept ${headroom} dB less than the target. normalise_loudness handles this for you.`
            : null,
      };
    },
  },
]);

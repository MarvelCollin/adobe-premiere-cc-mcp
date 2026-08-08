import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { measureFrame, suggestGrade } from "../analysis/frame-stats.js";
import { decodePng } from "../analysis/png.js";
import { toHostPath } from "../premiere/paths.js";
import { defineTools } from "./types.js";

async function exportStill(atSeconds: number, label: string): Promise<string> {
  const target = join(tmpdir(), `premiere-mcp-analysis-${label}-${Date.now()}.png`);
  await evaluate(
    `
    var seq = __seq();
    if (!seq) return __error("No active sequence");
    seq.setPlayerPosition(String(__secondsToTicks(${atSeconds})));
    var qeSeq = __qe();
    var base = "${esc(toHostPath(target))}".replace(/\\.png$/i, "");
    qeSeq.exportFramePNG(String(qeSeq.CTI.timecode), base);
    var written = new File(base + ".png");
    if (!written.exists) return __error("Premiere wrote no still at ${atSeconds}s");
    return __result({ path: written.fsName });
  `,
    { timeoutMs: 90_000 },
  );
  return target;
}

function analyseFile(path: string) {
  const image = decodePng(readFileSync(path));
  const stats = measureFrame(image);
  return { stats, suggestions: suggestGrade(stats), size: { width: image.width, height: image.height } };
}

function discard(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    return;
  }
}

export const analysisTools = defineTools([
  {
    name: "analyse_frame",
    description:
      "Measure the image at a point in the sequence and suggest Basic Correction moves. Exports a still, decodes it and reports black point, white point, contrast range, clipping, mean brightness, saturation and colour cast, then turns those numbers into concrete suggestions. Use this instead of guessing a grade, and pass the suggestions to set_lumetri or grade_clips.",
    schema: {
      time_seconds: z.number().min(0).describe("Where in the sequence to measure"),
    },
    handler: async ({ time_seconds }: { time_seconds: number }) => {
      const path = await exportStill(time_seconds, "frame");
      try {
        const { stats, suggestions, size } = analyseFile(path);
        return { atSeconds: time_seconds, frameSize: size, stats, suggestions };
      } finally {
        discard(path);
      }
    },
  },

  {
    name: "analyse_clips",
    description:
      "Measure one frame per clip on a video track and report the numbers side by side, so shots can be grouped by how they actually look rather than by eye. Clips whose black point, contrast and colour cast are close belong in the same grading group; ones that differ sharply need their own correction. Slow, since every clip costs a render.",
    schema: {
      track_index: z.number().int().min(0).default(0).describe("Which video track, V1 is 0"),
      limit: z.number().int().positive().max(30).default(15).describe("Stop after this many clips"),
    },
    handler: async ({ track_index = 0, limit = 15 }: { track_index?: number; limit?: number }) => {
      const timeline = await evaluate<{
        clips: { nodeId: string; name: string; start: number; end: number }[];
      }>(`
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        if (${track_index} >= seq.videoTracks.numTracks) {
          return __error("No video track at index ${track_index}");
        }
        var track = seq.videoTracks[${track_index}];
        var clips = [];
        for (var c = 0; c < track.clips.numItems && clips.length < ${limit}; c++) {
          var clip = track.clips[c];
          clips.push({
            nodeId: String(clip.nodeId),
            name: String(clip.name),
            start: clip.start.seconds,
            end: clip.end.seconds
          });
        }
        return __result({ clips: clips });
      `);

      const measured = [];
      const failed = [];

      for (const clip of timeline.clips) {
        const at = clip.start + (clip.end - clip.start) / 2;
        let path: string | null = null;
        try {
          path = await exportStill(at, clip.nodeId);
          const { stats, suggestions } = analyseFile(path);
          measured.push({
            nodeId: clip.nodeId,
            name: clip.name,
            atSeconds: Math.round(at * 100) / 100,
            blackPoint: stats.blackPoint,
            whitePoint: stats.whitePoint,
            contrastRange: stats.contrastRange,
            meanLuma: stats.meanLuma,
            meanSaturation: stats.meanSaturation,
            colourCast: stats.colourCast,
            suggestions,
          });
        } catch (error) {
          failed.push({
            nodeId: clip.nodeId,
            name: clip.name,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          if (path) discard(path);
        }
      }

      const flat = measured.filter((clip) => clip.contrastRange < 140).map((clip) => clip.name);
      const casts: Record<string, string[]> = {};
      for (const clip of measured) {
        casts[clip.colourCast] = casts[clip.colourCast] ?? [];
        casts[clip.colourCast].push(clip.name);
      }

      return {
        measured: measured.length,
        failed,
        clips: measured,
        grouping: {
          flatClips: flat,
          byColourCast: casts,
          hint: "Group clips that share a colour cast and a similar contrast range, then grade each group with grade_clips.",
        },
      };
    },
  },
]);

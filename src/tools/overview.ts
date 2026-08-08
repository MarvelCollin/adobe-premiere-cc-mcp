import { readFileSync } from "node:fs";
import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { measureFrame } from "../analysis/frame-stats.js";
import { decodePng } from "../analysis/png.js";
import { toHostPath } from "../premiere/paths.js";
import { exportStill } from "../premiere/still.js";
import { defineTools } from "./types.js";

export const overviewTools = defineTools([
  {
    name: "review_sequence",
    description:
      "One pass over a whole sequence for judging it rather than editing it: writes evenly spaced stills across the running time, measures each one, and reports the sequence settings alongside them. Read the returned PNG paths to actually look at the edit, since the numbers alone will not tell you whether a shot is well framed. Pair with analyse_loudness for the audio side and check_edit for technical faults. Every still is a real render, so keep the count low.",
    schema: {
      output_dir: z.string().describe("Existing folder to write the stills into"),
      frames: z
        .number()
        .int()
        .positive()
        .max(12)
        .default(6)
        .describe("How many stills to spread across the sequence"),
      start_seconds: z.number().min(0).optional().describe("Defaults to the start of the sequence"),
      end_seconds: z.number().min(0).optional().describe("Defaults to the end of the sequence"),
    },
    handler: async ({
      output_dir,
      frames = 6,
      start_seconds,
      end_seconds,
    }: {
      output_dir: string;
      frames?: number;
      start_seconds?: number;
      end_seconds?: number;
    }) => {
      const info = await evaluate<{
        name: string;
        width: number;
        height: number;
        fps: number;
        durationSeconds: number;
        videoTracks: number;
        audioTracks: number;
        clipCount: number;
      }>(`
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var folder = new Folder("${esc(toHostPath(output_dir))}");
        if (!folder.exists) return __error("Folder does not exist: ${esc(toHostPath(output_dir))}");

        var clipCount = 0;
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
          clipCount += seq.videoTracks[t].clips.numItems;
        }

        return __result({
          name: String(seq.name),
          width: seq.frameSizeHorizontal,
          height: seq.frameSizeVertical,
          fps: Math.round((TICKS_PER_SECOND / Number(seq.timebase)) * 100) / 100,
          durationSeconds: __ticksToSeconds(seq.end),
          videoTracks: seq.videoTracks.numTracks,
          audioTracks: seq.audioTracks.numTracks,
          clipCount: clipCount
        });
      `);

      const from = start_seconds ?? 0;
      const to = end_seconds ?? info.durationSeconds;
      if (to <= from) {
        throw new Error(`Nothing to review: the range ${from}s to ${to}s is empty.`);
      }

      const span = to - from;
      const shots = [];
      const failed = [];

      for (let index = 0; index < frames; index += 1) {
        const at = frames === 1 ? from + span / 2 : from + (span * index) / (frames - 1);
        const safe = Math.min(at, to - 0.04);
        const path = `${toHostPath(output_dir)}\\review_${String(index).padStart(2, "0")}.png`;

        try {
          await exportStill(safe, `review${index}`, path);
          const stats = measureFrame(decodePng(readFileSync(path)));
          shots.push({
            index,
            atSeconds: Math.round(safe * 100) / 100,
            path,
            meanLuma: stats.meanLuma,
            blackPoint: stats.blackPoint,
            whitePoint: stats.whitePoint,
            contrastRange: stats.contrastRange,
            meanSaturation: stats.meanSaturation,
            colourCast: stats.colourCast,
          });
        } catch (error) {
          failed.push({
            index,
            atSeconds: Math.round(safe * 100) / 100,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }

      const measured = shots.filter((shot) => shot.contrastRange > 0);
      const black = shots.filter((shot) => shot.whitePoint === 0);
      const casts = [...new Set(measured.map((shot) => shot.colourCast))];
      const lumas = measured.map((shot) => shot.meanLuma);
      const spread =
        lumas.length > 1 ? Math.round((Math.max(...lumas) - Math.min(...lumas)) * 100) / 100 : 0;

      return {
        sequence: info,
        reviewed: { from: Math.round(from * 100) / 100, to: Math.round(to * 100) / 100, frames: shots.length },
        shots,
        failed,
        consistency: {
          colourCasts: casts,
          brightnessSpread: spread,
          blackFrames: black.map((shot) => shot.atSeconds),
          note:
            black.length > 0
              ? "Some sampled frames are fully black, which usually means a gap or a tail past the last clip."
              : casts.length > 2
                ? "Sampled frames disagree on colour cast, so the edit is probably not graded as one piece."
                : spread > 60
                  ? "Brightness varies a lot across the edit, which reads as inconsistent exposure."
                  : "Sampled frames look consistent with each other.",
        },
        hint: "Read the PNG paths above to judge framing and composition; the numbers only cover exposure and colour.",
      };
    },
  },

  {
    name: "contact_sheet",
    description:
      "Export one still per clip on a video track, taken from the middle of each clip, and return the file paths. Read the images afterwards to judge a grade across the whole edit at once instead of one frame at a time. Slow, since every frame is a real render.",
    schema: {
      output_dir: z.string().describe("Existing folder to write the stills into"),
      track_index: z.number().int().min(0).default(0).describe("Which video track, V1 is 0"),
      limit: z.number().int().positive().max(40).default(20).describe("Stop after this many clips"),
    },
    handler: async ({
      output_dir,
      track_index = 0,
      limit = 20,
    }: {
      output_dir: string;
      track_index?: number;
      limit?: number;
    }) =>
      evaluate(
        `
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var folder = new Folder("${esc(toHostPath(output_dir))}");
        if (!folder.exists) return __error("Folder does not exist: " + folder.fsName);
        if (${track_index} >= seq.videoTracks.numTracks) {
          return __error("No video track at index ${track_index}");
        }

        var track = seq.videoTracks[${track_index}];
        var qeSeq = __qe();
        var frames = [];
        var failures = [];

        for (var c = 0; c < track.clips.numItems && frames.length < ${limit}; c++) {
          var clip = track.clips[c];
          var at = clip.start.seconds + (clip.end.seconds - clip.start.seconds) / 2;
          var safeName = String(clip.name).replace(/[^A-Za-z0-9_.-]/g, "_");
          var base = folder.fsName + "\\\\" + __pad(c, 2) + "_" + safeName;

          seq.setPlayerPosition(String(__secondsToTicks(at)));
          try {
            qeSeq.exportFramePNG(String(qeSeq.CTI.timecode), base);
          } catch (exportError) {
            failures.push({ clip: String(clip.name), error: exportError.toString() });
            continue;
          }

          var written = new File(base + ".png");
          if (written.exists) {
            frames.push({
              clip: String(clip.name),
              atSeconds: at,
              path: written.fsName,
              bytes: written.length
            });
          } else {
            failures.push({ clip: String(clip.name), error: "no file written" });
          }
        }

        return __result({ count: frames.length, frames: frames, failures: failures });
      `,
        { timeoutMs: 600_000 },
      ),
  },
]);

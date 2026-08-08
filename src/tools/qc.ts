import { readFileSync } from "node:fs";
import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { decodePng } from "../analysis/png.js";
import { motionSignature } from "../analysis/motion.js";
import { measureFrame } from "../analysis/frame-stats.js";
import { inspectFrames, type FrameProbe } from "../analysis/qc.js";
import { discardStill, exportStill } from "../premiere/still.js";
import { defineTools } from "./types.js";

export const qcTools = defineTools([
  {
    name: "check_delivery",
    description:
      "Run the quality control pass a broadcaster would run before accepting a file. Samples frames evenly across the sequence and reports black frames, frozen picture, and flashing that breaches the photosensitive epilepsy guideline of a large luminance swing over more than a quarter of the frame at more than three times a second. This is the check that is objective rather than a matter of taste, and the one most often skipped. Sample densely enough to catch fast flashing: the guideline is about events per second, so a coarse sample can miss it.",
    schema: {
      samples: z
        .number()
        .int()
        .min(4)
        .max(120)
        .default(40)
        .describe("How many frames to inspect across the sequence"),
      start_seconds: z.number().min(0).optional(),
      end_seconds: z.number().min(0).optional(),
    },
    handler: async ({
      samples = 40,
      start_seconds,
      end_seconds,
    }: {
      samples?: number;
      start_seconds?: number;
      end_seconds?: number;
    }) => {
      const sequence = await evaluate<{ name: string; durationSeconds: number }>(`
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        return __result({ name: String(seq.name), durationSeconds: __ticksToSeconds(seq.end) });
      `);

      const from = Math.max(0, start_seconds ?? 0);
      const to = Math.min(sequence.durationSeconds, end_seconds ?? sequence.durationSeconds);
      if (to <= from) {
        throw new Error(`Nothing to inspect between ${from}s and ${to}s.`);
      }

      const step = (to - from) / samples;
      const probes: FrameProbe[] = [];
      const failed: { atSeconds: number; error: string }[] = [];

      for (let index = 0; index < samples; index += 1) {
        const at = Math.round((from + step * index) * 1000) / 1000;
        let path: string | null = null;
        try {
          path = await exportStill(at, `qc${index}`);
          const image = decodePng(readFileSync(path));
          const stats = measureFrame(image);
          probes.push({
            atSeconds: at,
            meanLuma: stats.meanLuma,
            whitePoint: stats.whitePoint,
            peakSaturation: stats.meanSaturation,
            signature: motionSignature(image),
          });
        } catch (error) {
          failed.push({ atSeconds: at, error: error instanceof Error ? error.message : String(error) });
        } finally {
          if (path) discardStill(path);
        }
      }

      if (probes.length < 2) {
        throw new Error("Could not render enough frames to inspect.");
      }

      const report = inspectFrames(probes);
      const sampleInterval = Math.round(step * 1000) / 1000;

      return {
        sequence: sequence.name,
        inspectedFrom: from,
        inspectedTo: to,
        sampleIntervalSeconds: sampleInterval,
        failedRenders: failed,
        ...report,
        caveat:
          sampleInterval > 0.16
            ? `Frames were sampled every ${sampleInterval}s, which is coarser than the 3 Hz flashing guideline. Raise samples to be certain about photosensitivity.`
            : null,
      };
    },
  },
]);

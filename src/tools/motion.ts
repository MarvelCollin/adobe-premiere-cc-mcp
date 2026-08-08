import { readFileSync } from "node:fs";
import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { decodePng } from "../analysis/png.js";
import { frameDifference, motionSignature, readMotion, type MotionSample } from "../analysis/motion.js";
import { discardStill, exportStill } from "../premiere/still.js";
import { defineTools } from "./types.js";

export const motionTools = defineTools([
  {
    name: "find_action_peaks",
    description:
      "Measure movement across a clip and report where the action peaks, so a cut can land on the movement rather than near it. Cutting on action hides the join, which is why it is the most used technique in professional continuity editing. Samples frames across the clip, compares each against the one before, and returns the peaks ranked by strength along with a plain reading of whether the shot has a single obvious action or none at all. Slow, since every sample is a real render.",
    schema: {
      node_id: z.string().describe("Node ID of the clip to measure"),
      samples: z
        .number()
        .int()
        .min(4)
        .max(40)
        .default(12)
        .describe("How many frames to compare across the clip, more is slower but finer"),
    },
    handler: async ({ node_id, samples = 12 }: { node_id: string; samples?: number }) => {
      const clip = await evaluate<{ name: string; start: number; end: number }>(`
        var found = __findClip("${esc(node_id)}");
        if (!found) return __error("Clip not found: ${esc(node_id)}");
        return __result({
          name: String(found.clip.name),
          start: found.clip.start.seconds,
          end: found.clip.end.seconds
        });
      `);

      const duration = clip.end - clip.start;
      if (duration < 0.2) {
        throw new Error(`${clip.name} is only ${duration.toFixed(2)}s long, too short to measure movement.`);
      }

      const step = duration / (samples + 1);
      const readings: MotionSample[] = [];
      const failed: { atSeconds: number; error: string }[] = [];
      let previous: Float32Array | null = null;

      for (let index = 1; index <= samples; index += 1) {
        const at = Math.round((clip.start + step * index) * 1000) / 1000;
        let path: string | null = null;
        try {
          path = await exportStill(at, `motion${index}`);
          const signature = motionSignature(decodePng(readFileSync(path)));
          if (previous) {
            readings.push({ atSeconds: at, motion: frameDifference(previous, signature) });
          }
          previous = signature;
        } catch (error) {
          failed.push({ atSeconds: at, error: error instanceof Error ? error.message : String(error) });
        } finally {
          if (path) discardStill(path);
        }
      }

      if (readings.length < 2) {
        throw new Error("Could not render enough frames to measure movement.");
      }

      const reading = readMotion(readings);

      return {
        clip: { nodeId: node_id, name: clip.name, startSeconds: clip.start, endSeconds: clip.end },
        sampled: readings.length,
        failed,
        meanMotion: reading.meanMotion,
        peakMotion: reading.peakMotion,
        peaks: reading.peaks,
        steadiness: reading.steadiness,
        suggestedCutSeconds: reading.peaks.length > 0 ? reading.peaks[0].atSeconds : null,
        hint:
          reading.peaks.length > 0
            ? "Cut on the strongest peak so the movement carries across the join."
            : "No clear action peak, so this shot has no natural cut point. Choose on rhythm instead.",
      };
    },
  },
]);

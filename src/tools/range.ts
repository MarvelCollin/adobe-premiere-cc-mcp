import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { defineTools } from "./types.js";

export const rangeTools = defineTools([
  {
    name: "get_sequence_range",
    description:
      "Read the sequence in and out points and the work area, the two ranges that decide what a partial export covers.",
    schema: {},
    handler: async () =>
      evaluate(`
        var seq = __seq();
        if (!seq) return __error("No active sequence");

        var inPoint = null;
        var outPoint = null;
        try { inPoint = __ticksToSeconds(seq.getInPointAsTime().ticks); } catch (e) { inPoint = null; }
        try { outPoint = __ticksToSeconds(seq.getOutPointAsTime().ticks); } catch (e2) { outPoint = null; }

        if (inPoint !== null && inPoint < 0) inPoint = null;
        if (outPoint !== null && outPoint < 0) outPoint = null;

        var workArea = null;
        try {
          workArea = {
            enabled: seq.isWorkAreaEnabled(),
            startSeconds: seq.getWorkAreaInPointAsTime().seconds,
            endSeconds: seq.getWorkAreaOutPointAsTime().seconds
          };
        } catch (e3) {
          workArea = null;
        }

        return __result({
          durationSeconds: __ticksToSeconds(seq.end),
          hasRange: inPoint !== null && outPoint !== null,
          inPointSeconds: inPoint,
          outPointSeconds: outPoint,
          workArea: workArea
        });
      `),
  },

  {
    name: "set_sequence_range",
    description:
      "Set the sequence in and out points, then read them back. These bound a partial export and give other tools an explicit region to work on.",
    schema: {
      in_seconds: z.number().min(0).describe("Start of the range"),
      out_seconds: z.number().min(0).describe("End of the range, must be after the start"),
    },
    handler: async ({ in_seconds, out_seconds }: { in_seconds: number; out_seconds: number }) => {
      if (out_seconds <= in_seconds) {
        throw new Error("out_seconds must be greater than in_seconds.");
      }
      return evaluate(`
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var duration = __ticksToSeconds(seq.end);
        if (${out_seconds} > duration + 0.001) {
          return __error("out_seconds ${out_seconds} is past the end of the sequence (" + duration + "s)");
        }

        seq.setInPoint(${in_seconds});
        seq.setOutPoint(${out_seconds});

        var appliedIn = __ticksToSeconds(seq.getInPointAsTime().ticks);
        var appliedOut = __ticksToSeconds(seq.getOutPointAsTime().ticks);
        if (Math.abs(appliedIn - ${in_seconds}) > 0.05 || Math.abs(appliedOut - ${out_seconds}) > 0.05) {
          return __error(
            "Range did not stick: asked for ${in_seconds}s to ${out_seconds}s, host reports " +
            appliedIn + "s to " + appliedOut + "s"
          );
        }
        return __result({ inPointSeconds: appliedIn, outPointSeconds: appliedOut });
      `);
    },
  },
]);

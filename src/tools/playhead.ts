import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { defineTools } from "./types.js";

export const playheadTools = defineTools([
  {
    name: "get_playhead",
    description: "Current playhead position in the active sequence, in seconds and as timecode.",
    schema: {},
    handler: async () =>
      evaluate(`
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var position = seq.getPlayerPosition();
        return __result({
          seconds: __ticksToSeconds(position.ticks),
          timecode: String(__qe().CTI.timecode)
        });
      `),
  },

  {
    name: "set_playhead",
    description:
      "Move the playhead to a time in seconds and read the position back. Useful before export_frame, since that captures wherever the playhead lands.",
    schema: { time_seconds: z.number().min(0).describe("Sequence time in seconds") },
    handler: async ({ time_seconds }: { time_seconds: number }) =>
      evaluate(`
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var duration = __ticksToSeconds(seq.end);
        if (${time_seconds} > duration) {
          return __error("Time ${time_seconds}s is past the end of the sequence (" + duration + "s)");
        }
        seq.setPlayerPosition(String(__secondsToTicks(${time_seconds})));
        var applied = __ticksToSeconds(seq.getPlayerPosition().ticks);
        return __result({ seconds: applied, timecode: String(__qe().CTI.timecode) });
      `),
  },
]);

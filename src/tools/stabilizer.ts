import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { WARP_PROPERTY, WARP_RESULT, type WarpMode } from "../premiere/constants.js";
import { defineTools } from "./types.js";

const SOLVED_CHECK = `String(warp.properties[${WARP_PROPERTY.autoScale}].displayName)`;

export const stabilizerTools = defineTools([
  {
    name: "get_stabilizer_status",
    description:
      "Report Warp Stabilizer state for every clip that has it. `solved: false` means the clip has NOT been analysed and is not actually stabilised, whatever its settings say. Always check this after changing stabiliser settings, because scripted changes do not trigger re-analysis.",
    schema: {},
    handler: async () =>
      evaluate(`
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var clips = [];
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
          var list = seq.videoTracks[t].clips;
          for (var c = 0; c < list.numItems; c++) {
            var clip = list[c];
            var warp = __component(clip, "Warp Stabilizer");
            if (!warp) continue;
            var label = ${SOLVED_CHECK};
            clips.push({
              nodeId: String(clip.nodeId),
              name: String(clip.name),
              trackIndex: t,
              solved: label.indexOf("%") !== -1,
              autoScaleLabel: label,
              mode: warp.properties[${WARP_PROPERTY.result}].getValue() === ${WARP_RESULT.no_motion}
                ? "no_motion" : "smooth_motion"
            });
          }
        }
        var unsolved = 0;
        for (var i = 0; i < clips.length; i++) { if (!clips[i].solved) unsolved++; }
        return __result({
          total: clips.length,
          unsolved: unsolved,
          hint: unsolved > 0
            ? "Select each unsolved clip in Premiere and click Analyze in Effect Controls."
            : "All stabilised clips have a solve.",
          clips: clips
        });
      `),
  },

  {
    name: "set_stabilizer_mode",
    description:
      "Set Warp Stabilizer to 'no_motion' (locked static frame, what static-camera edits need) or 'smooth_motion' (keeps camera movement, smoothed). Premiere will NOT re-analyse from a script, so the response tells you whether the clip still needs Analyze clicked in Effect Controls.",
    schema: {
      node_id: z.string().describe("Node ID of the timeline clip"),
      mode: z.enum(["no_motion", "smooth_motion"]),
      max_scale: z.number().positive().optional().describe("Crop ceiling percent, Premiere defaults to 150"),
    },
    handler: async ({
      node_id,
      mode,
      max_scale,
    }: {
      node_id: string;
      mode: WarpMode;
      max_scale?: number;
    }) =>
      evaluate(`
        var found = __findClip("${esc(node_id)}");
        if (!found) return __error("Clip not found: ${esc(node_id)}");
        var warp = __component(found.clip, "Warp Stabilizer");
        if (!warp) return __error("Clip has no Warp Stabilizer. Add it with apply_effect first.");

        warp.properties[${WARP_PROPERTY.result}].setValue(${WARP_RESULT[mode]}, true);
        ${
          typeof max_scale === "number"
            ? `warp.properties[${WARP_PROPERTY.maxScale}].setValue(${max_scale}, true);`
            : ""
        }

        var label = ${SOLVED_CHECK};
        var solved = label.indexOf("%") !== -1;
        return __result({
          nodeId: String(found.clip.nodeId),
          name: String(found.clip.name),
          mode: "${mode}",
          solved: solved,
          autoScaleLabel: label,
          hint: solved
            ? "Stabilisation is solved."
            : "Not analysed yet. Select this clip in Premiere and click Analyze in Effect Controls."
        });
      `),
  },
]);

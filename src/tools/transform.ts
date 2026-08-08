import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { defineTools } from "./types.js";

export const transformTools = defineTools([
  {
    name: "set_scale",
    description:
      "Set a clip's Motion scale and read it back to confirm. 100 means native pixels. Check the source resolution first: scaling above 100 on footage that already matches the sequence frame throws away real detail and cannot be recovered on export.",
    schema: {
      node_id: z.string().describe("Node ID of the timeline clip"),
      scale: z.number().positive().describe("Scale percent, 100 = original size"),
    },
    handler: async ({ node_id, scale }: { node_id: string; scale: number }) =>
      evaluate(`
        var found = __findClip("${esc(node_id)}");
        if (!found) return __error("Clip not found: ${esc(node_id)}");
        var motion = __component(found.clip, "Motion");
        if (!motion) return __error("Clip has no Motion component");
        var prop = __property(motion, "Scale");
        if (!prop) return __error("Motion has no Scale property");

        prop.setValue(${scale}, true);
        var applied = prop.getValue();
        if (Math.abs(applied - ${scale}) > 0.01) {
          return __error("Scale did not stick: asked for ${scale}, host reports " + applied);
        }
        return __result({ nodeId: String(found.clip.nodeId), name: String(found.clip.name), scale: applied });
      `),
  },
]);

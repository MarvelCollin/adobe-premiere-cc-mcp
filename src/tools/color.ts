import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { LUMETRI_PROPERTY, type LumetriField } from "../premiere/constants.js";
import { defineTools } from "./types.js";

const FIELD_ARGUMENTS: Record<string, LumetriField> = {
  exposure: "exposure",
  contrast: "contrast",
  highlights: "highlights",
  shadows: "shadows",
  whites: "whites",
  blacks: "blacks",
  saturation: "saturation",
  temperature: "temperature",
  tint: "tint",
  look_intensity: "lookIntensity",
};

interface GradeArgs {
  node_id: string;
  [field: string]: number | string | undefined;
}

export const colorTools = defineTools([
  {
    name: "set_lumetri",
    description:
      "Set Lumetri Basic Correction values on a clip and read them back. Only the fields you pass change. The clip needs a Lumetri Color effect already; add one with apply_effect. Note that the creative Look itself cannot be set by script, only its intensity.",
    schema: {
      node_id: z.string().describe("Node ID of the timeline clip"),
      exposure: z.number().optional(),
      contrast: z.number().optional(),
      highlights: z.number().optional(),
      shadows: z.number().optional(),
      whites: z.number().optional(),
      blacks: z.number().optional(),
      saturation: z.number().optional().describe("100 = unchanged"),
      temperature: z.number().optional(),
      tint: z.number().optional(),
      look_intensity: z.number().min(0).max(100).optional().describe("Strength of an already-selected Look"),
    },
    handler: async (args: GradeArgs) => {
      const writes = Object.entries(FIELD_ARGUMENTS)
        .filter(([argName]) => typeof args[argName] === "number")
        .map(
          ([argName, field]) =>
            `applied.${argName} = write(${LUMETRI_PROPERTY[field]}, ${args[argName] as number});`,
        );

      if (writes.length === 0) {
        throw new Error("Pass at least one value to change, for example contrast or saturation.");
      }

      return evaluate(`
        var found = __findClip("${esc(args.node_id)}");
        if (!found) return __error("Clip not found: ${esc(args.node_id)}");
        var lumetri = __component(found.clip, "Lumetri Color");
        if (!lumetri) {
          return __error("Clip has no Lumetri Color effect. Add one with apply_effect first.");
        }

        var applied = {};
        function write(index, value) {
          lumetri.properties[index].setValue(value, true);
          return lumetri.properties[index].getValue();
        }
        ${writes.join("\n        ")}

        return __result({
          nodeId: String(found.clip.nodeId),
          name: String(found.clip.name),
          applied: applied
        });
      `);
    },
  },
]);

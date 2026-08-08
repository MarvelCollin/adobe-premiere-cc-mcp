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

interface BatchGradeArgs {
  node_ids: string[];
  add_lumetri_if_missing?: boolean;
  [field: string]: unknown;
}

export const colorTools = defineTools([
  {
    name: "grade_clips",
    description:
      "Apply the same Lumetri Basic Correction to a group of clips in one pass, then read every value back. Grade shot groups that share a lighting condition together; a single correction across mixed lighting is what makes an edit look amateur. Reports per clip, so one failure does not hide the rest.",
    schema: {
      node_ids: z.array(z.string()).min(1).describe("Node IDs of the clips to grade together"),
      add_lumetri_if_missing: z
        .boolean()
        .default(true)
        .describe("Attach a Lumetri Color effect to clips that do not have one"),
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
    handler: async (args: BatchGradeArgs) => {
      const writes = Object.entries(FIELD_ARGUMENTS)
        .filter(([argName]) => typeof args[argName] === "number")
        .map(
          ([argName, field]) =>
            `applied.${argName} = write(lumetri, ${LUMETRI_PROPERTY[field]}, ${args[argName] as number});`,
        );

      if (writes.length === 0) {
        throw new Error("Pass at least one value to change, for example contrast or saturation.");
      }

      const addMissing = args.add_lumetri_if_missing !== false;

      return evaluate(
        `
        var wanted = [${args.node_ids.map((id) => `"${esc(id)}"`).join(", ")}];
        var graded = [];
        var failed = [];

        function write(lumetri, index, value) {
          lumetri.properties[index].setValue(value, true);
          return lumetri.properties[index].getValue();
        }

        for (var i = 0; i < wanted.length; i++) {
          var found = __findClip(wanted[i]);
          if (!found) {
            failed.push({ nodeId: wanted[i], error: "clip not found" });
            continue;
          }
          var lumetri = __component(found.clip, "Lumetri Color");
          ${
            addMissing
              ? `
          if (!lumetri) {
            var qeTrack = __qeTrackFor(found);
            var qeClip = __qeClipAt(qeTrack, found.clip.start.seconds);
            var fx = null;
            try { fx = qe.project.getVideoEffectByName("Lumetri Color"); } catch (lookupError) { fx = null; }
            if (qeClip && fx) {
              qeClip.addVideoEffect(fx);
              lumetri = __component(found.clip, "Lumetri Color");
            }
          }`
              : ""
          }
          if (!lumetri) {
            failed.push({ nodeId: wanted[i], name: String(found.clip.name), error: "no Lumetri Color effect" });
            continue;
          }

          var applied = {};
          ${writes.join("\n          ")}
          graded.push({ nodeId: wanted[i], name: String(found.clip.name), applied: applied });
        }

        return __result({ gradedCount: graded.length, failedCount: failed.length, graded: graded, failed: failed });
      `,
        { timeoutMs: 180_000 },
      );
    },
  },

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

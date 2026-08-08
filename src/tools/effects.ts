import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { defineTools } from "./types.js";

export const effectTools = defineTools([
  {
    name: "list_effects",
    description:
      "List every video or audio effect name Premiere can apply. Use this to get exact names for apply_effect.",
    schema: {
      kind: z.enum(["video", "audio"]).default("video"),
      filter: z.string().optional().describe("Case-insensitive substring to narrow the list"),
    },
    handler: async ({ kind = "video", filter = "" }: { kind?: "video" | "audio"; filter?: string }) =>
      evaluate(`
        __qe();
        var list = ${kind === "audio" ? "qe.project.getAudioEffectList()" : "qe.project.getVideoEffectList()"};
        var needle = "${esc(filter)}".toLowerCase();
        var names = [];
        for (var i = 0; i < list.length; i++) {
          var name = String(list[i]);
          if (needle.length && name.toLowerCase().indexOf(needle) === -1) continue;
          names.push(name);
        }
        return __result({ kind: "${kind}", count: names.length, effects: names });
      `),
  },

  {
    name: "apply_effect",
    description:
      "Add a video or audio effect to a clip by name and confirm it attached. Use list_effects for exact names.",
    schema: {
      node_id: z.string().describe("Node ID of the timeline clip"),
      effect_name: z.string().describe("Exact effect name, e.g. 'Lumetri Color' or 'Warp Stabilizer'"),
    },
    handler: async ({ node_id, effect_name }: { node_id: string; effect_name: string }) =>
      evaluate(
        `
        var found = __findClip("${esc(node_id)}");
        if (!found) return __error("Clip not found: ${esc(node_id)}");
        var clip = found.clip;
        var isVideo = found.trackType === "video";

        var qeTrack = __qeTrackFor(found);
        var qeClip = __qeClipAt(qeTrack, clip.start.seconds);
        if (!qeClip) return __error("Could not resolve the QE clip for " + clip.name);

        var fx = null;
        try {
          fx = isVideo
            ? qe.project.getVideoEffectByName("${esc(effect_name)}")
            : qe.project.getAudioEffectByName("${esc(effect_name)}");
        } catch (lookupError) {
          fx = null;
        }
        var fxName = "";
        if (fx) {
          try { fxName = String(fx.name); } catch (fxNameError) { fxName = ""; }
        }
        if (!fx || fxName.length === 0) {
          return __error(
            "No such effect: ${esc(effect_name)}. Premiere returns a nameless placeholder for an " +
            "unknown effect rather than nothing, so the name has to match exactly. " +
            "Use list_effects for exact names."
          );
        }

        var before = clip.components.numItems;
        if (isVideo) { qeClip.addVideoEffect(fx); } else { qeClip.addAudioEffect(fx); }
        if (clip.components.numItems <= before) {
          return __error("Premiere accepted the effect but it did not attach to " + clip.name);
        }

        return __result({
          nodeId: String(clip.nodeId),
          name: String(clip.name),
          applied: "${esc(effect_name)}",
          effects: __componentNames(clip)
        });
      `,
        { timeoutMs: 60_000 },
      ),
  },
]);

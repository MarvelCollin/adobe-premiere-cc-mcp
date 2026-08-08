import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { defineTools } from "./types.js";

export const transitionTools = defineTools([
  {
    name: "list_transitions",
    description: "List every video transition name Premiere can apply, for use with add_transition.",
    schema: { filter: z.string().optional().describe("Case-insensitive substring, e.g. 'dissolve'") },
    handler: async ({ filter = "" }: { filter?: string }) =>
      evaluate(`
        __qe();
        // Like the effect list, this is an array of plain name strings.
        var list = qe.project.getVideoTransitionList();
        var needle = "${esc(filter)}".toLowerCase();
        var names = [];
        for (var i = 0; i < list.length; i++) {
          var name = String(list[i]);
          if (needle.length && name.toLowerCase().indexOf(needle) === -1) continue;
          names.push(name);
        }
        return __result({ count: names.length, transitions: names });
      `),
  },

  {
    name: "add_transition",
    description:
      "Add a video transition at a clip's head or tail and confirm it appeared on the track. Note that a transition needs media beyond the cut to draw from; without handles Premiere may refuse or shorten it.",
    schema: {
      node_id: z.string().describe("Node ID of the clip to attach the transition to"),
      transition_name: z.string().default("Cross Dissolve").describe("Name from list_transitions"),
      at: z.enum(["start", "end"]).default("end").describe("Which edge of the clip"),
    },
    handler: async ({
      node_id,
      transition_name = "Cross Dissolve",
      at = "end",
    }: {
      node_id: string;
      transition_name?: string;
      at?: "start" | "end";
    }) =>
      evaluate(
        `
        var found = __findClip("${esc(node_id)}");
        if (!found) return __error("Clip not found: ${esc(node_id)}");
        if (found.trackType !== "video") return __error("add_transition handles video clips only");
        var clip = found.clip;

        var qeTrack = __qeTrackFor(found);
        var qeClip = __qeClipAt(qeTrack, clip.start.seconds);
        if (!qeClip) return __error("Could not resolve the QE clip for " + clip.name);

        var transition = null;
        try { transition = qe.project.getVideoTransitionByName("${esc(transition_name)}"); } catch (lookupError) {
          transition = null;
        }
        if (!transition) {
          return __error("No such transition: ${esc(transition_name)}. Use list_transitions for exact names.");
        }

        // On Premiere 26.x addTransition lives on the QE CLIP, not the QE track.
        if (typeof qeClip.addTransition !== "function") {
          return __error("This Premiere build does not expose addTransition on the QE clip");
        }

        var domTrack = __seq().videoTracks[found.trackIndex];
        var before = domTrack.transitions.numItems;
        qeClip.addTransition(transition, ${at === "start" ? "true" : "false"});
        var after = domTrack.transitions.numItems;

        if (after <= before) {
          return __error(
            "Premiere accepted the transition but none appeared. The clip probably has no handles " +
            "(unused media beyond the cut) at its ${at}."
          );
        }
        return __result({
          nodeId: String(clip.nodeId),
          name: String(clip.name),
          transition: "${esc(transition_name)}",
          at: "${at}",
          transitionsBefore: before,
          transitionsAfter: after
        });
      `,
        { timeoutMs: 60_000 },
      ),
  },
]);

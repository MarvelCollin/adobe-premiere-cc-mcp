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
        var resolvedName = "";
        if (transition) {
          try { resolvedName = String(transition.name); } catch (nameError) { resolvedName = ""; }
        }
        if (!transition || resolvedName.length === 0) {
          return __error(
            "No such transition: ${esc(transition_name)}. Premiere hands back a nameless placeholder " +
            "for an unknown transition rather than nothing, and applying it silently produces a " +
            "Cross Dissolve. Use list_transitions for exact names."
          );
        }

        if (typeof qeClip.addTransition !== "function") {
          return __error("This Premiere build does not expose addTransition on the QE clip");
        }

        function transitionCount() {
          return __seq().videoTracks[found.trackIndex].transitions.numItems;
        }

        var edgeSeconds = ${at === "start" ? "clip.start.seconds" : "clip.end.seconds"};
        var existingTrack = __seq().videoTracks[found.trackIndex];
        for (var e = 0; e < existingTrack.transitions.numItems; e++) {
          var existing = existingTrack.transitions[e];
          if (existing.start.seconds - 0.001 <= edgeSeconds && existing.end.seconds + 0.001 >= edgeSeconds) {
            return __result({
              nodeId: String(clip.nodeId),
              name: String(clip.name),
              transition: String(existing.name),
              at: "${at}",
              alreadyPresent: true,
              transitionsBefore: existingTrack.transitions.numItems,
              transitionsAfter: existingTrack.transitions.numItems
            });
          }
        }

        var before = transitionCount();
        qeClip.addTransition(transition, ${at === "start" ? "true" : "false"});

        var after = transitionCount();
        if (after <= before) {
          try { $.sleep(300); } catch (sleepError) { }
          after = transitionCount();
        }

        if (after <= before) {
          return __error(
            "Premiere accepted the transition but none appeared. The clip probably has no handles " +
            "(unused media beyond the cut) at its ${at}."
          );
        }
        var landed = resolvedName;
        var finalTrack = __seq().videoTracks[found.trackIndex];
        for (var n = 0; n < finalTrack.transitions.numItems; n++) {
          var added = finalTrack.transitions[n];
          if (added.start.seconds - 0.001 <= edgeSeconds && added.end.seconds + 0.001 >= edgeSeconds) {
            landed = String(added.name);
            break;
          }
        }

        return __result({
          nodeId: String(clip.nodeId),
          name: String(clip.name),
          transition: landed,
          requested: "${esc(transition_name)}",
          at: "${at}",
          transitionsBefore: before,
          transitionsAfter: after,
          warning: landed !== "${esc(transition_name)}"
            ? "Premiere applied " + landed + " rather than the requested ${esc(transition_name)}."
            : null
        });
      `,
        { timeoutMs: 60_000 },
      ),
  },
]);

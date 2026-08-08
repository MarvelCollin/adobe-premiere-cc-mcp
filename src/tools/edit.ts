import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { defineTools } from "./types.js";

const NODE_ID = z.string().describe("Node ID of the timeline clip");

export const editTools = defineTools([
  {
    name: "set_clip_enabled",
    description:
      "Enable or disable a clip. A disabled clip stays on the timeline but is skipped in playback and export, which makes it a safe way to try removing a shot.",
    schema: {
      node_id: NODE_ID,
      enabled: z.boolean().describe("False hides the clip from playback and export without deleting it"),
    },
    handler: async ({ node_id, enabled }: { node_id: string; enabled: boolean }) =>
      evaluate(`
        var found = __findClip("${esc(node_id)}");
        if (!found) return __error("Clip not found: ${esc(node_id)}");
        found.clip.disabled = ${enabled ? "false" : "true"};
        var isEnabled = !found.clip.disabled;
        if (isEnabled !== ${enabled}) {
          return __error("Enabled state did not stick for " + found.clip.name);
        }
        return __result({
          nodeId: String(found.clip.nodeId),
          name: String(found.clip.name),
          enabled: isEnabled
        });
      `),
  },

  {
    name: "split_clip",
    description:
      "Cut every clip on a track at the given time, the same as the razor tool. Returns the new clip count so you can confirm the cut landed.",
    schema: {
      track_type: z.enum(["video", "audio"]).default("video"),
      track_index: z.number().int().min(0).describe("Zero based track index, so V1 is 0"),
      time_seconds: z.number().min(0).describe("Where to cut"),
    },
    handler: async ({
      track_type = "video",
      track_index,
      time_seconds,
    }: {
      track_type?: "video" | "audio";
      track_index: number;
      time_seconds: number;
    }) =>
      evaluate(`
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var domTracks = ${track_type === "video" ? "seq.videoTracks" : "seq.audioTracks"};
        if (${track_index} >= domTracks.numTracks) {
          return __error("No ${track_type} track at index ${track_index}");
        }
        var before = domTracks[${track_index}].clips.numItems;

        var qeSeq = __qe();
        var qeTrack = ${
          track_type === "video"
            ? `qeSeq.getVideoTrackAt(${track_index})`
            : `qeSeq.getAudioTrackAt(${track_index})`
        };
        if (typeof qeTrack.razor !== "function") {
          return __error("This Premiere build does not expose razor on the QE track");
        }
        seq.setPlayerPosition(String(__secondsToTicks(${time_seconds})));
        qeTrack.razor(String(qeSeq.CTI.timecode));

        var after = domTracks[${track_index}].clips.numItems;
        if (after <= before) {
          return __error(
            "Razor ran at ${time_seconds}s but the clip count did not change. Either no clip covers that " +
            "time on ${track_type} track ${track_index}, or there is already an edit point there."
          );
        }
        return __result({
          trackType: "${track_type}",
          trackIndex: ${track_index},
          atSeconds: ${time_seconds},
          clipsBefore: before,
          clipsAfter: after
        });
      `),
  },

  {
    name: "remove_clip",
    description:
      "Remove a clip from the timeline. Ripple closes the gap and shifts everything after it; lift leaves a gap. Destructive, so confirm the node ID with get_timeline first.",
    schema: {
      node_id: NODE_ID,
      ripple: z.boolean().default(false).describe("True closes the gap, false leaves it"),
    },
    handler: async ({ node_id, ripple = false }: { node_id: string; ripple?: boolean }) =>
      evaluate(`
        var found = __findClip("${esc(node_id)}");
        if (!found) return __error("Clip not found: ${esc(node_id)}");
        var clip = found.clip;
        var name = String(clip.name);
        var startSeconds = clip.start.seconds;

        var qeTrack = __qeTrackFor(found);
        var qeClip = __qeClipAt(qeTrack, startSeconds);
        if (!qeClip) return __error("Could not resolve the QE clip for " + name);
        if (typeof qeClip.remove !== "function") {
          return __error("This Premiere build does not expose remove on the QE clip");
        }

        var seq = __seq();
        var domTracks = found.trackType === "video" ? seq.videoTracks : seq.audioTracks;
        var before = domTracks[found.trackIndex].clips.numItems;

        qeClip.remove(${ripple ? "true" : "false"}, false);

        var after = domTracks[found.trackIndex].clips.numItems;
        if (after >= before) return __error("Remove ran but the clip count did not drop for " + name);
        return __result({
          removed: name,
          atSeconds: startSeconds,
          rippled: ${ripple},
          clipsBefore: before,
          clipsAfter: after
        });
      `),
  },
]);

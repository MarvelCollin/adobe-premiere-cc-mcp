import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { defineTools } from "./types.js";

export const assemblyTools = defineTools([
  {
    name: "add_to_timeline",
    description:
      "Place a project item onto a track at a given time and confirm the clip count grew. Overwrite replaces whatever is already there; insert pushes later clips further down the track. Use list_project_items to get the item ID.",
    schema: {
      item_id: z.string().describe("Node ID or exact name of the project item"),
      track_type: z.enum(["video", "audio"]).default("video"),
      track_index: z.number().int().min(0).describe("Zero based track index, so V1 is 0"),
      time_seconds: z.number().min(0).describe("Where on the timeline to place it"),
      mode: z.enum(["overwrite", "insert"]).default("overwrite"),
    },
    handler: async ({
      item_id,
      track_type = "video",
      track_index,
      time_seconds,
      mode = "overwrite",
    }: {
      item_id: string;
      track_type?: "video" | "audio";
      track_index: number;
      time_seconds: number;
      mode?: "overwrite" | "insert";
    }) =>
      evaluate(
        `
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var item = __findProjectItem("${esc(item_id)}");
        if (!item) return __error("Project item not found: ${esc(item_id)}");
        if (item.type === ProjectItemType.BIN) return __error("${esc(item_id)} is a bin, not media");

        var tracks = ${track_type === "video" ? "seq.videoTracks" : "seq.audioTracks"};
        if (${track_index} >= tracks.numTracks) {
          return __error("No ${track_type} track at index ${track_index}; the sequence has " + tracks.numTracks);
        }
        var track = tracks[${track_index}];
        var before = track.clips.numItems;

        track.${mode === "insert" ? "insertClip" : "overwriteClip"}(item, ${time_seconds});

        var after = tracks[${track_index}].clips.numItems;

        var placed = null;
        for (var c = 0; c < tracks[${track_index}].clips.numItems; c++) {
          var candidate = tracks[${track_index}].clips[c];
          if (Math.abs(candidate.start.seconds - ${time_seconds}) < 0.05) { placed = candidate; break; }
        }
        if (!placed || String(placed.projectItem.nodeId) !== String(item.nodeId)) {
          return __error(
            "Premiere accepted the edit but " + String(item.name) + " is not at ${time_seconds}s. " +
            "Check the item has a ${track_type} stream and that the track is not locked."
          );
        }
        return __result({
          item: String(item.name),
          mode: "${mode}",
          trackType: "${track_type}",
          trackIndex: ${track_index},
          atSeconds: ${time_seconds},
          clipsBefore: before,
          clipsAfter: after,
          placed: placed
            ? { nodeId: String(placed.nodeId), start: placed.start.seconds, end: placed.end.seconds }
            : null
        });
      `,
        { timeoutMs: 60_000 },
      ),
  },

  {
    name: "move_clip",
    description:
      "Move a clip to a new start time on its own track and confirm it landed. Refuses by default when another clip already occupies the destination, because Premiere's move overwrites whatever is in the way rather than pushing it aside. Pass overwrite to accept that and destroy what is there.",
    schema: {
      node_id: z.string().describe("Node ID of the timeline clip"),
      time_seconds: z.number().min(0).describe("New start time"),
      overwrite: z
        .boolean()
        .default(false)
        .describe("Allow the move to destroy clips already sitting at the destination"),
    },
    handler: async ({
      node_id,
      time_seconds,
      overwrite = false,
    }: {
      node_id: string;
      time_seconds: number;
      overwrite?: boolean;
    }) =>
      evaluate(`
        var found = __findClip("${esc(node_id)}");
        if (!found) return __error("Clip not found: ${esc(node_id)}");
        var clip = found.clip;
        var from = clip.start.seconds;
        var duration = clip.end.seconds - from;

        if (!${overwrite}) {
          var target = ${time_seconds};
          var targetEnd = target + duration;
          var group = found.trackType === "audio" ? __seq().audioTracks : __seq().videoTracks;
          var lane = group[found.trackIndex];
          var blocking = [];
          for (var o = 0; o < lane.clips.numItems; o++) {
            var other = lane.clips[o];
            if (String(other.nodeId) === String(clip.nodeId)) continue;
            if (other.start.seconds < targetEnd - 0.001 && other.end.seconds > target + 0.001) {
              blocking.push(String(other.name) + " at " + other.start.seconds + "s to " + other.end.seconds + "s");
            }
          }
          if (blocking.length > 0) {
            return __error(
              "Refusing to move " + String(clip.name) + " to " + target + "s: " +
              blocking.join(", ") + " already occupies that span, and Premiere's move " +
              "overwrites rather than ripples. Move the other clip first, or pass overwrite to destroy it."
            );
          }
        }

        var qeTrack = __qeTrackFor(found);
        var qeClip = __qeClipAt(qeTrack, from);
        if (!qeClip) return __error("Could not resolve the QE clip for " + clip.name);
        if (typeof qeClip.move !== "function") {
          return __error("This Premiere build does not expose move on the QE clip");
        }

        var delta = ${time_seconds} - from;
        if (Math.abs(delta) < 0.001) {
          return __result({
            nodeId: String(clip.nodeId),
            name: String(clip.name),
            fromSeconds: from,
            toSeconds: from,
            durationSeconds: duration,
            alreadyThere: true
          });
        }

        var offset = __timecode(delta);
        qeClip.move(delta < 0 ? "-" + offset : offset);

        var moved = __findClip("${esc(node_id)}");
        var to = moved ? moved.clip.start.seconds : null;
        if (to === null || Math.abs(to - ${time_seconds}) > 0.05) {
          return __error(
            "Move did not land: asked for ${time_seconds}s, clip sits at " + to +
            "s. Something may already occupy that space."
          );
        }
        return __result({
          nodeId: String(clip.nodeId),
          name: String(clip.name),
          fromSeconds: from,
          toSeconds: to,
          durationSeconds: duration
        });
      `),
  },

  {
    name: "set_clip_speed",
    description:
      "Change a clip's playback speed. 100 is normal, 50 is half speed, 200 is double speed. The clip keeps its slot on the timeline rather than growing or shrinking, so it covers less or more source footage instead; the response reports the speed read back off the clip, which is what confirms the change landed.",
    schema: {
      node_id: z.string().describe("Node ID of the timeline clip"),
      speed_percent: z.number().positive().describe("100 = normal speed"),
    },
    handler: async ({ node_id, speed_percent }: { node_id: string; speed_percent: number }) =>
      evaluate(
        `
        var found = __findClip("${esc(node_id)}");
        if (!found) return __error("Clip not found: ${esc(node_id)}");
        var clip = found.clip;
        var beforeDuration = clip.end.seconds - clip.start.seconds;

        var qeTrack = __qeTrackFor(found);
        var qeClip = __qeClipAt(qeTrack, clip.start.seconds);
        if (!qeClip) return __error("Could not resolve the QE clip for " + clip.name);
        if (typeof qeClip.setSpeed !== "function") {
          return __error("This Premiere build does not expose setSpeed on the QE clip");
        }

        var rate = ${speed_percent / 100};
        var targetDuration = beforeDuration / rate;
        qeClip.setSpeed(rate, __timecode(targetDuration), false, true, false);

        var after = __findClip("${esc(node_id)}");
        var afterDuration = after ? after.clip.end.seconds - after.clip.start.seconds : null;
        if (afterDuration === null) {
          return __error("The clip disappeared after the speed change");
        }

        var appliedSpeed = null;
        var verifyClip = __qeClipAt(__qeTrackFor(after), after.clip.start.seconds);
        if (verifyClip) {
          try { appliedSpeed = verifyClip.speed; } catch (e) { appliedSpeed = null; }
        }
        if (appliedSpeed !== null && Math.abs(appliedSpeed - rate) > 0.01) {
          return __error(
            "Premiere clamped the speed to " + Math.round(appliedSpeed * 10000) / 100 +
            "% after asking for ${speed_percent}%. Speeding a clip up consumes more source " +
            "footage for the same slot, so this usually means the clip has no more media " +
            "beyond its out point, or a neighbouring clip blocks the new duration. Trim the " +
            "clip shorter first, or move what follows it."
          );
        }

        return __result({
          nodeId: String(clip.nodeId),
          name: String(clip.name),
          speedPercent: ${speed_percent},
          appliedSpeedPercent: appliedSpeed === null ? null : appliedSpeed * 100,
          durationBefore: beforeDuration,
          durationAfter: afterDuration
        });
      `,
        { timeoutMs: 60_000 },
      ),
  },

  {
    name: "trim_clip",
    description:
      "Trim a clip's start or end on the timeline and confirm the new duration. Trimming the end shortens the tail; trimming the start moves the head later, leaving a gap.",
    schema: {
      node_id: z.string().describe("Node ID of the timeline clip"),
      edge: z.enum(["start", "end"]).describe("Which edge to move"),
      time_seconds: z.number().min(0).describe("New timeline position for that edge"),
    },
    handler: async ({
      node_id,
      edge,
      time_seconds,
    }: {
      node_id: string;
      edge: "start" | "end";
      time_seconds: number;
    }) =>
      evaluate(`
        var found = __findClip("${esc(node_id)}");
        if (!found) return __error("Clip not found: ${esc(node_id)}");
        var clip = found.clip;
        var beforeStart = clip.start.seconds;
        var beforeEnd = clip.end.seconds;

        ${
          edge === "end"
            ? `if (${time_seconds} <= beforeStart) return __error("The end must come after the start (" + beforeStart + "s)");`
            : `if (${time_seconds} >= beforeEnd) return __error("The start must come before the end (" + beforeEnd + "s)");`
        }

        var edgeTime = clip.${edge};
        edgeTime.seconds = ${time_seconds};
        clip.${edge} = edgeTime;

        var after = __findClip("${esc(node_id)}");
        if (!after) return __error("The clip disappeared after trimming");
        var applied = after.clip.${edge}.seconds;
        if (Math.abs(applied - ${time_seconds}) > 0.05) {
          return __error("Trim did not stick: asked for ${time_seconds}s, clip ${edge} is at " + applied + "s");
        }
        return __result({
          nodeId: String(clip.nodeId),
          name: String(clip.name),
          edge: "${edge}",
          startBefore: beforeStart,
          endBefore: beforeEnd,
          startAfter: after.clip.start.seconds,
          endAfter: after.clip.end.seconds
        });
      `),
  },
]);

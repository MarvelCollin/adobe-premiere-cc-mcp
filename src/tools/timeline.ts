import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { defineTools } from "./types.js";

const NODE_ID = z.string().describe("Node ID of the timeline clip");

export const timelineTools = defineTools([
  {
    name: "get_timeline",
    description:
      "Picture of the active sequence: resolution, frame rate, duration, and every clip on every track with its node ID, timing and Motion scale. The best first call before editing anything. Defaults to a compact form that reports how many effects each clip carries rather than naming them, which keeps a long edit readable; pass detail 'full' when you need the effect names, or empty_tracks true to see tracks with nothing on them. Narrow to one track with track_type and track_index.",
    schema: {
      detail: z
        .enum(["compact", "full"])
        .default("compact")
        .describe("'full' lists every effect name on every clip"),
      track_type: z.enum(["video", "audio", "both"]).default("both"),
      track_index: z.number().int().min(0).optional().describe("Only this track, zero based"),
      empty_tracks: z.boolean().default(false).describe("Include tracks that hold no clips"),
    },
    handler: async ({
      detail = "compact",
      track_type = "both",
      track_index,
      empty_tracks = false,
    }: {
      detail?: "compact" | "full";
      track_type?: "video" | "audio" | "both";
      track_index?: number;
      empty_tracks?: boolean;
    }) =>
      evaluate(
        `
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var wantFull = ${detail === "full"};
        var wantEmpty = ${empty_tracks};
        var onlyTrack = ${track_index === undefined ? "-1" : track_index};
        var out = {
          name: String(seq.name),
          width: seq.frameSizeHorizontal,
          height: seq.frameSizeVertical,
          fps: Math.round((TICKS_PER_SECOND / Number(seq.timebase)) * 100) / 100,
          durationSeconds: __ticksToSeconds(seq.end),
          videoTracks: [],
          audioTracks: []
        };
        var groups = [];
        if (${track_type !== "audio"}) {
          groups.push({ list: seq.videoTracks, into: out.videoTracks, isVideo: true });
        }
        if (${track_type !== "video"}) {
          groups.push({ list: seq.audioTracks, into: out.audioTracks, isVideo: false });
        }
        var hiddenEmpty = 0;
        for (var g = 0; g < groups.length; g++) {
          var tracks = groups[g].list;
          for (var t = 0; t < tracks.numTracks; t++) {
            if (onlyTrack >= 0 && t !== onlyTrack) continue;
            var track = tracks[t];
            if (!wantEmpty && track.clips.numItems === 0) { hiddenEmpty++; continue; }
            var entry = {
              index: t,
              name: String(track.name),
              muted: track.isMuted(),
              transitions: track.transitions.numItems,
              clips: []
            };
            for (var c = 0; c < track.clips.numItems; c++) {
              var clip = track.clips[c];
              var scale = null;
              if (groups[g].isVideo) {
                var motion = __component(clip, "Motion");
                if (motion) {
                  var scaleProp = __property(motion, "Scale");
                  if (scaleProp) scale = scaleProp.getValue();
                }
              }
              var names = __componentNames(clip);
              var record = {
                nodeId: String(clip.nodeId),
                name: String(clip.name),
                start: clip.start.seconds,
                end: clip.end.seconds,
                inPoint: clip.inPoint.seconds,
                scale: scale
              };
              if (wantFull) {
                record.effects = names;
              } else {
                record.effectCount = names.length;
              }
              entry.clips.push(record);
            }
            groups[g].into.push(entry);
          }
        }
        if (hiddenEmpty > 0) out.emptyTracksHidden = hiddenEmpty;
        if (!wantFull) out.note = "Effect names omitted; call again with detail 'full' or use get_clip for one clip.";
        return __result(out);
      `,
        { timeoutMs: 60_000 },
      ),
  },

  {
    name: "get_clip",
    description:
      "Everything about one clip: timing, in-point, and every effect with all of its property values and keyframe state. Read this before changing a clip so you know what you are overwriting.",
    schema: { node_id: NODE_ID },
    handler: async ({ node_id }: { node_id: string }) =>
      evaluate(`
        var found = __findClip("${esc(node_id)}");
        if (!found) return __error("Clip not found: ${esc(node_id)}");
        var clip = found.clip;
        var effects = [];
        for (var i = 0; i < clip.components.numItems; i++) {
          var comp = clip.components[i];
          var props = [];
          for (var p = 0; p < comp.properties.numItems; p++) {
            var prop = comp.properties[p];
            var value = null;
            try { value = prop.getValue(); } catch (e) { value = "<unreadable>"; }
            if (typeof value === "string" && value.length > 80) value = "<blob>";
            var keyframed = false;
            try { keyframed = prop.isTimeVarying(); } catch (e2) { keyframed = false; }
            props.push({ index: p, name: String(prop.displayName), value: value, keyframed: keyframed });
          }
          effects.push({ index: i, name: String(comp.displayName), properties: props });
        }
        return __result({
          nodeId: String(clip.nodeId),
          name: String(clip.name),
          trackType: found.trackType,
          trackIndex: found.trackIndex,
          start: clip.start.seconds,
          end: clip.end.seconds,
          inPoint: clip.inPoint.seconds,
          effects: effects
        });
      `),
  },
]);

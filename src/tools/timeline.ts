import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { defineTools } from "./types.js";

const NODE_ID = z.string().describe("Node ID of the timeline clip");

export const timelineTools = defineTools([
  {
    name: "get_timeline",
    description:
      "Full picture of the active sequence: resolution, frame rate, duration, and every clip on every track with its node ID, timing, effects and Motion scale. The best first call before editing anything.",
    schema: {},
    handler: async () =>
      evaluate(
        `
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var out = {
          name: String(seq.name),
          width: seq.frameSizeHorizontal,
          height: seq.frameSizeVertical,
          fps: Math.round((TICKS_PER_SECOND / Number(seq.timebase)) * 100) / 100,
          durationSeconds: __ticksToSeconds(seq.end),
          videoTracks: [],
          audioTracks: []
        };
        var groups = [
          { list: seq.videoTracks, into: out.videoTracks, isVideo: true },
          { list: seq.audioTracks, into: out.audioTracks, isVideo: false }
        ];
        for (var g = 0; g < groups.length; g++) {
          var tracks = groups[g].list;
          for (var t = 0; t < tracks.numTracks; t++) {
            var track = tracks[t];
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
              entry.clips.push({
                nodeId: String(clip.nodeId),
                name: String(clip.name),
                start: clip.start.seconds,
                end: clip.end.seconds,
                inPoint: clip.inPoint.seconds,
                scale: scale,
                effects: __componentNames(clip)
              });
            }
            groups[g].into.push(entry);
          }
        }
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
            // Lumetri stores a large opaque blob that is useless in a response.
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

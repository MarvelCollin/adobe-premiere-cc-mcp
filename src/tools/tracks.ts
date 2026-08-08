import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { defineTools } from "./types.js";

export const trackTools = defineTools([
  {
    name: "set_track_state",
    description:
      "Mute or unmute a video or audio track and read the state back. Muting a video track hides it from the program monitor and from exports.",
    schema: {
      track_type: z.enum(["video", "audio"]),
      track_index: z.number().int().min(0).describe("Zero based track index, so V1 is 0"),
      muted: z.boolean().describe("True to mute or hide the track"),
    },
    handler: async ({
      track_type,
      track_index,
      muted,
    }: {
      track_type: "video" | "audio";
      track_index: number;
      muted: boolean;
    }) =>
      evaluate(`
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var tracks = ${track_type === "video" ? "seq.videoTracks" : "seq.audioTracks"};
        if (${track_index} >= tracks.numTracks) {
          return __error("No ${track_type} track at index ${track_index}; the sequence has " + tracks.numTracks);
        }
        var track = tracks[${track_index}];
        track.setMute(${muted ? 1 : 0});
        var applied = track.isMuted();
        if (applied !== ${muted}) {
          return __error("Track mute did not stick: asked for ${muted}, host reports " + applied);
        }
        return __result({
          trackType: "${track_type}",
          trackIndex: ${track_index},
          name: String(track.name),
          muted: applied
        });
      `),
  },
]);

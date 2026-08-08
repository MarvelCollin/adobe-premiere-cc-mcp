import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { defineTools } from "./types.js";

export const splitEditTools = defineTools([
  {
    name: "make_split_edit",
    description:
      "Turn a straight cut into a J or L cut, the technique that most separates professional cutting from amateur. An L cut lets the outgoing audio run under the incoming picture, which softens the change and gives a moment weight. A J cut brings the incoming audio in early, which pulls the viewer forward. Unlinks the audio from the picture, moves only the audio edit, then reads the result back and reports the offset actually achieved, which can be smaller than asked for when the clip has no spare media to extend into.",
    schema: {
      cut_seconds: z.number().min(0).describe("The picture cut to convert, in sequence seconds"),
      type: z
        .enum(["j", "l"])
        .describe("j brings the next clip's audio in early, l lets this clip's audio run on"),
      overlap_seconds: z
        .number()
        .positive()
        .max(10)
        .default(0.5)
        .describe("How far the audio edit should sit from the picture cut"),
      video_track: z.number().int().min(0).default(0),
      audio_track: z.number().int().min(0).default(0),
    },
    handler: async ({
      cut_seconds,
      type,
      overlap_seconds = 0.5,
      video_track = 0,
      audio_track = 0,
    }: {
      cut_seconds: number;
      type: "j" | "l";
      overlap_seconds?: number;
      video_track?: number;
      audio_track?: number;
    }) =>
      evaluate(
        `
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        if (${video_track} >= seq.videoTracks.numTracks) return __error("No video track ${video_track}");
        if (${audio_track} >= seq.audioTracks.numTracks) return __error("No audio track ${audio_track}");

        var videoTrack = seq.videoTracks[${video_track}];
        var audioTrack = seq.audioTracks[${audio_track}];
        var cut = ${cut_seconds};
        var overlap = ${overlap_seconds};

        function clipEndingAt(track, time) {
          for (var i = 0; i < track.clips.numItems; i++) {
            if (Math.abs(track.clips[i].end.seconds - time) < 0.05) return track.clips[i];
          }
          return null;
        }
        function clipStartingAt(track, time) {
          for (var i = 0; i < track.clips.numItems; i++) {
            if (Math.abs(track.clips[i].start.seconds - time) < 0.05) return track.clips[i];
          }
          return null;
        }

        var outgoingVideo = clipEndingAt(videoTrack, cut);
        var incomingVideo = clipStartingAt(videoTrack, cut);
        if (!outgoingVideo || !incomingVideo) {
          return __error("No picture cut at " + cut + "s on video track ${video_track}");
        }

        var outgoingAudio = clipEndingAt(audioTrack, cut);
        var incomingAudio = clipStartingAt(audioTrack, cut);
        if (!outgoingAudio || !incomingAudio) {
          return __error(
            "The audio on track ${audio_track} does not cut at " + cut + "s, so there is no straight cut to split."
          );
        }

        var outgoingName = String(outgoingVideo.name);
        var incomingName = String(incomingVideo.name);

        for (var s = 0; s < seq.videoTracks.numTracks; s++) {
          var vt = seq.videoTracks[s];
          for (var vc = 0; vc < vt.clips.numItems; vc++) vt.clips[vc].setSelected(false, true);
        }
        for (var t = 0; t < seq.audioTracks.numTracks; t++) {
          var at = seq.audioTracks[t];
          for (var ac = 0; ac < at.clips.numItems; ac++) at.clips[ac].setSelected(false, true);
        }

        outgoingVideo.setSelected(true, true);
        incomingVideo.setSelected(true, true);
        seq.unlinkSelection();

        var target = ${type === "l" ? "cut + overlap" : "cut - overlap"};
        if (target <= outgoingAudio.start.seconds || target >= incomingAudio.end.seconds) {
          return __error("An overlap of " + overlap + "s would run past one of the clips.");
        }

        var outEnd = outgoingAudio.end;
        outEnd.seconds = target;
        outgoingAudio.end = outEnd;

        var inStart = incomingAudio.start;
        inStart.seconds = target;
        incomingAudio.start = inStart;

        var achievedOut = outgoingAudio.end.seconds;
        var achievedIn = incomingAudio.start.seconds;
        var offset = Math.round((achievedOut - cut) * 1000) / 1000;

        if (Math.abs(offset) < 0.02) {
          return __error(
            "The audio edit did not move. The clip probably has no spare media beyond the cut to extend into."
          );
        }

        return __result({
          type: "${type}",
          cutSeconds: cut,
          requestedOverlap: overlap,
          achievedOffsetSeconds: offset,
          shortOfRequest: Math.abs(Math.abs(offset) - overlap) > 0.05,
          outgoingClip: outgoingName,
          incomingClip: incomingName,
          audioEditAtSeconds: Math.round(achievedOut * 1000) / 1000,
          incomingAudioStartsAt: Math.round(achievedIn * 1000) / 1000,
          pictureCutStillAt: cut,
          note:
            "${type}" === "l"
              ? "The outgoing audio now runs under the incoming picture."
              : "The incoming audio now starts before its picture."
        });
      `,
        { timeoutMs: 120_000 },
      ),
  },
]);

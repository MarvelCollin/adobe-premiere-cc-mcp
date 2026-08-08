import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { defineTools } from "./types.js";

interface PlatformProfile {
  label: string;
  vertical: boolean;
  hookSeconds: number;
  maxStaticSeconds: number;
  cutsPerMinute: [number, number];
  maxDurationSeconds: number | null;
  loudnessLufs: number;
}

const PLATFORMS: Record<string, PlatformProfile> = {
  tiktok: {
    label: "TikTok",
    vertical: true,
    hookSeconds: 1.5,
    maxStaticSeconds: 3,
    cutsPerMinute: [20, 60],
    maxDurationSeconds: 180,
    loudnessLufs: -14,
  },
  reels: {
    label: "Instagram Reels",
    vertical: true,
    hookSeconds: 3,
    maxStaticSeconds: 3,
    cutsPerMinute: [20, 60],
    maxDurationSeconds: 90,
    loudnessLufs: -14,
  },
  shorts: {
    label: "YouTube Shorts",
    vertical: true,
    hookSeconds: 3,
    maxStaticSeconds: 3,
    cutsPerMinute: [15, 50],
    maxDurationSeconds: 180,
    loudnessLufs: -14,
  },
  youtube: {
    label: "YouTube long form",
    vertical: false,
    hookSeconds: 8,
    maxStaticSeconds: 12,
    cutsPerMinute: [6, 20],
    maxDurationSeconds: null,
    loudnessLufs: -14,
  },
};

interface Finding {
  severity: "blocker" | "warning" | "note";
  area: string;
  detail: string;
}

export const critiqueTools = defineTools([
  {
    name: "critique_edit",
    description:
      "Judge the active sequence against what actually holds attention on a given platform, and say whether it is ready to post. Read only and fast, since it works from the timeline rather than rendering. Reports the format, how often the picture changes, what happens in the opening seconds, whether anything on screen carries the message without sound, and where the edit departs from the norms for that platform. Thresholds come from published short form guidance rather than taste: the opening three seconds decide whether a viewer stays, a meaningful visual change every two to three seconds is the short form norm, and most short form viewing is muted. Pair with analyse_loudness for the audio side, which this does not render.",
    schema: {
      platform: z
        .enum(["tiktok", "reels", "shorts", "youtube"])
        .default("reels")
        .describe("Which platform's norms to judge against"),
    },
    handler: async ({ platform = "reels" }: { platform?: keyof typeof PLATFORMS }) => {
      const profile = PLATFORMS[platform];

      const timeline = await evaluate<{
        name: string;
        width: number;
        height: number;
        fps: number;
        durationSeconds: number;
        contentEndSeconds: number;
        videoClips: number;
        audioClips: number;
        graphicClips: number;
        transitions: number;
        boundaries: number[];
        mainTrackClips: number;
      }>(`
        var seq = __seq();
        if (!seq) return __error("No active sequence");

        var boundaries = [];
        var videoClips = 0;
        var graphicClips = 0;
        var transitions = 0;
        var contentEnd = 0;
        var mainTrackClips = 0;

        function remember(value) {
          for (var b = 0; b < boundaries.length; b++) {
            if (Math.abs(boundaries[b] - value) < 0.04) return;
          }
          boundaries.push(value);
        }

        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
          var track = seq.videoTracks[t];
          transitions += track.transitions.numItems;
          if (t === 0) mainTrackClips = track.clips.numItems;
          for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            videoClips++;
            var name = String(clip.name).toLowerCase();
            if (name.indexOf("graphic") >= 0 || name.indexOf("text") >= 0 || name.indexOf("title") >= 0) {
              graphicClips++;
            }
            remember(clip.start.seconds);
            if (clip.end.seconds > contentEnd) contentEnd = clip.end.seconds;
          }
        }

        var audioClips = 0;
        for (var a = 0; a < seq.audioTracks.numTracks; a++) {
          var atrack = seq.audioTracks[a];
          if (atrack.isMuted()) continue;
          audioClips += atrack.clips.numItems;
          for (var ac = 0; ac < atrack.clips.numItems; ac++) {
            if (atrack.clips[ac].end.seconds > contentEnd) contentEnd = atrack.clips[ac].end.seconds;
          }
        }

        boundaries.sort(function (x, y) { return x - y; });

        return __result({
          name: String(seq.name),
          width: seq.frameSizeHorizontal,
          height: seq.frameSizeVertical,
          fps: Math.round((TICKS_PER_SECOND / Number(seq.timebase)) * 100) / 100,
          durationSeconds: __ticksToSeconds(seq.end),
          contentEndSeconds: contentEnd,
          videoClips: videoClips,
          audioClips: audioClips,
          graphicClips: graphicClips,
          transitions: transitions,
          boundaries: boundaries,
          mainTrackClips: mainTrackClips
        });
      `);

      const runtime = timeline.contentEndSeconds || timeline.durationSeconds;
      const changes = timeline.boundaries.filter((at) => at < runtime - 0.05);
      const cutsPerMinute = runtime > 0 ? Math.round((changes.length / runtime) * 60 * 10) / 10 : 0;

      let longestStatic = 0;
      let staticFrom = 0;
      const marks = [...new Set([0, ...changes, runtime])].sort((a, b) => a - b);
      for (let index = 1; index < marks.length; index += 1) {
        const gap = marks[index] - marks[index - 1];
        if (gap > longestStatic) {
          longestStatic = gap;
          staticFrom = marks[index - 1];
        }
      }
      longestStatic = Math.round(longestStatic * 100) / 100;

      const hookChanges = changes.filter((at) => at > 0.05 && at <= profile.hookSeconds).length;
      const isVertical = timeline.height > timeline.width;
      const aspect = Math.round((timeline.width / timeline.height) * 1000) / 1000;

      const findings: Finding[] = [];

      if (profile.vertical && !isVertical) {
        findings.push({
          severity: "blocker",
          area: "format",
          detail: `${timeline.width}x${timeline.height} is landscape. ${profile.label} is a vertical feed; this will be letterboxed or cropped.`,
        });
      }
      if (profile.vertical && isVertical && Math.abs(aspect - 0.5625) > 0.02) {
        findings.push({
          severity: "warning",
          area: "format",
          detail: `Aspect is ${aspect}, not the 0.5625 that 9:16 gives. Expect padding on ${profile.label}.`,
        });
      }
      if (timeline.durationSeconds - runtime > 0.5) {
        findings.push({
          severity: "blocker",
          area: "duration",
          detail: `The sequence runs to ${timeline.durationSeconds}s but content stops at ${Math.round(runtime * 100) / 100}s, so an unbounded export ends with ${Math.round((timeline.durationSeconds - runtime) * 100) / 100}s of black. Set an in and out range and export with range in_to_out.`,
        });
      }
      if (profile.maxDurationSeconds && runtime > profile.maxDurationSeconds) {
        findings.push({
          severity: "blocker",
          area: "duration",
          detail: `${Math.round(runtime)}s exceeds the ${profile.maxDurationSeconds}s ${profile.label} limit.`,
        });
      }
      if (hookChanges === 0) {
        findings.push({
          severity: "warning",
          area: "hook",
          detail: `Nothing changes on screen in the first ${profile.hookSeconds}s. That window is what decides whether a viewer stays, so give it a cut, a reframe or a title.`,
        });
      }
      if (longestStatic > profile.maxStaticSeconds) {
        findings.push({
          severity: longestStatic > profile.maxStaticSeconds * 2 ? "warning" : "note",
          area: "pacing",
          detail: `The picture holds for ${longestStatic}s from ${Math.round(staticFrom * 100) / 100}s without a change. Short form norms want something new every ${profile.maxStaticSeconds}s.`,
        });
      }
      if (cutsPerMinute < profile.cutsPerMinute[0] && runtime > 5) {
        findings.push({
          severity: "note",
          area: "pacing",
          detail: `${cutsPerMinute} cuts per minute sits below the ${profile.cutsPerMinute[0]} to ${profile.cutsPerMinute[1]} band typical of ${profile.label}.`,
        });
      }
      if (timeline.graphicClips === 0) {
        findings.push({
          severity: "warning",
          area: "silent viewing",
          detail: `No titles, captions or graphics found. Most short form is watched muted, so anything carried only by audio will not land.`,
        });
      }
      if (timeline.audioClips === 0) {
        findings.push({
          severity: "warning",
          area: "audio",
          detail: "No audible audio clips. Silence reads as a broken post on a feed.",
        });
      }

      const blockers = findings.filter((item) => item.severity === "blocker").length;
      const warnings = findings.filter((item) => item.severity === "warning").length;

      return {
        sequence: timeline.name,
        judgedAgainst: profile.label,
        format: {
          resolution: `${timeline.width}x${timeline.height}`,
          aspect,
          vertical: isVertical,
          fps: timeline.fps,
          runtimeSeconds: Math.round(runtime * 100) / 100,
          sequenceDurationSeconds: timeline.durationSeconds,
        },
        pacing: {
          visualChanges: changes.length,
          cutsPerMinute,
          longestStaticSeconds: longestStatic,
          longestStaticFromSeconds: Math.round(staticFrom * 100) / 100,
          changesInHook: hookChanges,
          transitions: timeline.transitions,
        },
        content: {
          videoClips: timeline.videoClips,
          mainTrackClips: timeline.mainTrackClips,
          audibleAudioClips: timeline.audioClips,
          titlesOrGraphics: timeline.graphicClips,
        },
        findings,
        readyToPost: blockers === 0,
        verdict:
          blockers > 0
            ? `Not ready: ${blockers} blocker${blockers === 1 ? "" : "s"} and ${warnings} warning${warnings === 1 ? "" : "s"}.`
            : warnings > 0
              ? `Postable, but ${warnings} thing${warnings === 1 ? "" : "s"} would cost you reach.`
              : `Nothing found against ${profile.label} norms. Still look at the frames before posting.`,
        note: "This reads the timeline only. It cannot see composition or whether a shot is interesting; use review_sequence and read the stills for that, and analyse_loudness for level.",
      };
    },
  },
]);

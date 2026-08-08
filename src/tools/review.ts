import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { LUMETRI_PROPERTY, WARP_PROPERTY } from "../premiere/constants.js";
import { defineTools } from "./types.js";

export const reviewTools = defineTools([
  {
    name: "check_edit",
    description:
      "Inspect the whole sequence and report the problems that quietly ruin an edit: clips scaled above 100 percent, stabilisers that were never analysed, audio above unity or with keyframes that spike, disabled clips, gaps on the main video track, muted tracks, and clips missing a grade while their neighbours have one. Read only, so it is always safe to run.",
    schema: {
      max_scale: z.number().positive().default(100).describe("Flag clips scaled above this percent"),
      max_audio_db: z.number().default(0).describe("Flag audio louder than this, in dB"),
    },
    handler: async ({ max_scale = 100, max_audio_db = 0 }: { max_scale?: number; max_audio_db?: number }) =>
      evaluate(
        `
        var seq = __seq();
        if (!seq) return __error("No active sequence");

        var maxLevel = Math.pow(10, ${max_audio_db} / 20);
        var report = {
          sequence: String(seq.name),
          upscaledClips: [],
          unsolvedStabilisers: [],
          hotAudio: [],
          disabledClips: [],
          gaps: [],
          mutedTracks: [],
          gradeCoverage: { graded: 0, ungraded: 0, ungradedClips: [] }
        };

        function peakLevel(prop) {
          var peak = prop.getValue();
          var varying = false;
          try { varying = prop.isTimeVarying(); } catch (e) { varying = false; }
          if (!varying) return peak;
          var keys = null;
          try { keys = prop.getKeys(); } catch (e2) { keys = null; }
          if (!keys) return peak;
          for (var k = 0; k < keys.length; k++) {
            var value = prop.getValueAtKey(keys[k]);
            if (value > peak) peak = value;
          }
          return peak;
        }

        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
          var vTrack = seq.videoTracks[t];
          if (vTrack.isMuted()) report.mutedTracks.push({ type: "video", index: t, name: String(vTrack.name) });

          for (var c = 0; c < vTrack.clips.numItems; c++) {
            var clip = vTrack.clips[c];
            var label = { nodeId: String(clip.nodeId), name: String(clip.name), track: t, start: clip.start.seconds };

            if (clip.disabled) report.disabledClips.push(label);

            var motion = __component(clip, "Motion");
            if (motion) {
              var scaleProp = __property(motion, "Scale");
              if (scaleProp && scaleProp.getValue() > ${max_scale}) {
                report.upscaledClips.push({
                  nodeId: label.nodeId, name: label.name, track: t, scale: scaleProp.getValue()
                });
              }
            }

            var warp = __component(clip, "Warp Stabilizer");
            if (warp) {
              var warpLabel = String(warp.properties[${WARP_PROPERTY.autoScale}].displayName);
              if (warpLabel.indexOf("%") === -1) {
                report.unsolvedStabilisers.push({ nodeId: label.nodeId, name: label.name, track: t });
              }
            }

            var lumetri = __component(clip, "Lumetri Color");
            if (lumetri) {
              report.gradeCoverage.graded++;
            } else {
              report.gradeCoverage.ungraded++;
              report.gradeCoverage.ungradedClips.push(label);
            }
          }
        }

        for (var a = 0; a < seq.audioTracks.numTracks; a++) {
          var aTrack = seq.audioTracks[a];
          if (aTrack.isMuted()) report.mutedTracks.push({ type: "audio", index: a, name: String(aTrack.name) });

          for (var ac = 0; ac < aTrack.clips.numItems; ac++) {
            var aClip = aTrack.clips[ac];
            var volume = __component(aClip, "Volume");
            if (!volume) continue;
            var level = __property(volume, "Level");
            if (!level) continue;
            var peak = peakLevel(level);
            if (peak > maxLevel) {
              report.hotAudio.push({
                nodeId: String(aClip.nodeId),
                name: String(aClip.name),
                track: a,
                peakDb: Math.round((20 * (Math.log(peak) / Math.LN10)) * 100) / 100
              });
            }
          }
        }

        var mainTrack = seq.videoTracks[0];
        var cursor = 0;
        for (var g = 0; g < mainTrack.clips.numItems; g++) {
          var current = mainTrack.clips[g];
          if (current.start.seconds - cursor > 0.04) {
            report.gaps.push({ fromSeconds: cursor, toSeconds: current.start.seconds });
          }
          cursor = current.end.seconds;
        }

        report.summary = {
          upscaled: report.upscaledClips.length,
          unsolvedStabilisers: report.unsolvedStabilisers.length,
          hotAudio: report.hotAudio.length,
          disabled: report.disabledClips.length,
          gaps: report.gaps.length,
          mutedTracks: report.mutedTracks.length,
          ungraded: report.gradeCoverage.ungraded
        };
        report.clean =
          report.summary.upscaled === 0 &&
          report.summary.unsolvedStabilisers === 0 &&
          report.summary.hotAudio === 0 &&
          report.summary.gaps === 0;

        return __result(report);
      `,
        { timeoutMs: 120_000 },
      ),
  },
]);

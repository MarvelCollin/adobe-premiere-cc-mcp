import { z } from "zod";
import { measureDialogue, planDialogueChain, type DialogueMeasurement } from "../analysis/dialogue.js";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import {
  COMPRESSOR_PROPERTY,
  EQ_PROPERTY,
  compressorAttackToNormalised,
  compressorGainToNormalised,
  compressorRatioToNormalised,
  compressorReleaseToNormalised,
  compressorThresholdToNormalised,
  eqFrequencyToNormalised,
  normalisedToCompressorGain,
  normalisedToCompressorRatio,
  normalisedToCompressorThreshold,
  normalisedToEqFrequency,
} from "../premiere/audio-params.js";
import { renderIsolatedAudio } from "../premiere/isolate.js";
import { defineTools } from "./types.js";

interface TrackClip {
  nodeId: string;
  name: string;
  start: number;
  end: number;
  hasEq: boolean;
  hasCompressor: boolean;
}

interface AppliedClip {
  nodeId: string;
  ok: boolean;
  error?: string;
  name?: string;
  addedEq?: boolean;
  addedCompressor?: boolean;
  highPassEnable?: number;
  highPassFrequency?: number;
  threshold?: number;
  ratio?: number;
  attack?: number;
  release?: number;
  gain?: number;
}

function movement(before: number, after: number): number {
  return Math.round((after - before) * 100) / 100;
}

export const dialogueTools = defineTools([
  {
    name: "clean_dialogue",
    description:
      "Put the standard dialogue chain on a voice track and prove it did something: a high pass to kill rumble, then compression to even out the level. Measures the track on its own first, sets the compressor threshold from the level that track actually reaches rather than from a guessed number, then measures again and reports how far the rumble, the crest factor and the level really moved. Premiere hands scripting these effect parameters as bare 0 to 1 numbers with no units anywhere; the conversions here were worked out from the defaults Premiere ships and then checked against rendered audio, which is why this sets frequencies in Hz and thresholds in dB instead of asking you for a fraction. Reuses a Parametric Equalizer or Single-band Compressor already on a clip rather than stacking a second one, so running it twice is safe. Worth knowing before the first run: nothing can remove an effect from a script on this host, so the two components stay on the clips once added, and undoing means Effect Controls in the UI. No de-esser: that mapping is not pinned down yet and guessing at it would be worse than leaving it out.",
    schema: {
      track_index: z.number().int().min(0).describe("Zero based audio track holding the voice, so A1 is 0"),
      high_pass_hz: z
        .number()
        .min(20)
        .max(500)
        .default(80)
        .describe("Everything below this is rumble, handling noise and traffic. 80 is the usual place for speech"),
      ratio: z.number().min(1).max(30).default(3).describe("Compression ratio. 3 to 4 evens out a read without pumping"),
      threshold_db: z
        .number()
        .min(-60)
        .max(0)
        .optional()
        .describe("Override the threshold. Left out, it is set 10 dB under the level this track actually peaks at"),
      attack_ms: z.number().min(0).max(500).default(10).describe("How fast the compressor grabs a peak"),
      release_ms: z.number().min(0).max(5000).default(100).describe("How fast it lets go again"),
      compress: z.boolean().default(true).describe("Set false to high pass only and leave the dynamics alone"),
      dry_run: z.boolean().default(false).describe("Measure and plan the chain without touching any clip"),
      timeout_ms: z.number().int().positive().default(900_000),
    },
    handler: async ({
      track_index,
      high_pass_hz = 80,
      ratio = 3,
      threshold_db,
      attack_ms = 10,
      release_ms = 100,
      compress = true,
      dry_run = false,
      timeout_ms = 900_000,
    }: {
      track_index: number;
      high_pass_hz?: number;
      ratio?: number;
      threshold_db?: number;
      attack_ms?: number;
      release_ms?: number;
      compress?: boolean;
      dry_run?: boolean;
      timeout_ms?: number;
    }) => {
      const layout = await evaluate<{ trackName: string; muted: boolean; clips: TrackClip[] }>(`
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var tracks = seq.audioTracks;
        if (${track_index} >= tracks.numTracks) {
          return __error("No audio track at index ${track_index}; the sequence has " + tracks.numTracks);
        }
        var track = tracks[${track_index}];
        var clips = [];
        for (var c = 0; c < track.clips.numItems; c++) {
          var clip = track.clips[c];
          var names = __componentNames(clip);
          var hasEq = false;
          var hasCompressor = false;
          for (var n = 0; n < names.length; n++) {
            if (names[n] === "Parametric Equalizer") hasEq = true;
            if (names[n] === "Single-band Compressor") hasCompressor = true;
          }
          clips.push({
            nodeId: String(clip.nodeId),
            name: String(clip.name),
            start: clip.start.seconds,
            end: clip.end.seconds,
            hasEq: hasEq,
            hasCompressor: hasCompressor
          });
        }
        return __result({ trackName: String(track.name), muted: track.isMuted(), clips: clips });
      `);

      if (layout.clips.length === 0) {
        return {
          applied: false,
          reason: `Audio track ${track_index} ("${layout.trackName}") holds no clips.`,
        };
      }

      const first = await renderIsolatedAudio([track_index], timeout_ms, "dialogue-before");
      const before = measureDialogue(first.audio, high_pass_hz);

      if (!before.measurable) {
        return {
          applied: false,
          reason: before.reason,
          track: { index: track_index, name: layout.trackName, clips: layout.clips.length },
          measured: before,
        };
      }

      const plan = planDialogueChain(before, {
        highPassHz: high_pass_hz,
        ratio,
        attackMs: attack_ms,
        releaseMs: release_ms,
        thresholdDb: threshold_db,
      });

      const normalised = {
        highPassFrequency: eqFrequencyToNormalised(plan.highPassHz),
        threshold: compressorThresholdToNormalised(plan.thresholdDb),
        ratio: compressorRatioToNormalised(plan.ratio),
        attack: compressorAttackToNormalised(plan.attackMs),
        release: compressorReleaseToNormalised(plan.releaseMs),
        gain: compressorGainToNormalised(plan.makeupDb),
      };

      if (dry_run) {
        return {
          applied: false,
          reason: "Dry run: measured and planned, no clip touched.",
          track: { index: track_index, name: layout.trackName, clips: layout.clips.length },
          measured: before,
          plan,
          hostValues: normalised,
        };
      }

      const written = await evaluate<{ clips: AppliedClip[] }>(
        `
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var track = seq.audioTracks[${track_index}];
        var wanted = [${layout.clips.map((clip) => `"${esc(clip.nodeId)}"`).join(",")}];
        var out = [];

        for (var w = 0; w < wanted.length; w++) {
          var found = __findClip(wanted[w]);
          if (!found) { out.push({ nodeId: wanted[w], ok: false, error: "Clip not found" }); continue; }
          var clip = found.clip;
          var qeClip = __qeClipAt(__qeTrackFor(found), clip.start.seconds);
          if (!qeClip) { out.push({ nodeId: wanted[w], ok: false, error: "Could not resolve the QE clip" }); continue; }

          var eq = null;
          var comp = null;
          for (var i = 0; i < clip.components.numItems; i++) {
            var name = String(clip.components[i].displayName);
            if (name === "Parametric Equalizer") eq = clip.components[i];
            if (name === "Single-band Compressor") comp = clip.components[i];
          }

          var addedEq = false;
          if (!eq) {
            var eqFx = qe.project.getAudioEffectByName("Parametric Equalizer");
            if (!eqFx || String(eqFx.name).length === 0) {
              out.push({ nodeId: wanted[w], ok: false, error: "This build has no Parametric Equalizer" });
              continue;
            }
            qeClip.addAudioEffect(eqFx);
            for (var e = 0; e < clip.components.numItems; e++) {
              if (String(clip.components[e].displayName) === "Parametric Equalizer") eq = clip.components[e];
            }
            addedEq = true;
          }
          if (!eq) { out.push({ nodeId: wanted[w], ok: false, error: "Parametric Equalizer did not attach" }); continue; }

          eq.properties[${EQ_PROPERTY.highPassEnable}].setValue(1, true);
          eq.properties[${EQ_PROPERTY.highPassFrequency}].setValue(${normalised.highPassFrequency}, true);
          eq.properties[${EQ_PROPERTY.bypass}].setValue(0, true);

          var addedCompressor = false;
          if (${compress}) {
            if (!comp) {
              var compFx = qe.project.getAudioEffectByName("Single-band Compressor");
              if (!compFx || String(compFx.name).length === 0) {
                out.push({ nodeId: wanted[w], ok: false, error: "This build has no Single-band Compressor" });
                continue;
              }
              qeClip.addAudioEffect(compFx);
              for (var s = 0; s < clip.components.numItems; s++) {
                if (String(clip.components[s].displayName) === "Single-band Compressor") comp = clip.components[s];
              }
              addedCompressor = true;
            }
            if (!comp) { out.push({ nodeId: wanted[w], ok: false, error: "Single-band Compressor did not attach" }); continue; }

            comp.properties[${COMPRESSOR_PROPERTY.threshold}].setValue(${normalised.threshold}, true);
            comp.properties[${COMPRESSOR_PROPERTY.ratio}].setValue(${normalised.ratio}, true);
            comp.properties[${COMPRESSOR_PROPERTY.attack}].setValue(${normalised.attack}, true);
            comp.properties[${COMPRESSOR_PROPERTY.release}].setValue(${normalised.release}, true);
            comp.properties[${COMPRESSOR_PROPERTY.gain}].setValue(${normalised.gain}, true);
            comp.properties[${COMPRESSOR_PROPERTY.autoMakeupGain}].setValue(0, true);
          }

          out.push({
            nodeId: wanted[w],
            ok: true,
            name: String(clip.name),
            addedEq: addedEq,
            addedCompressor: addedCompressor,
            highPassEnable: eq.properties[${EQ_PROPERTY.highPassEnable}].getValue(),
            highPassFrequency: eq.properties[${EQ_PROPERTY.highPassFrequency}].getValue(),
            threshold: comp ? comp.properties[${COMPRESSOR_PROPERTY.threshold}].getValue() : null,
            ratio: comp ? comp.properties[${COMPRESSOR_PROPERTY.ratio}].getValue() : null,
            attack: comp ? comp.properties[${COMPRESSOR_PROPERTY.attack}].getValue() : null,
            release: comp ? comp.properties[${COMPRESSOR_PROPERTY.release}].getValue() : null,
            gain: comp ? comp.properties[${COMPRESSOR_PROPERTY.gain}].getValue() : null
          });
        }

        return __result({ clips: out });
      `,
        { timeoutMs: 300_000 },
      );

      const clipReport = written.clips.map((clip) => {
        if (!clip.ok) return { nodeId: clip.nodeId, applied: false, error: clip.error };
        const frequencyHz = Math.round(normalisedToEqFrequency(clip.highPassFrequency ?? 0));
        return {
          nodeId: clip.nodeId,
          name: clip.name,
          applied: true,
          addedEq: clip.addedEq,
          addedCompressor: clip.addedCompressor,
          highPassOn: clip.highPassEnable === 1,
          highPassHz: frequencyHz,
          thresholdDb:
            clip.threshold === null || clip.threshold === undefined
              ? null
              : Math.round(normalisedToCompressorThreshold(clip.threshold) * 100) / 100,
          ratio:
            clip.ratio === null || clip.ratio === undefined
              ? null
              : Math.round(normalisedToCompressorRatio(clip.ratio) * 100) / 100,
          makeupDb:
            clip.gain === null || clip.gain === undefined
              ? null
              : Math.round(normalisedToCompressorGain(clip.gain) * 100) / 100,
          matchesPlan:
            clip.highPassEnable === 1 &&
            Math.abs(frequencyHz - plan.highPassHz) <= 2 &&
            (!compress ||
              (clip.threshold !== null &&
                clip.threshold !== undefined &&
                Math.abs(normalisedToCompressorThreshold(clip.threshold) - plan.thresholdDb) <= 0.5)),
        };
      });

      const second = await renderIsolatedAudio([track_index], timeout_ms, "dialogue-after");
      const after: DialogueMeasurement = measureDialogue(second.audio, high_pass_hz);

      const rumbleMoved = movement(before.rumbleDb, after.rumbleDb);
      const crestMoved = movement(before.crestDb, after.crestDb);
      const spreadMoved = movement(before.levelSpreadDb, after.levelSpreadDb);
      const loudMoved = movement(before.loudDb, after.loudDb);
      const floorMoved = movement(before.floorDb, after.floorDb);

      const gainReductionDb = compress ? Math.round((plan.makeupDb - loudMoved) * 100) / 100 : 0;
      const reused = written.clips.filter(
        (clip) => clip.ok && (clip.addedEq === false || (compress && clip.addedCompressor === false)),
      ).length;
      const misapplied = clipReport.filter((clip) => clip.applied !== true || clip.matchesPlan !== true);
      const findings: string[] = [];

      if (rumbleMoved < -1) {
        findings.push(
          `Rumble below ${high_pass_hz} Hz fell ${Math.abs(rumbleMoved)} dB, from ${before.rumbleDb} dB of the total to ${after.rumbleDb} dB.`,
        );
      } else {
        findings.push(
          `The high pass barely moved the low end: ${before.rumbleDb} dB before, ${after.rumbleDb} dB after. Either there was no rumble to remove, or ${high_pass_hz} Hz is below where the noise actually sits.`,
        );
      }

      if (compress) {
        if (spreadMoved < -0.5) {
          findings.push(
            `The gap between the loud and quiet stretches narrowed ${Math.abs(spreadMoved)} dB, from ${before.levelSpreadDb} to ${after.levelSpreadDb} dB, on ${gainReductionDb} dB of average gain reduction. That is the compressor levelling rather than just turning things down.`,
          );
        } else if (gainReductionDb < 0.5) {
          findings.push(
            `The compressor never engaged: the level moved by the ${plan.makeupDb} dB of makeup and nothing else. Threshold ${plan.thresholdDb} dB is above anything this track reaches. Lower threshold_db or raise the ratio.`,
          );
        } else {
          findings.push(
            `The compressor pulled back ${gainReductionDb} dB on average but the gap between the loud and quiet stretches did not narrow, going from ${before.levelSpreadDb} to ${after.levelSpreadDb} dB. That is near constant reduction rather than levelling, which happens when the threshold sits under the sustained level of the track instead of only under its peaks. Raise threshold_db, or lengthen release_ms so the compressor is not riding every syllable.`,
          );
        }
      }

      return {
        applied: misapplied.length === 0,
        track: { index: track_index, name: layout.trackName, clips: layout.clips.length },
        plan,
        hostValues: normalised,
        clips: clipReport,
        before,
        after,
        change: {
          rumbleDb: rumbleMoved,
          levelSpreadDb: spreadMoved,
          crestDb: crestMoved,
          loudDb: loudMoved,
          noiseFloorDb: floorMoved,
          averageGainReductionDb: gainReductionDb,
        },
        findings,
        warnings: [
          layout.muted ? `Audio track ${track_index} ("${layout.trackName}") is muted, so none of this reaches the mix.` : null,
          first.mutesRestored && second.mutesRestored
            ? null
            : "Track mute states did not come back exactly as they were; check the audio tracks.",
          reused > 0
            ? `${reused} clip(s) already carried a Parametric Equalizer or Single-band Compressor. Those were reused and reconfigured rather than stacked, so nothing doubled up, but two things follow: any settings you had on them are gone, and the before measurement was taken with that earlier chain already running. The change figures below are against the processed track, not against the raw one.`
            : null,
          floorMoved > 1
            ? `The noise floor rose ${floorMoved} dB. Makeup gain lifts the room tone along with the voice; drop the ratio or the makeup if the background is now audible.`
            : null,
        ].filter((warning): warning is string => warning !== null),
        verdict:
          misapplied.length > 0
            ? `${misapplied.length} of ${clipReport.length} clip(s) did not take the chain: ${misapplied
                .map((clip) => clip.name ?? clip.nodeId)
                .join(", ")}.`
            : `Chain on ${clipReport.length} clip(s) of "${layout.trackName}". ${findings.join(" ")}`,
      };
    },
  },
]);

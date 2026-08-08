import { z } from "zod";
import { LEVEL_WINDOW_SECONDS, findAudioFaults } from "../analysis/audio-faults.js";
import {
  clipIsDucked,
  duckEnvelope,
  duckFactor,
  duckWindows,
  findDuckTriggers,
  planClipKeys,
  probesForClip,
  type ClipSpan,
  type PlannedKey,
  type Probe,
} from "../analysis/ducking.js";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { renderIsolatedAudio } from "../premiere/isolate.js";
import { defineTools } from "./types.js";

interface MusicClip {
  nodeId: string;
  name: string;
  start: number;
  end: number;
  inPoint: number;
  speed: number | null;
  hasLevel: boolean;
  keyframed: boolean;
  keyTimes: number[];
  levelDb: number | null;
}

interface Layout {
  audioTrackCount: number;
  mutes: boolean[];
  musicTrack: { index: number; name: string; muted: boolean };
  dialogueTracks: { index: number; name: string; muted: boolean; clipCount: number }[];
  clips: MusicClip[];
}

interface AppliedClip {
  nodeId: string;
  ok: boolean;
  error?: string;
  name?: string;
  clearedKeys?: number;
  keyCount?: number;
  bases?: number[];
  written?: number[];
  probeBases?: number[];
  probed?: number[];
}

interface ProbeReport {
  kind: Probe["kind"];
  atSeconds: number;
  expectedDb: number | null;
  measuredDb: number | null;
  offByDb: number | null;
}

interface ClipReport {
  nodeId: string;
  name: string;
  verified: boolean;
  probes: ProbeReport[];
  error?: string;
  levelDb?: number | null;
  replacedKeyframes?: number;
  keyframesWritten?: number;
  keyframesLive?: number;
  worstKeyErrorDb?: number;
  measuredDuckDepthDb?: number | null;
}

const MAX_KEYS = 1500;
const RELATIVE_TOLERANCE = 0.02;

function toDb(level: number): number | null {
  return level > 0 ? Math.round(20 * Math.log10(level) * 100) / 100 : null;
}

function numberList(values: number[]): string {
  return values.map((value) => (Number.isFinite(value) ? String(value) : "0")).join(",");
}

function planLiteral(entries: { clip: MusicClip; keys: PlannedKey[]; probes: Probe[] }[]): string {
  return entries
    .map((entry) => {
      const keys = entry.keys.map((key) => `[${key.sourceSeconds},${key.factor}]`).join(",");
      const probes = entry.probes.map((probe) => `[${probe.sourceSeconds},${probe.factor}]`).join(",");
      return `{nodeId:"${esc(entry.clip.nodeId)}",keys:[${keys}],probes:[${probes}]}`;
    })
    .join(",");
}

export const duckingTools = defineTools([
  {
    name: "duck_music",
    description:
      "Pull a music bed down under the talking and let it back up in the gaps, the way a mixer rides a fader, instead of leaving one flat level for the whole timeline. Isolates the dialogue track by muting every other audio track for a single measurement render, so what triggers the duck is genuinely what is on that track and not the music itself; if music also sits on the dialogue track, the duck will follow that too. Refuses to guess when the isolated track is too flat to separate talking from background. Writes a keyframe envelope on each music clip, multiplying whatever level or fade was already there rather than flattening it, then reads the envelope back and reports the level it actually measures under speech and in the gaps.",
    schema: {
      music_track_index: z.number().int().min(0).describe("Zero based audio track holding the music bed, so A1 is 0"),
      dialogue_track_indexes: z
        .array(z.number().int().min(0))
        .min(1)
        .describe("Zero based audio tracks holding the voice; everything else is muted while measuring"),
      duck_db: z
        .number()
        .max(0)
        .default(-12)
        .describe("How far the bed drops under speech, relative to its own level. -12 is a normal broadcast duck"),
      attack_seconds: z.number().min(0).max(5).default(0.25).describe("How long the bed takes to get out of the way"),
      hold_seconds: z
        .number()
        .min(0)
        .max(10)
        .default(0.3)
        .describe("Stay down this long after a line ends, so the bed does not surge between words"),
      release_seconds: z.number().min(0).max(10).default(0.6).describe("How long the bed takes to come back up"),
      on_existing_keyframes: z
        .enum(["multiply", "replace"])
        .default("multiply")
        .describe(
          "'multiply' rides the duck on top of a fade already on the clip and keeps it. 'replace' rebuilds from the clip's loudest keyframe, which loses the fade but makes a second run land in the same place instead of ducking twice",
        ),
      dry_run: z.boolean().default(false).describe("Measure and plan the envelope without writing any keyframes"),
      timeout_ms: z.number().int().positive().default(900_000),
    },
    handler: async ({
      music_track_index,
      dialogue_track_indexes,
      duck_db = -12,
      attack_seconds = 0.25,
      hold_seconds = 0.3,
      release_seconds = 0.6,
      on_existing_keyframes = "multiply",
      dry_run = false,
      timeout_ms = 900_000,
    }: {
      music_track_index: number;
      dialogue_track_indexes: number[];
      duck_db?: number;
      attack_seconds?: number;
      hold_seconds?: number;
      release_seconds?: number;
      on_existing_keyframes?: "multiply" | "replace";
      dry_run?: boolean;
      timeout_ms?: number;
    }) => {
      const dialogue = Array.from(new Set(dialogue_track_indexes)).sort((a, b) => a - b);
      if (dialogue.includes(music_track_index)) {
        throw new Error(
          `Track ${music_track_index} is named as both the music bed and the dialogue. Ducking a track against itself would only fight its own level; put the bed on its own track first.`,
        );
      }

      const layout = await evaluate<Layout>(`
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var tracks = seq.audioTracks;
        var musicIndex = ${music_track_index};
        var dialogue = [${numberList(dialogue)}];
        if (musicIndex >= tracks.numTracks) {
          return __error("No audio track at index " + musicIndex + "; the sequence has " + tracks.numTracks);
        }
        for (var d = 0; d < dialogue.length; d++) {
          if (dialogue[d] >= tracks.numTracks) {
            return __error("No audio track at index " + dialogue[d] + "; the sequence has " + tracks.numTracks);
          }
        }

        var mutes = [];
        for (var t = 0; t < tracks.numTracks; t++) mutes.push(tracks[t].isMuted());

        var dialogueTracks = [];
        for (var d2 = 0; d2 < dialogue.length; d2++) {
          var dt = tracks[dialogue[d2]];
          dialogueTracks.push({
            index: dialogue[d2],
            name: String(dt.name),
            muted: dt.isMuted(),
            clipCount: dt.clips.numItems
          });
        }

        var music = tracks[musicIndex];
        var clips = [];
        for (var c = 0; c < music.clips.numItems; c++) {
          var clip = music.clips[c];
          var speed = null;
          try { speed = clip.getSpeed(); } catch (speedError) { speed = null; }

          var volume = __component(clip, "Volume");
          var level = volume ? __property(volume, "Level") : null;
          var varying = false;
          var keyTimes = [];
          var levelValue = null;
          if (level) {
            try { levelValue = level.getValue(); } catch (valueError) { levelValue = null; }
            try { varying = level.isTimeVarying(); } catch (varyError) { varying = false; }
            if (varying) {
              var keys = null;
              try { keys = level.getKeys(); } catch (keyError) { keys = null; }
              if (keys) {
                for (var k = 0; k < keys.length; k++) {
                  var entry = keys[k];
                  var seconds = (entry && typeof entry.seconds === "number") ? Number(entry.seconds) : Number(entry);
                  if (seconds === seconds) keyTimes.push(seconds);
                }
              }
            }
          }

          clips.push({
            nodeId: String(clip.nodeId),
            name: String(clip.name),
            start: clip.start.seconds,
            end: clip.end.seconds,
            inPoint: clip.inPoint.seconds,
            speed: speed,
            hasLevel: level ? true : false,
            keyframed: varying,
            keyTimes: keyTimes,
            levelDb: (levelValue !== null && levelValue > 0)
              ? Math.round((20 * (Math.log(levelValue) / Math.LN10)) * 100) / 100
              : null
          });
        }

        return __result({
          audioTrackCount: tracks.numTracks,
          mutes: mutes,
          musicTrack: { index: musicIndex, name: String(music.name), muted: music.isMuted() },
          dialogueTracks: dialogueTracks,
          clips: clips
        });
      `);

      if (layout.clips.length === 0) {
        return {
          applied: false,
          reason: `Audio track ${music_track_index} ("${layout.musicTrack.name}") holds no clips, so there is no bed to duck.`,
        };
      }
      const silentDialogue = layout.dialogueTracks.filter((track) => track.clipCount === 0);
      if (silentDialogue.length === layout.dialogueTracks.length) {
        return {
          applied: false,
          reason: `The dialogue track${layout.dialogueTracks.length > 1 ? "s" : ""} ${layout.dialogueTracks
            .map((track) => `${track.index} ("${track.name}")`)
            .join(", ")} hold no clips, so there is nothing that could trigger a duck.`,
        };
      }

      const isolated = await renderIsolatedAudio(dialogue, timeout_ms, "duck");
      const mutesRestored = isolated.mutesRestored;
      const durationSeconds = isolated.durationSeconds;
      const detection = findDuckTriggers(findAudioFaults(isolated.audio).windows, LEVEL_WINDOW_SECONDS);

      const measurement = {
        isolatedTracks: dialogue,
        isolatedDurationSeconds: durationSeconds,
        noiseFloorDb: detection.floorDb,
        loudDb: detection.loudDb,
        separationDb: detection.separationDb,
        openThresholdDb: detection.openDb,
        closeThresholdDb: detection.closeDb,
        mutesRestored,
      };

      if (!detection.usable || detection.ranges.length === 0) {
        return {
          applied: false,
          reason: detection.reason,
          measurement,
        };
      }

      const shape = {
        attackSeconds: attack_seconds,
        releaseSeconds: release_seconds,
        holdSeconds: hold_seconds,
        duckDb: duck_db,
      };
      const windows = duckWindows(detection.ranges, shape);
      const points = duckEnvelope(windows, duck_db);

      const entries: { clip: MusicClip; keys: PlannedKey[]; probes: Probe[] }[] = [];
      const skipped: { nodeId: string; name: string; reason: string }[] = [];

      for (const clip of layout.clips) {
        if (!clip.hasLevel) {
          skipped.push({ nodeId: clip.nodeId, name: clip.name, reason: "No Volume level to keyframe." });
          continue;
        }
        if (clip.speed !== null && Math.abs(clip.speed - 1) > 0.001) {
          skipped.push({
            nodeId: clip.nodeId,
            name: clip.name,
            reason: `Runs at ${Math.round(clip.speed * 1000) / 10}% speed. Keyframe times are source times, so a speed change breaks the mapping from timeline seconds and the envelope would land in the wrong place.`,
          });
          continue;
        }

        const span: ClipSpan = {
          startSeconds: clip.start,
          endSeconds: clip.end,
          inPointSeconds: clip.inPoint,
        };
        const existing = clip.keyTimes
          .map((sourceSeconds) => clip.start + (sourceSeconds - clip.inPoint))
          .filter((time) => time >= clip.start && time <= clip.end);
        const keys = planClipKeys(points, span, existing);
        if (!clipIsDucked(keys)) {
          skipped.push({
            nodeId: clip.nodeId,
            name: clip.name,
            reason: "No talking overlaps this clip, so its level was left alone.",
          });
          continue;
        }
        entries.push({ clip, keys, probes: probesForClip(windows, span, duck_db) });
      }

      const totalKeys = entries.reduce((count, entry) => count + entry.keys.length, 0);
      const triggerSeconds = detection.ranges.reduce(
        (total, range) => total + (range.toSeconds - range.fromSeconds),
        0,
      );
      const plan = {
        duckDb: duck_db,
        duckFactor: Math.round(duckFactor(duck_db) * 10_000) / 10_000,
        attackSeconds: attack_seconds,
        holdSeconds: hold_seconds,
        releaseSeconds: release_seconds,
        triggerCount: detection.ranges.length,
        triggerSharePercent:
          durationSeconds > 0 ? Math.round((triggerSeconds / durationSeconds) * 1000) / 10 : 0,
        duckWindowCount: windows.length,
        triggers: detection.ranges.slice(0, 30),
        clipsToKeyframe: entries.length,
        keyframesToWrite: totalKeys,
      };

      if (entries.length === 0) {
        return {
          applied: false,
          reason: "Talking was found, but none of it overlaps a clip on the music track.",
          measurement,
          plan,
          skipped,
        };
      }

      if (totalKeys > MAX_KEYS) {
        return {
          applied: false,
          reason: `The envelope would need ${totalKeys} keyframes, past the ${MAX_KEYS} this writes in one pass. Longer hold_seconds and release_seconds merge neighbouring lines into one duck and cut the count sharply.`,
          measurement,
          plan,
          skipped,
        };
      }

      if (dry_run) {
        return {
          applied: false,
          reason: "Dry run: measured and planned, nothing written.",
          measurement,
          plan,
          skipped,
          clips: entries.map((entry) => ({
            nodeId: entry.clip.nodeId,
            name: entry.clip.name,
            levelDb: entry.clip.levelDb,
            existingKeyframes: entry.clip.keyTimes.length,
            keyframes: entry.keys.length,
            envelope: entry.keys.slice(0, 40),
          })),
        };
      }

      const written = await evaluate<{ clips: AppliedClip[] }>(
        `
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var plan = [${planLiteral(entries)}];
        var out = [];

        for (var i = 0; i < plan.length; i++) {
          var entry = plan[i];
          var found = __findClip(entry.nodeId);
          if (!found) { out.push({ nodeId: entry.nodeId, ok: false, error: "Clip not found" }); continue; }
          var clip = found.clip;
          var volume = __component(clip, "Volume");
          if (!volume) { out.push({ nodeId: entry.nodeId, ok: false, error: "Clip has no Volume component" }); continue; }
          var level = __property(volume, "Level");
          if (!level) { out.push({ nodeId: entry.nodeId, ok: false, error: "Volume component has no Level property" }); continue; }

          var varying = false;
          try { varying = level.isTimeVarying(); } catch (varyError) { varying = false; }
          var flat = level.getValue();

          if (varying && ${on_existing_keyframes === "replace"}) {
            var priorKeys = null;
            try { priorKeys = level.getKeys(); } catch (priorError) { priorKeys = null; }
            var peak = 0;
            if (priorKeys) {
              for (var pk = 0; pk < priorKeys.length; pk++) {
                var priorValue = level.getValueAtKey(priorKeys[pk]);
                if (priorValue > peak) peak = priorValue;
              }
            }
            if (peak > 0) flat = peak;
            varying = false;
          }

          if (!(flat > 0)) {
            out.push({ nodeId: entry.nodeId, ok: false, error: "Clip level is at silence, so there is nothing to duck" });
            continue;
          }

          var bases = [];
          for (var k = 0; k < entry.keys.length; k++) {
            var baseValue = flat;
            if (varying) {
              try { baseValue = level.getValueAtTime(entry.keys[k][0]); } catch (baseError) { baseValue = flat; }
            }
            bases.push(baseValue);
          }
          var probeBases = [];
          for (var p = 0; p < entry.probes.length; p++) {
            var probeValue = flat;
            if (varying) {
              try { probeValue = level.getValueAtTime(entry.probes[p][0]); } catch (probeError) { probeValue = flat; }
            }
            probeBases.push(probeValue);
          }

          var cleared = __clearKeys(level);
          level.setValue(flat, true);
          level.setTimeVarying(true);

          for (var k2 = 0; k2 < entry.keys.length; k2++) {
            var at = entry.keys[k2][0];
            level.addKey(at);
            level.setValueAtKey(at, bases[k2] * entry.keys[k2][1], true);
          }

          var readBack = [];
          for (var k3 = 0; k3 < entry.keys.length; k3++) readBack.push(level.getValueAtTime(entry.keys[k3][0]));
          var probed = [];
          for (var p2 = 0; p2 < entry.probes.length; p2++) probed.push(level.getValueAtTime(entry.probes[p2][0]));

          var keyCount = 0;
          try { var live = level.getKeys(); keyCount = live ? live.length : 0; } catch (countError) { keyCount = 0; }

          out.push({
            nodeId: entry.nodeId,
            ok: true,
            name: String(clip.name),
            clearedKeys: cleared,
            keyCount: keyCount,
            bases: bases,
            written: readBack,
            probeBases: probeBases,
            probed: probed
          });
        }

        return __result({ clips: out });
      `,
        { timeoutMs: 300_000 },
      );

      const report: ClipReport[] = entries.map((entry, index) => {
        const result = written.clips[index];
        if (!result || result.ok !== true) {
          return {
            nodeId: entry.clip.nodeId,
            name: entry.clip.name,
            verified: false,
            error: result?.error ?? "The host returned no result for this clip.",
            probes: [],
          };
        }

        const bases = result.bases ?? [];
        const readBack = result.written ?? [];
        let worstKeyErrorDb = 0;
        for (let key = 0; key < entry.keys.length; key += 1) {
          const expected = (bases[key] ?? 0) * entry.keys[key].factor;
          const actual = readBack[key] ?? 0;
          if (expected <= 0) continue;
          const errorDb = Math.abs(20 * Math.log10(Math.max(actual, 1e-9) / expected));
          if (errorDb > worstKeyErrorDb) worstKeyErrorDb = errorDb;
        }

        const probeBases = result.probeBases ?? [];
        const probed = result.probed ?? [];
        const probeReport = entry.probes.map((probe, at) => {
          const base = probeBases[at] ?? 0;
          const actual = probed[at] ?? 0;
          const expected = base * probe.factor;
          return {
            kind: probe.kind,
            atSeconds: probe.sequenceSeconds,
            expectedDb: toDb(expected),
            measuredDb: toDb(actual),
            offByDb:
              expected > 0 && actual > 0
                ? Math.round(20 * Math.log10(actual / expected) * 100) / 100
                : null,
          };
        });

        const probeOk = probeReport.every(
          (probe) => probe.offByDb !== null && Math.abs(probe.offByDb) <= 0.5,
        );
        const keyOk = worstKeyErrorDb <= Math.abs(20 * Math.log10(1 + RELATIVE_TOLERANCE));

        const loudest = (kind: Probe["kind"]): number | null => {
          const levels = probeReport
            .filter((probe) => probe.kind === kind && probe.measuredDb !== null)
            .map((probe) => probe.measuredDb as number);
          return levels.length === 0 ? null : Math.max(...levels);
        };
        const openLevel = loudest("open");
        const duckedLevel = loudest("ducked");
        const measuredDuckDepthDb =
          openLevel === null || duckedLevel === null ? null : Math.round((duckedLevel - openLevel) * 100) / 100;

        return {
          nodeId: entry.clip.nodeId,
          name: entry.clip.name,
          levelDb: entry.clip.levelDb,
          replacedKeyframes: result.clearedKeys ?? 0,
          keyframesWritten: entry.keys.length,
          keyframesLive: result.keyCount ?? 0,
          verified: keyOk && probeOk && (result.keyCount ?? 0) >= entry.keys.length,
          worstKeyErrorDb: Math.round(worstKeyErrorDb * 100) / 100,
          measuredDuckDepthDb,
          probes: probeReport.slice(0, 12),
        };
      });

      const failed = report.filter((clip) => clip.verified !== true);
      const stacked = report.filter(
        (clip) =>
          clip.measuredDuckDepthDb !== null &&
          clip.measuredDuckDepthDb !== undefined &&
          Math.abs(clip.measuredDuckDepthDb - duck_db) > 1,
      );
      const measuredDepths = report
        .map((clip) => clip.measuredDuckDepthDb)
        .filter((depth): depth is number => depth !== null && depth !== undefined);
      const duckedProbes = report.flatMap((clip) => clip.probes).filter((probe) => probe.kind === "ducked");
      const deepest = duckedProbes.reduce<number | null>(
        (worst, probe) => (probe.offByDb === null ? worst : Math.max(worst ?? 0, Math.abs(probe.offByDb))),
        null,
      );

      return {
        applied: failed.length === 0,
        measurement,
        plan,
        clips: report,
        skipped,
        warnings: [
          layout.musicTrack.muted
            ? `Audio track ${music_track_index} ("${layout.musicTrack.name}") is muted, so the envelope is written but nothing will be heard until you unmute it.`
            : null,
          mutesRestored ? null : "Track mute states did not come back exactly as they were; check the audio tracks.",
          stacked.length > 0
            ? `On ${stacked
                .map((clip) => `${clip.name} (${clip.measuredDuckDepthDb} dB)`)
                .join(", ")} the bed now sits further under its open level than the ${duck_db} dB asked for. That is what a duck laid on top of an earlier duck looks like: pass on_existing_keyframes 'replace' to rebuild from the clip's own level instead of stacking on what was already there.`
            : null,
        ].filter((warning): warning is string => warning !== null),
        verdict:
          failed.length > 0
            ? `Wrote the envelope but ${failed.length} of ${report.length} music clip(s) did not read back as planned: ${failed
                .map((clip) => clip.name)
                .join(", ")}.`
            : stacked.length > 0
              ? `Every keyframe landed where it was planned, but the bed now measures ${stacked
                  .map((clip) => `${clip.measuredDuckDepthDb} dB`)
                  .join(", ")} under its open level instead of the ${duck_db} dB asked for, because the duck went on top of what was already on the clip. Read the warning before treating this as done.`
              : `Bed measures ${measuredDepths.length === 0 ? Math.round(duck_db * 100) / 100 : measuredDepths[0]} dB under its own open level across ${detection.ranges.length} passage(s) of talking on ${report.length} music clip(s), read back to within ${deepest === null ? "0" : deepest} dB of plan.`,
      };
    },
  },
]);

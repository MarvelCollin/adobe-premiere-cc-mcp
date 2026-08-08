import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { detectBeats, subdivide, type BeatAnalysis } from "../analysis/beats.js";
import { decodeWav } from "../analysis/wav.js";
import { EXPORT_RANGES, renderWithFoundPreset, type ExportRange } from "../premiere/encoder.js";
import { defineTools } from "./types.js";

async function analyseSequenceAudio(range: ExportRange, timeoutMs: number): Promise<BeatAnalysis> {
  const wavPath = join(tmpdir(), `premiere-mcp-beats-${Date.now()}.wav`);
  await renderWithFoundPreset("Waveform Audio", wavPath, range, timeoutMs);
  try {
    return detectBeats(decodeWav(readFileSync(wavPath)));
  } finally {
    try {
      rmSync(wavPath, { force: true });
    } catch {
      /* the temp render is disposable */
    }
  }
}

function gridFor(analysis: BeatAnalysis, grid: "downbeats" | "beats" | "eighths"): number[] {
  if (grid === "downbeats") return analysis.downbeatTimes;
  if (grid === "eighths") return subdivide(analysis.beatTimes, 2);
  return analysis.beatTimes;
}

function offsetRange(offset: number, times: number[], duration: number): number[] {
  return times
    .map((time) => Math.round((time + offset) * 1000) / 1000)
    .filter((time) => time >= 0 && time < duration);
}

export const beatTools = defineTools([
  {
    name: "detect_beats",
    description:
      "Find the tempo of the sequence audio and return the beat grid, without changing anything. Renders the mix, measures onset strength across the spectrum, then recovers BPM by autocorrelation and locks the phase to the loudest onsets. Returns beat times, downbeat times and a confidence figure. Low confidence means the music has no steady pulse, or the mix is mostly speech, and the grid should not be trusted for cutting.",
    schema: {
      range: z.enum(EXPORT_RANGES).default("entire").describe("Which part of the sequence to analyse"),
      timeout_ms: z.number().int().positive().default(600_000),
    },
    handler: async ({
      range = "entire",
      timeout_ms = 600_000,
    }: {
      range?: ExportRange;
      timeout_ms?: number;
    }) => {
      const analysis = await analyseSequenceAudio(range, timeout_ms);
      return {
        bpm: analysis.bpm,
        confidence: analysis.confidence,
        reliable: analysis.confidence >= 0.35,
        beatsPerBar: analysis.beatsPerBar,
        beatCount: analysis.beatTimes.length,
        downbeatCount: analysis.downbeatTimes.length,
        durationSeconds: analysis.durationSeconds,
        beatTimes: analysis.beatTimes,
        downbeatTimes: analysis.downbeatTimes,
        hint:
          analysis.confidence >= 0.35
            ? "Cut on downbeats first, then subdivide only where the edit should feel faster."
            : "Confidence is low. Check the music actually has a steady pulse before cutting to this grid.",
      };
    },
  },

  {
    name: "mark_beats",
    description:
      "Write sequence markers on the beat grid so the cuts can be placed by eye or by tool. Choose downbeats for bar level cutting, beats for a steadier rhythm, or eighths where the edit should feel fast. Existing markers created by this tool are cleared first, so running it twice does not stack duplicates.",
    schema: {
      grid: z
        .enum(["downbeats", "beats", "eighths"])
        .default("downbeats")
        .describe("Which level of the grid to mark"),
      offset_seconds: z
        .number()
        .default(0)
        .describe("Shift every marker, useful when the music starts late in the timeline"),
      limit: z.number().int().positive().max(400).default(200),
      range: z.enum(EXPORT_RANGES).default("entire"),
      timeout_ms: z.number().int().positive().default(600_000),
    },
    handler: async ({
      grid = "downbeats",
      offset_seconds = 0,
      limit = 200,
      range = "entire",
      timeout_ms = 600_000,
    }: {
      grid?: "downbeats" | "beats" | "eighths";
      offset_seconds?: number;
      limit?: number;
      range?: ExportRange;
      timeout_ms?: number;
    }) => {
      const analysis = await analyseSequenceAudio(range, timeout_ms);
      const times = offsetRange(offset_seconds, gridFor(analysis, grid), analysis.durationSeconds).slice(
        0,
        limit,
      );

      if (times.length === 0) {
        throw new Error("The grid produced no marker times inside the sequence.");
      }

      const written = await evaluate<{ removed: number; added: number; total: number }>(
        `
        var seq = __seq();
        if (!seq) return __error("No active sequence");

        var removed = 0;
        var marker = seq.markers.getFirstMarker();
        while (marker) {
          var next = seq.markers.getNextMarker(marker);
          if (String(marker.comments) === "mcp-beat") {
            seq.markers.deleteMarker(marker);
            removed++;
          }
          marker = next;
        }

        var times = [${times.join(", ")}];
        var added = 0;
        for (var i = 0; i < times.length; i++) {
          var created = seq.markers.createMarker(times[i]);
          if (!created) continue;
          created.name = "${esc(grid)} " + (i + 1);
          created.comments = "mcp-beat";
          added++;
        }

        var total = 0;
        var walk = seq.markers.getFirstMarker();
        while (walk) { total++; walk = seq.markers.getNextMarker(walk); }

        if (added < times.length) {
          return __error("Only " + added + " of " + times.length + " markers were created");
        }
        return __result({ removed: removed, added: added, total: total });
      `,
        { timeoutMs: 180_000 },
      );

      return {
        bpm: analysis.bpm,
        confidence: analysis.confidence,
        reliable: analysis.confidence >= 0.35,
        grid,
        markersRemoved: written.removed,
        markersAdded: written.added,
        markersOnSequence: written.total,
        firstTimes: times.slice(0, 8),
      };
    },
  },

  {
    name: "cut_to_beats",
    description:
      "Razor a video track on the beat grid, so every cut lands on the music. Only cuts where a clip actually covers the beat, and never twice at the same point, so an existing edit is left alone. Reports how many cuts landed and how many beats were skipped and why. Destructive: run it on a scratch sequence first.",
    schema: {
      track_index: z.number().int().min(0).default(0).describe("Which video track, V1 is 0"),
      grid: z.enum(["downbeats", "beats", "eighths"]).default("downbeats"),
      offset_seconds: z.number().default(0),
      limit: z.number().int().positive().max(200).default(60).describe("Stop after this many cuts"),
      range: z.enum(EXPORT_RANGES).default("entire"),
      timeout_ms: z.number().int().positive().default(600_000),
    },
    handler: async ({
      track_index = 0,
      grid = "downbeats",
      offset_seconds = 0,
      limit = 60,
      range = "entire",
      timeout_ms = 600_000,
    }: {
      track_index?: number;
      grid?: "downbeats" | "beats" | "eighths";
      offset_seconds?: number;
      limit?: number;
      range?: ExportRange;
      timeout_ms?: number;
    }) => {
      const analysis = await analyseSequenceAudio(range, timeout_ms);
      const times = offsetRange(offset_seconds, gridFor(analysis, grid), analysis.durationSeconds).slice(
        0,
        limit,
      );

      if (times.length === 0) {
        throw new Error("The grid produced no cut points inside the sequence.");
      }

      const result = await evaluate(
        `
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        if (${track_index} >= seq.videoTracks.numTracks) {
          return __error("No video track at index ${track_index}");
        }
        var qeSeq = __qe();
        var qeTrack = qeSeq.getVideoTrackAt(${track_index});
        if (typeof qeTrack.razor !== "function") {
          return __error("This Premiere build does not expose razor on the QE track");
        }

        var times = [${times.join(", ")}];
        var cuts = [];
        var skipped = [];

        for (var i = 0; i < times.length; i++) {
          var at = times[i];
          var track = seq.videoTracks[${track_index}];

          var covering = null;
          var onEdge = false;
          for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            if (Math.abs(clip.start.seconds - at) < 0.02 || Math.abs(clip.end.seconds - at) < 0.02) {
              onEdge = true;
              break;
            }
            if (clip.start.seconds < at && clip.end.seconds > at) { covering = clip; break; }
          }

          if (onEdge) { skipped.push({ atSeconds: at, why: "already an edit point" }); continue; }
          if (!covering) { skipped.push({ atSeconds: at, why: "no clip covers this beat" }); continue; }

          var before = track.clips.numItems;
          seq.setPlayerPosition(String(__secondsToTicks(at)));
          qeTrack.razor(String(qeSeq.CTI.timecode));
          var after = seq.videoTracks[${track_index}].clips.numItems;

          if (after > before) {
            cuts.push(at);
          } else {
            skipped.push({ atSeconds: at, why: "razor did not add a clip" });
          }
        }

        return __result({
          cuts: cuts,
          cutCount: cuts.length,
          skipped: skipped,
          clipsOnTrack: seq.videoTracks[${track_index}].clips.numItems
        });
      `,
        { timeoutMs: 300_000 },
      );

      return {
        bpm: analysis.bpm,
        confidence: analysis.confidence,
        reliable: analysis.confidence >= 0.35,
        grid,
        trackIndex: track_index,
        ...(result as object),
      };
    },
  },
]);

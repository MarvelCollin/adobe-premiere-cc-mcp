import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { findAudioFaults } from "../analysis/audio-faults.js";
import { decodeWav } from "../analysis/wav.js";
import { EXPORT_RANGES, renderWithFoundPreset, type ExportRange } from "../premiere/encoder.js";
import { defineTools } from "./types.js";

export const audioCheckTools = defineTools([
  {
    name: "check_audio",
    description:
      "Render the mix and find the audio faults that ruin a delivery: passages clipped into distortion, stretches of dead silence, and a noise floor high enough to hear. Also reports where the audio is active, meaning above its own noise floor, and what share of the running time that covers. Note this measures content rather than speech specifically: music counts as active too, so to find dialogue for a duck, measure the dialogue range on its own. Distortion cannot be undone later, so this is worth running before any loudness work rather than after.",
    schema: {
      range: z.enum(EXPORT_RANGES).default("entire").describe("Which part of the sequence to inspect"),
      timeout_ms: z.number().int().positive().default(600_000),
    },
    handler: async ({
      range = "entire",
      timeout_ms = 600_000,
    }: {
      range?: ExportRange;
      timeout_ms?: number;
    }) => {
      const wavPath = join(tmpdir(), `premiere-mcp-audiocheck-${Date.now()}.wav`);
      await renderWithFoundPreset("Waveform Audio", wavPath, range, timeout_ms);

      try {
        const audio = decodeWav(readFileSync(wavPath));
        const faults = findAudioFaults(audio);

        const problems: string[] = [];
        if (faults.clippedRanges.length > 0) {
          problems.push(
            `Clipping at ${faults.clippedRanges
              .slice(0, 4)
              .map((clip) => `${clip.fromSeconds}s`)
              .join(", ")}. This is distortion baked into the mix and cannot be repaired by lowering the level afterwards.`,
          );
        }
        if (faults.silentRanges.length > 0) {
          problems.push(
            `Silence from ${faults.silentRanges
              .slice(0, 4)
              .map((gap) => `${gap.fromSeconds}s to ${gap.toSeconds}s`)
              .join(", ")}. Check for a dead microphone or a gap left in the mix.`,
          );
        }
        if (faults.noiseFloorDb > -45) {
          problems.push(
            `The noise floor sits at ${faults.noiseFloorDb} dB, high enough to be audible under dialogue. A high pass near 80 Hz and gentle noise reduction usually fixes it.`,
          );
        }

        return {
          durationSeconds: Math.round((audio.frames / audio.sampleRate) * 100) / 100,
          sampleRate: audio.sampleRate,
          channels: audio.channels,
          noiseFloorDb: faults.noiseFloorDb,
          activeSharePercent: faults.activeSharePercent,
          activeRanges: faults.activeRanges.slice(0, 40),
          silentRanges: faults.silentRanges,
          clippedRanges: faults.clippedRanges,
          problems,
          clean: problems.length === 0,
          summary: faults.summary,
        };
      } finally {
        try {
          rmSync(wavPath, { force: true });
        } catch {
          /* the temp render is disposable */
        }
      }
    },
  },
]);

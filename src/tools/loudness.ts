import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { measureLoudness } from "../analysis/loudness.js";
import { decodeWav } from "../analysis/wav.js";
import { PRESET_SUBFOLDERS } from "../premiere/constants.js";
import { toHostPath } from "../premiere/paths.js";
import { defineTools } from "./types.js";

const TARGETS: Record<string, number> = {
  broadcast: -23,
  streaming: -16,
  social: -14,
  podcast: -16,
};

export const loudnessTools = defineTools([
  {
    name: "analyse_loudness",
    description:
      "Measure how loud the sequence actually is, in LUFS to ITU-R BS.1770, by rendering its audio to a temporary WAV and analysing it here. Premiere exposes no loudness measurement to scripting, so this is the only honest way to answer 'is this too quiet for Instagram'. Reports integrated loudness, short term maximum and peak, then says how many dB to move the mix to hit a target. Slow, since it renders the audio first.",
    schema: {
      target: z
        .enum(["broadcast", "streaming", "social", "podcast"])
        .default("social")
        .describe("Delivery target: social -14, streaming and podcast -16, broadcast -23 LUFS"),
      range: z
        .enum(["entire", "in_to_out", "work_area"])
        .default("entire")
        .describe("Which part of the sequence to measure"),
      timeout_ms: z.number().int().positive().default(600_000).describe("Default 10 minutes"),
    },
    handler: async ({
      target = "social",
      range = "entire",
      timeout_ms = 600_000,
    }: {
      target?: keyof typeof TARGETS;
      range?: "entire" | "in_to_out" | "work_area";
      timeout_ms?: number;
    }) => {
      const wavPath = join(tmpdir(), `premiere-mcp-loudness-${Date.now()}.wav`);

      const rendered = await evaluate<{ preset: string; hostResult: string }>(
        `
        var seq = __seq();
        if (!seq) return __error("No active sequence");

        var roots = [];
        var startup = Folder.startup.fsName;
        ${PRESET_SUBFOLDERS.map(
          (sub) => `(function () { var f = new Folder(startup + "/${sub}"); if (f.exists) roots.push(f); })();`,
        ).join("\n        ")}

        var preset = null;
        function walk(folder, depth) {
          if (!folder || !folder.exists || depth > 4 || preset) return;
          var entries = folder.getFiles();
          for (var i = 0; i < entries.length; i++) {
            if (preset) return;
            var entry = entries[i];
            if (entry instanceof Folder) { walk(entry, depth + 1); continue; }
            var fileName = decodeURI(entry.displayName);
            if (fileName.slice(-4).toLowerCase() !== ".epr") continue;
            if (fileName.toLowerCase().indexOf("waveform audio") === 0) { preset = entry; return; }
          }
        }
        for (var r = 0; r < roots.length; r++) walk(roots[r], 0);
        if (!preset) return __error("No Waveform Audio .epr preset found; cannot render audio to measure it");

        var scope = ${
          range === "in_to_out"
            ? "app.encoder.ENCODE_IN_TO_OUT"
            : range === "work_area"
              ? "app.encoder.ENCODE_WORKAREA"
              : "app.encoder.ENCODE_ENTIRE"
        };
        if (typeof scope !== "number") {
          return __error("This Premiere build does not expose the ${range} export scope");
        }

        var reported = seq.exportAsMediaDirect(
          "${esc(toHostPath(wavPath))}",
          preset.fsName,
          scope
        );

        var written = new File("${esc(toHostPath(wavPath))}");
        if (!written.exists) {
          return __error("Audio render reported '" + reported + "' but wrote no file");
        }
        return __result({ preset: decodeURI(preset.displayName), hostResult: String(reported) });
      `,
        { timeoutMs: timeout_ms },
      );

      try {
        const stats = measureLoudness(decodeWav(readFileSync(wavPath)));
        const wanted = TARGETS[target];

        if (stats.integratedLufs === null) {
          return {
            target,
            targetLufs: wanted,
            renderedWith: rendered.preset,
            measured: stats,
            verdict: "The rendered audio is silent or below the -70 LUFS gate, so there is nothing to measure.",
          };
        }

        const gain = Math.round((wanted - stats.integratedLufs) * 100) / 100;
        const headroom = Math.round((-1 - stats.truePeakEstimateDbfs) * 100) / 100;

        return {
          target,
          targetLufs: wanted,
          renderedWith: rendered.preset,
          measured: stats,
          gainToTargetDb: gain,
          verdict:
            Math.abs(gain) < 0.5
              ? `Already within half a dB of ${wanted} LUFS.`
              : `Move the mix ${gain > 0 ? "up" : "down"} ${Math.abs(gain)} dB to reach ${wanted} LUFS.`,
          peakWarning:
            stats.truePeakEstimateDbfs > -1
              ? `Estimated true peak is ${stats.truePeakEstimateDbfs} dBFS, which is above the -1 dBFS ceiling most platforms want; raising the level by ${gain} dB would clip. Pull peaks down first, or accept ${headroom} dB less than the target.`
              : null,
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

import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { PRESET_SUBFOLDERS } from "../premiere/constants.js";
import { toHostPath } from "../premiere/paths.js";
import { defineTools } from "./types.js";

export const exportTools = defineTools([
  {
    name: "export_frame",
    description:
      "Write a full resolution still of the sequence at a given time. Use this to actually look at your work after a grade or a reframe, instead of trusting a tool's success flag.",
    schema: {
      output_path: z.string().describe("Absolute .png path to write"),
      time_seconds: z.number().min(0).describe("Sequence time to capture"),
    },
    handler: async ({ output_path, time_seconds }: { output_path: string; time_seconds: number }) =>
      evaluate(
        `
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        seq.setPlayerPosition(String(__secondsToTicks(${time_seconds})));
        var qeSeq = __qe();

        var requested = "${esc(toHostPath(output_path))}";
        var base = requested.replace(/\\.png$/i, "");
        var reported = qeSeq.exportFramePNG(String(qeSeq.CTI.timecode), base);

        var produced = new File(base + ".png");
        if (!produced.exists) {
          return __error("Premiere reported '" + reported + "' but wrote no file");
        }
        var target = new File(requested);
        if (String(produced.fsName) !== String(target.fsName)) {
          if (target.exists) target.remove();
          produced.rename(target.name);
        }
        var written = new File(requested);
        return __result({
          path: requested,
          bytes: written.exists ? written.length : produced.length,
          atSeconds: ${time_seconds}
        });
      `,
        { timeoutMs: 60_000 },
      ),
  },

  {
    name: "list_export_presets",
    description:
      "List Adobe .epr export presets on disk, including the ones Premiere ships itself. Adobe Media Encoder does not need to be installed. Pass the path of one to export_sequence.",
    schema: {
      filter: z.string().optional().describe("Case-insensitive substring, e.g. 'H.264' or 'Match Source'"),
      limit: z.number().int().positive().max(200).default(40),
    },
    handler: async ({ filter = "", limit = 40 }: { filter?: string; limit?: number }) =>
      evaluate(
        `
        var roots = [];
        var startup = Folder.startup.fsName;
        ${PRESET_SUBFOLDERS.map(
          (sub) => `(function () { var f = new Folder(startup + "/${sub}"); if (f.exists) roots.push(f); })();`,
        ).join("\n        ")}
        if (roots.length === 0) {
          return __error("No preset folders found under " + startup);
        }

        var needle = "${esc(filter)}".toLowerCase();
        var found = [];
        function walk(folder, depth) {
          if (!folder || !folder.exists || depth > 4 || found.length >= ${limit}) return;
          var entries = folder.getFiles();
          for (var i = 0; i < entries.length; i++) {
            if (found.length >= ${limit}) return;
            var entry = entries[i];
            if (entry instanceof Folder) { walk(entry, depth + 1); continue; }
            var fileName = decodeURI(entry.displayName);
            if (fileName.length < 5) continue;
            if (fileName.slice(-4).toLowerCase() !== ".epr") continue;
            var label = fileName.substring(0, fileName.length - 4);
            if (needle.length && label.toLowerCase().indexOf(needle) === -1) continue;
            found.push({ name: label, path: entry.fsName });
          }
        }
        for (var r = 0; r < roots.length; r++) walk(roots[r], 0);

        return __result({ count: found.length, limit: ${limit}, presets: found });
      `,
        { timeoutMs: 60_000 },
      ),
  },

  {
    name: "export_sequence",
    description:
      "Render the active sequence to a file using Premiere's own encoder; Adobe Media Encoder is not required. Long running, so raise timeout_ms for big sequences. The output file is confirmed on disk before this reports success.",
    schema: {
      output_path: z.string().describe("Absolute output path, e.g. C:/Users/me/Videos/cut.mp4"),
      preset_path: z.string().describe("Absolute path to an .epr preset, from list_export_presets"),
      timeout_ms: z.number().int().positive().default(600_000).describe("Default 10 minutes"),
    },
    handler: async ({
      output_path,
      preset_path,
      timeout_ms = 600_000,
    }: {
      output_path: string;
      preset_path: string;
      timeout_ms?: number;
    }) =>
      evaluate(
        `
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var preset = new File("${esc(toHostPath(preset_path))}");
        if (!preset.exists) return __error("Preset not found: ${esc(toHostPath(preset_path))}");

        var reported = seq.exportAsMediaDirect(
          "${esc(toHostPath(output_path))}",
          "${esc(toHostPath(preset_path))}",
          app.encoder.ENCODE_ENTIRE
        );

        var written = new File("${esc(toHostPath(output_path))}");
        if (!written.exists) {
          return __error("Export reported '" + reported + "' but no file was written to ${esc(toHostPath(output_path))}");
        }
        return __result({
          path: "${esc(toHostPath(output_path))}",
          bytes: written.length,
          hostResult: String(reported)
        });
      `,
        { timeoutMs: timeout_ms },
      ),
  },
]);

import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { PRESET_SUBFOLDERS } from "./constants.js";
import { toHostPath } from "./paths.js";

export type ExportRange = "entire" | "in_to_out" | "work_area";

export const EXPORT_RANGES = ["entire", "in_to_out", "work_area"] as const;

export function scopeExpression(range: ExportRange): string {
  if (range === "in_to_out") return "app.encoder.ENCODE_IN_TO_OUT";
  if (range === "work_area") return "app.encoder.ENCODE_WORKAREA";
  return "app.encoder.ENCODE_ENTIRE";
}

export function scopeGuard(range: ExportRange): string {
  return `
    var scope = ${scopeExpression(range)};
    if (typeof scope !== "number") {
      return __error("This Premiere build does not expose the ${range} export scope");
    }`;
}

export function presetRoots(): string {
  return PRESET_SUBFOLDERS.map(
    (sub) => `(function () { var f = new Folder(startup + "/${sub}"); if (f.exists) roots.push(f); })();`,
  ).join("\n    ");
}

export function findPresetByPrefix(prefix: string): string {
  return `
    var roots = [];
    var startup = Folder.startup.fsName;
    ${presetRoots()}

    var preset = null;
    function walkPresets(folder, depth) {
      if (!folder || !folder.exists || depth > 4 || preset) return;
      var entries = folder.getFiles();
      for (var i = 0; i < entries.length; i++) {
        if (preset) return;
        var entry = entries[i];
        if (entry instanceof Folder) { walkPresets(entry, depth + 1); continue; }
        var fileName = decodeURI(entry.displayName);
        if (fileName.slice(-4).toLowerCase() !== ".epr") continue;
        if (fileName.toLowerCase().indexOf("${esc(prefix.toLowerCase())}") === 0) { preset = entry; return; }
      }
    }
    for (var r = 0; r < roots.length; r++) walkPresets(roots[r], 0);
    if (!preset) return __error("No ${esc(prefix)} .epr preset found under " + startup);`;
}

export async function renderWithFoundPreset(
  prefix: string,
  outputPath: string,
  range: ExportRange,
  timeoutMs: number,
): Promise<{ preset: string }> {
  return evaluate<{ preset: string }>(
    `
    var seq = __seq();
    if (!seq) return __error("No active sequence");
    ${findPresetByPrefix(prefix)}
    ${scopeGuard(range)}

    var reported = seq.exportAsMediaDirect("${esc(toHostPath(outputPath))}", preset.fsName, scope);
    var written = new File("${esc(toHostPath(outputPath))}");
    if (!written.exists) {
      return __error("Render reported '" + reported + "' but wrote no file");
    }
    return __result({ preset: decodeURI(preset.displayName) });
  `,
    { timeoutMs },
  );
}

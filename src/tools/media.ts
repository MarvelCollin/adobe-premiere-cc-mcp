import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { toHostPath } from "../premiere/paths.js";
import { defineTools } from "./types.js";

const WALK_ITEMS = String.raw`
function walkItems(item, path, depth, out, limit) {
  if (out.length >= limit) return;
  for (var i = 0; i < item.children.numItems; i++) {
    if (out.length >= limit) return;
    var child = item.children[i];
    var isBin = child.type === ProjectItemType.BIN;
    out.push({
      nodeId: String(child.nodeId),
      name: String(child.name),
      kind: isBin ? "bin" : "media",
      path: path
    });
    if (isBin && depth < 6) {
      walkItems(child, path + "/" + String(child.name), depth + 1, out, limit);
    }
  }
}
`;

export const mediaTools = defineTools([
  {
    name: "list_project_items",
    description:
      "List the project panel contents: bins and media, with the node ID of each. Use this to find footage before adding it to a timeline.",
    schema: { limit: z.number().int().positive().max(500).default(200) },
    handler: async ({ limit = 200 }: { limit?: number }) =>
      evaluate(
        `
        ${WALK_ITEMS}
        if (!app.project) return __error("No project open");
        var items = [];
        walkItems(app.project.rootItem, "", 0, items, ${limit});
        return __result({ count: items.length, limit: ${limit}, items: items });
      `,
        { timeoutMs: 60_000 },
      ),
  },

  {
    name: "import_media",
    description:
      "Import one or more media files into the project panel and confirm the item count grew. Paths must be absolute.",
    schema: {
      file_paths: z.array(z.string()).min(1).describe("Absolute paths to import"),
      bin_name: z.string().optional().describe("Import into this top level bin, creating it if needed"),
    },
    handler: async ({ file_paths, bin_name }: { file_paths: string[]; bin_name?: string }) =>
      evaluate(
        `
        ${WALK_ITEMS}
        if (!app.project) return __error("No project open");

        var paths = [${file_paths.map((path) => `"${esc(toHostPath(path))}"`).join(", ")}];
        for (var p = 0; p < paths.length; p++) {
          if (!new File(paths[p]).exists) return __error("File not found: " + paths[p]);
        }

        var before = [];
        walkItems(app.project.rootItem, "", 0, before, 500);

        var target = app.project.rootItem;
        ${
          bin_name
            ? `
        var binName = "${esc(bin_name)}";
        var existing = null;
        for (var b = 0; b < app.project.rootItem.children.numItems; b++) {
          var candidate = app.project.rootItem.children[b];
          if (candidate.type === ProjectItemType.BIN && String(candidate.name) === binName) {
            existing = candidate;
            break;
          }
        }
        target = existing ? existing : app.project.rootItem.createBin(binName);
        `
            : ""
        }

        app.project.importFiles(paths, true, target, false);

        var after = [];
        walkItems(app.project.rootItem, "", 0, after, 500);
        if (after.length <= before.length) {
          return __error("Import ran but no new project items appeared. Is the format supported?");
        }
        var landed = [];
        var missing = [];
        for (var f = 0; f < paths.length; f++) {
          var parts = String(paths[f]).split("\\\\");
          var fileName = parts[parts.length - 1];
          var inTarget = false;
          for (var t = 0; t < target.children.numItems; t++) {
            if (String(target.children[t].name) === fileName) { inTarget = true; break; }
          }
          if (inTarget) landed.push(fileName); else missing.push(fileName);
        }

        if (missing.length > 0) {
          return __error(
            "Premiere imported the media but left " + missing.join(", ") +
            " outside the requested destination, so the bin argument was not honoured."
          );
        }

        return __result({
          imported: paths.length,
          bin: ${bin_name ? `"${esc(bin_name)}"` : "null"},
          landedInTarget: landed,
          itemsBefore: before.length,
          itemsAfter: after.length
        });
      `,
        { timeoutMs: 120_000 },
      ),
  },

  {
    name: "create_bin",
    description: "Create a bin in the project panel and confirm it exists.",
    schema: { name: z.string().min(1).describe("Bin name") },
    handler: async ({ name }: { name: string }) =>
      evaluate(`
        if (!app.project) return __error("No project open");
        var root = app.project.rootItem;
        for (var i = 0; i < root.children.numItems; i++) {
          var child = root.children[i];
          if (child.type === ProjectItemType.BIN && String(child.name) === "${esc(name)}") {
            return __error("A bin named ${esc(name)} already exists");
          }
        }
        var bin = root.createBin("${esc(name)}");
        if (!bin) return __error("Premiere did not create the bin");
        return __result({ nodeId: String(bin.nodeId), name: String(bin.name) });
      `),
  },
]);

import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { toHostPath } from "../premiere/paths.js";
import { defineTools } from "./types.js";

const FIND_ITEM = String.raw`
function findItem(item, wanted, depth) {
  for (var i = 0; i < item.children.numItems; i++) {
    var child = item.children[i];
    if (String(child.nodeId) === wanted || String(child.name) === wanted) return child;
    if (child.type === ProjectItemType.BIN && depth < 6) {
      var deeper = findItem(child, wanted, depth + 1);
      if (deeper) return deeper;
    }
  }
  return null;
}
`;

const WALK_MEDIA = String.raw`
function walkMedia(item, depth, out, limit) {
  if (out.length >= limit) return;
  for (var i = 0; i < item.children.numItems; i++) {
    if (out.length >= limit) return;
    var child = item.children[i];
    if (child.type === ProjectItemType.BIN) {
      if (depth < 6) walkMedia(child, depth + 1, out, limit);
      continue;
    }
    var record = { nodeId: String(child.nodeId), name: String(child.name) };
    try { record.offline = child.isOffline(); } catch (e) { record.offline = null; }
    try { record.mediaPath = String(child.getMediaPath()); } catch (e) { record.mediaPath = null; }
    try { record.hasProxy = child.hasProxy(); } catch (e) { record.hasProxy = null; }
    if (record.hasProxy === true) {
      try { record.proxyPath = String(child.getProxyPath()); } catch (e) { record.proxyPath = null; }
    }
    out.push(record);
  }
}
`;

export const linkTools = defineTools([
  {
    name: "check_media",
    description:
      "Report the link state of every media item: whether it is offline, where its media actually lives on disk, and whether a proxy is attached. Run this when footage shows as offline, when a project has been moved between machines, or before an export you care about.",
    schema: {
      limit: z.number().int().positive().max(500).default(200),
    },
    handler: async ({ limit = 200 }: { limit?: number }) =>
      evaluate(
        `
        ${WALK_MEDIA}
        var items = [];
        walkMedia(app.project.rootItem, 0, items, ${limit});

        var offline = [];
        var proxied = 0;
        for (var i = 0; i < items.length; i++) {
          if (items[i].offline === true) offline.push(items[i].name);
          if (items[i].hasProxy === true) proxied++;
        }

        return __result({
          count: items.length,
          offlineCount: offline.length,
          offlineNames: offline,
          withProxy: proxied,
          items: items,
          clean: offline.length === 0
        });
      `,
        { timeoutMs: 120_000 },
      ),
  },

  {
    name: "attach_proxy",
    description:
      "Attach a proxy file to a project item, so Premiere edits against the light version while keeping the original for export. Confirms the proxy is attached afterwards. Premiere does not generate proxies from a script, so the file has to exist already.",
    schema: {
      item_id: z.string().describe("Node ID or exact name of the project item"),
      proxy_path: z.string().describe("Absolute path to the proxy file that already exists"),
    },
    handler: async ({ item_id, proxy_path }: { item_id: string; proxy_path: string }) =>
      evaluate(
        `
        ${FIND_ITEM}
        var item = findItem(app.project.rootItem, "${esc(item_id)}", 0);
        if (!item) return __error("Project item not found: ${esc(item_id)}");

        var proxy = new File("${esc(toHostPath(proxy_path))}");
        if (!proxy.exists) return __error("Proxy file does not exist: ${esc(toHostPath(proxy_path))}");

        if (typeof item.canProxy !== "function" || !item.canProxy()) {
          return __error(String(item.name) + " cannot take a proxy");
        }

        item.attachProxy("${esc(toHostPath(proxy_path))}", 0);

        var attached = false;
        try { attached = item.hasProxy(); } catch (e) { attached = false; }
        if (!attached) return __error("Premiere accepted the call but no proxy is attached to " + String(item.name));

        var where = null;
        try { where = String(item.getProxyPath()); } catch (e) { where = null; }
        return __result({ name: String(item.name), hasProxy: true, proxyPath: where });
      `,
        { timeoutMs: 120_000 },
      ),
  },

  {
    name: "relink_media",
    description:
      "Point an offline project item at its file in a new location and confirm it came back online. Use after moving footage or opening a project on another machine. There is no unlink or relink API on this Premiere build, so this goes through changeMediaPath.",
    schema: {
      item_id: z.string().describe("Node ID or exact name of the project item"),
      new_path: z.string().describe("Absolute path to the media file in its new location"),
    },
    handler: async ({ item_id, new_path }: { item_id: string; new_path: string }) =>
      evaluate(
        `
        ${FIND_ITEM}
        var item = findItem(app.project.rootItem, "${esc(item_id)}", 0);
        if (!item) return __error("Project item not found: ${esc(item_id)}");

        var target = new File("${esc(toHostPath(new_path))}");
        if (!target.exists) return __error("No file at ${esc(toHostPath(new_path))}");

        if (typeof item.canChangeMediaPath !== "function" || !item.canChangeMediaPath()) {
          return __error(String(item.name) + " does not allow its media path to change");
        }

        var wasOffline = null;
        try { wasOffline = item.isOffline(); } catch (e) { wasOffline = null; }

        item.changeMediaPath("${esc(toHostPath(new_path))}");

        var nowOffline = null;
        try { nowOffline = item.isOffline(); } catch (e) { nowOffline = null; }
        var nowPath = null;
        try { nowPath = String(item.getMediaPath()); } catch (e) { nowPath = null; }

        if (nowOffline === true) {
          return __error("Still offline after relinking " + String(item.name) + " to ${esc(toHostPath(new_path))}");
        }

        return __result({
          name: String(item.name),
          wasOffline: wasOffline,
          offline: nowOffline,
          mediaPath: nowPath
        });
      `,
        { timeoutMs: 120_000 },
      ),
  },
]);

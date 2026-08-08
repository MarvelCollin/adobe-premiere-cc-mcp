import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { defineTools } from "./types.js";

/**
 * Sequence markers are a linked list rather than an indexable collection, so
 * every read walks it with getFirstMarker/getNextMarker.
 */
const WALK_MARKERS = String.raw`
function walkMarkers(seq) {
  var out = [];
  var marker = seq.markers.getFirstMarker();
  while (marker) {
    out.push({
      name: String(marker.name),
      comments: String(marker.comments),
      type: String(marker.type),
      start: marker.start.seconds,
      end: marker.end.seconds
    });
    marker = seq.markers.getNextMarker(marker);
  }
  return out;
}
`;

export const markerTools = defineTools([
  {
    name: "list_markers",
    description: "List every marker on the active sequence with its time, name and comment.",
    schema: {},
    handler: async () =>
      evaluate(`
        ${WALK_MARKERS}
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var markers = walkMarkers(seq);
        return __result({ count: markers.length, markers: markers });
      `),
  },

  {
    name: "add_marker",
    description:
      "Add a marker to the active sequence at a given time, then confirm it exists. Handy for noting beats, cut points or review comments.",
    schema: {
      time_seconds: z.number().min(0).describe("Where to place the marker"),
      name: z.string().default("").describe("Short marker title"),
      comment: z.string().default("").describe("Longer note stored on the marker"),
      duration_seconds: z.number().min(0).default(0).describe("Above zero makes it a range marker"),
    },
    handler: async ({
      time_seconds,
      name = "",
      comment = "",
      duration_seconds = 0,
    }: {
      time_seconds: number;
      name?: string;
      comment?: string;
      duration_seconds?: number;
    }) =>
      evaluate(`
        ${WALK_MARKERS}
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var before = walkMarkers(seq).length;

        var marker = seq.markers.createMarker(${time_seconds});
        if (!marker) return __error("Premiere did not create a marker at ${time_seconds}s");
        marker.name = "${esc(name)}";
        marker.comments = "${esc(comment)}";
        ${
          duration_seconds > 0
            ? `var endTime = marker.end; endTime.seconds = ${time_seconds + duration_seconds}; marker.end = endTime;`
            : ""
        }

        var markers = walkMarkers(seq);
        if (markers.length <= before) return __error("Marker count did not increase");
        return __result({
          added: { name: String(marker.name), start: marker.start.seconds, end: marker.end.seconds },
          total: markers.length
        });
      `),
  },

  {
    name: "delete_marker",
    description:
      "Delete the marker nearest a given time, within a small tolerance, and report how many remain. Deleting cannot be undone from here, so check list_markers first.",
    schema: {
      time_seconds: z.number().min(0).describe("Time of the marker to remove"),
      tolerance_seconds: z.number().min(0).default(0.1).describe("How close a marker must be to match"),
    },
    handler: async ({
      time_seconds,
      tolerance_seconds = 0.1,
    }: {
      time_seconds: number;
      tolerance_seconds?: number;
    }) =>
      evaluate(`
        ${WALK_MARKERS}
        var seq = __seq();
        if (!seq) return __error("No active sequence");

        var target = null;
        var marker = seq.markers.getFirstMarker();
        while (marker) {
          if (Math.abs(marker.start.seconds - ${time_seconds}) <= ${tolerance_seconds}) { target = marker; break; }
          marker = seq.markers.getNextMarker(marker);
        }
        if (!target) return __error("No marker within ${tolerance_seconds}s of ${time_seconds}s");

        var removed = { name: String(target.name), start: target.start.seconds };
        seq.markers.deleteMarker(target);
        return __result({ removed: removed, remaining: walkMarkers(seq).length });
      `),
  },
]);

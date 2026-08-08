import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { LUMETRI_PROPERTY } from "../premiere/constants.js";
import { defineTools } from "./types.js";

export const gradeReadTools = defineTools([
  {
    name: "match_grade",
    description:
      "Copy one clip's Lumetri Basic Correction onto other clips as a starting point, then read every value back. A reference grade rarely fits other lighting unchanged, so treat this as the first pass, not the finished look.",
    schema: {
      source_node_id: z.string().describe("Clip whose grade should be copied"),
      target_node_ids: z.array(z.string()).min(1).describe("Clips to copy it onto"),
    },
    handler: async ({
      source_node_id,
      target_node_ids,
    }: {
      source_node_id: string;
      target_node_ids: string[];
    }) =>
      evaluate(
        `
        var sourceFound = __findClip("${esc(source_node_id)}");
        if (!sourceFound) return __error("Source clip not found: ${esc(source_node_id)}");
        var source = __component(sourceFound.clip, "Lumetri Color");
        if (!source) return __error("The source clip has no Lumetri Color effect");

        var indexes = [
          ${LUMETRI_PROPERTY.exposure}, ${LUMETRI_PROPERTY.contrast}, ${LUMETRI_PROPERTY.highlights},
          ${LUMETRI_PROPERTY.shadows}, ${LUMETRI_PROPERTY.whites}, ${LUMETRI_PROPERTY.blacks},
          ${LUMETRI_PROPERTY.saturation}, ${LUMETRI_PROPERTY.temperature}, ${LUMETRI_PROPERTY.tint}
        ];
        var names = [
          "exposure", "contrast", "highlights", "shadows", "whites",
          "blacks", "saturation", "temperature", "tint"
        ];

        var reference = {};
        for (var r = 0; r < indexes.length; r++) {
          reference[names[r]] = source.properties[indexes[r]].getValue();
        }

        var wanted = [${target_node_ids.map((id) => `"${esc(id)}"`).join(", ")}];
        var matched = [];
        var failed = [];

        for (var i = 0; i < wanted.length; i++) {
          if (wanted[i] === "${esc(source_node_id)}") continue;
          var found = __findClip(wanted[i]);
          if (!found) {
            failed.push({ nodeId: wanted[i], error: "clip not found" });
            continue;
          }
          var target = __component(found.clip, "Lumetri Color");
          if (!target) {
            var qeTrack = __qeTrackFor(found);
            var qeClip = __qeClipAt(qeTrack, found.clip.start.seconds);
            var fx = null;
            try { fx = qe.project.getVideoEffectByName("Lumetri Color"); } catch (lookupError) { fx = null; }
            if (qeClip && fx) {
              qeClip.addVideoEffect(fx);
              target = __component(found.clip, "Lumetri Color");
            }
          }
          if (!target) {
            failed.push({ nodeId: wanted[i], name: String(found.clip.name), error: "could not attach Lumetri" });
            continue;
          }

          var applied = {};
          for (var p = 0; p < indexes.length; p++) {
            target.properties[indexes[p]].setValue(reference[names[p]], true);
            applied[names[p]] = target.properties[indexes[p]].getValue();
          }
          matched.push({ nodeId: wanted[i], name: String(found.clip.name), applied: applied });
        }

        return __result({
          source: { nodeId: "${esc(source_node_id)}", name: String(sourceFound.clip.name), values: reference },
          matchedCount: matched.length,
          failedCount: failed.length,
          matched: matched,
          failed: failed
        });
      `,
        { timeoutMs: 180_000 },
      ),
  },

  {
    name: "get_grade",
    description:
      "Read the Lumetri Basic Correction values of every graded clip in one call, so a grade can be compared across shots without inspecting clips one at a time.",
    schema: {},
    handler: async () =>
      evaluate(
        `
        var seq = __seq();
        if (!seq) return __error("No active sequence");
        var clips = [];
        for (var t = 0; t < seq.videoTracks.numTracks; t++) {
          var track = seq.videoTracks[t];
          for (var c = 0; c < track.clips.numItems; c++) {
            var clip = track.clips[c];
            var lumetri = __component(clip, "Lumetri Color");
            if (!lumetri) continue;
            clips.push({
              nodeId: String(clip.nodeId),
              name: String(clip.name),
              track: t,
              start: clip.start.seconds,
              exposure: lumetri.properties[${LUMETRI_PROPERTY.exposure}].getValue(),
              contrast: lumetri.properties[${LUMETRI_PROPERTY.contrast}].getValue(),
              highlights: lumetri.properties[${LUMETRI_PROPERTY.highlights}].getValue(),
              shadows: lumetri.properties[${LUMETRI_PROPERTY.shadows}].getValue(),
              whites: lumetri.properties[${LUMETRI_PROPERTY.whites}].getValue(),
              blacks: lumetri.properties[${LUMETRI_PROPERTY.blacks}].getValue(),
              saturation: lumetri.properties[${LUMETRI_PROPERTY.saturation}].getValue(),
              temperature: lumetri.properties[${LUMETRI_PROPERTY.temperature}].getValue(),
              tint: lumetri.properties[${LUMETRI_PROPERTY.tint}].getValue(),
              lookIntensity: lumetri.properties[${LUMETRI_PROPERTY.lookIntensity}].getValue()
            });
          }
        }
        return __result({ count: clips.length, clips: clips });
      `,
        { timeoutMs: 120_000 },
      ),
  },
]);

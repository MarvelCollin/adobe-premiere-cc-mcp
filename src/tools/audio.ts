import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { decibelsToLevel } from "../premiere/constants.js";
import { defineTools } from "./types.js";

export const audioTools = defineTools([
  {
    name: "set_audio_level",
    description:
      "Set a clip's audio level in decibels and read it back. 0 dB is unity and the practical ceiling; dialogue usually sits near -14 dB with a music bed under it around -26 dB. Any existing volume keyframes on the clip are cleared first, since they would otherwise override the level.",
    schema: {
      node_id: z.string().describe("Node ID of the audio clip"),
      db: z.number().max(0).describe("Level in decibels, 0 = unity gain"),
    },
    handler: async ({ node_id, db }: { node_id: string; db: number }) =>
      evaluate(`
        var found = __findClip("${esc(node_id)}");
        if (!found) return __error("Clip not found: ${esc(node_id)}");
        var volume = __component(found.clip, "Volume");
        if (!volume) return __error("Clip has no Volume component; is it a video-only clip?");
        var level = __property(volume, "Level");
        if (!level) return __error("Volume component has no Level property");

        var clearedKeys = __clearKeys(level);
        level.setValue(${decibelsToLevel(db)}, true);
        var applied = level.getValue();

        return __result({
          nodeId: String(found.clip.nodeId),
          name: String(found.clip.name),
          clearedKeys: clearedKeys,
          db: Math.round((20 * (Math.log(applied) / Math.LN10)) * 100) / 100,
          rawLevel: applied
        });
      `),
  },
]);

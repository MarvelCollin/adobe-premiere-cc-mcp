import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { defineTools } from "./types.js";

export const keyframeTools = defineTools([
  {
    name: "set_fade",
    description:
      "Put a clean fade in and/or out on a clip: Opacity for video, Volume for audio. Existing keyframes on that property are cleared first, because new keys interleave with old ones rather than replacing them, which is how envelopes end up spiking to full. Also handles the source-time offset that makes naive keyframes on stills and graphics silently never fire.",
    schema: {
      node_id: z.string().describe("Node ID of the timeline clip"),
      fade_in_seconds: z.number().min(0).optional().describe("Fade up over this long from the clip start"),
      fade_out_seconds: z.number().min(0).optional().describe("Fade down over this long into the clip end"),
    },
    handler: async ({
      node_id,
      fade_in_seconds = 0,
      fade_out_seconds = 0,
    }: {
      node_id: string;
      fade_in_seconds?: number;
      fade_out_seconds?: number;
    }) => {
      if (fade_in_seconds <= 0 && fade_out_seconds <= 0) {
        throw new Error("Pass fade_in_seconds and/or fade_out_seconds.");
      }

      return evaluate(`
        var found = __findClip("${esc(node_id)}");
        if (!found) return __error("Clip not found: ${esc(node_id)}");
        var clip = found.clip;
        var isAudio = found.trackType === "audio";

        var comp = isAudio ? __component(clip, "Volume") : __component(clip, "Opacity");
        if (!comp) return __error("Clip has no " + (isAudio ? "Volume" : "Opacity") + " component");
        var prop = isAudio ? __property(comp, "Level") : __property(comp, "Opacity");
        if (!prop) return __error("Could not find the property to fade");

        // Fade back up to whatever the clip currently sits at, not a fixed value,
        // so an audio bed keeps its mixed level.
        var full = isAudio ? prop.getValue() : 100;
        if (isAudio && !(full > 0)) full = 1;

        var clearedKeys = __clearKeys(prop);
        prop.setValue(full, true);

        // Keyframe times are absolute SOURCE time, not clip-relative. Stills and
        // graphics sit near 3600s, so anchoring at zero writes keys outside the
        // clip and nothing happens.
        var base = clip.inPoint.seconds;
        var duration = clip.end.seconds - clip.start.seconds;
        prop.setTimeVarying(true);

        var fadeIn = ${fade_in_seconds};
        var fadeOut = ${fade_out_seconds};
        if (fadeIn > 0) {
          prop.addKey(base);
          prop.setValueAtKey(base, 0, true);
          prop.addKey(base + fadeIn);
          prop.setValueAtKey(base + fadeIn, full, true);
        }
        if (fadeOut > 0) {
          prop.addKey(base + duration - fadeOut);
          prop.setValueAtKey(base + duration - fadeOut, full, true);
          prop.addKey(base + duration);
          prop.setValueAtKey(base + duration, 0, true);
        }

        var keys = prop.getKeys();
        return __result({
          nodeId: String(clip.nodeId),
          name: String(clip.name),
          property: isAudio ? "Volume" : "Opacity",
          clearedKeys: clearedKeys,
          keyCount: keys ? keys.length : 0,
          valueAtStart: prop.getValueAtTime(base),
          valueAtMiddle: prop.getValueAtTime(base + duration / 2)
        });
      `);
    },
  },
]);

import { z } from "zod";
import { evaluate, sendScript } from "../bridge/client.js";
import { wrapScript } from "../bridge/script.js";
import { HostError } from "../bridge/errors.js";
import { defineTools } from "./types.js";

export const projectTools = defineTools([
  {
    name: "save_project",
    description: "Save the current project. Nothing auto-saves, so call this after a batch of edits.",
    schema: {},
    handler: async () =>
      evaluate(`
        if (!app.project) return __error("No project open");
        app.project.save();
        return __result({ saved: true, name: String(app.project.name), path: String(app.project.path) });
      `),
  },

  {
    name: "run_script",
    description:
      "Escape hatch: run raw ExtendScript in Premiere for anything the typed tools do not cover. ES3 only (var, no arrow functions, no template literals, no JSON object). End with `return __result({...})` or `return __error('...')`. Helpers available: __seq, __qe, __findClip, __qeClipAt, __qeTrackFor, __component, __property, __componentNames, __clearKeys, __ticksToSeconds, __secondsToTicks.",
    schema: {
      code: z.string().describe("ExtendScript body in ES3 syntax"),
      timeout_ms: z.number().int().positive().default(30_000),
    },
    handler: async ({ code, timeout_ms = 30_000 }: { code: string; timeout_ms?: number }) => {
      const envelope = await sendScript(wrapScript(code), { timeoutMs: timeout_ms });
      if (!envelope.ok) throw new HostError(envelope.error ?? "Script failed");
      return envelope.data;
    },
  },
]);

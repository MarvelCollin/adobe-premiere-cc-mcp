import { evaluate } from "../bridge/client.js";
import { defineTools } from "./types.js";

export const connectionTools = defineTools([
  {
    name: "ping",
    description:
      "Check that Premiere is running and the bridge panel is alive. Returns the Premiere version, project name and active sequence. Call this before anything else.",
    schema: {},
    handler: async () =>
      evaluate(`
        var seq = __seq();
        return __result({
          connected: true,
          version: String(app.version),
          project: app.project ? String(app.project.name) : null,
          sequence: seq ? String(seq.name) : null
        });
      `),
  },
]);

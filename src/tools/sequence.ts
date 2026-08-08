import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { defineTools } from "./types.js";

export const sequenceTools = defineTools([
  {
    name: "list_sequences",
    description: "List every sequence in the project and say which one is active.",
    schema: {},
    handler: async () =>
      evaluate(`
        if (!app.project) return __error("No project open");
        var active = app.project.activeSequence;
        var sequences = [];
        for (var i = 0; i < app.project.sequences.numSequences; i++) {
          var seq = app.project.sequences[i];
          sequences.push({
            index: i,
            id: String(seq.sequenceID),
            name: String(seq.name),
            durationSeconds: __ticksToSeconds(seq.end),
            active: active ? String(seq.sequenceID) === String(active.sequenceID) : false
          });
        }
        return __result({ count: sequences.length, sequences: sequences });
      `),
  },

  {
    name: "set_active_sequence",
    description:
      "Make a sequence the active one, so every other tool operates on it. Match by name or sequence ID.",
    schema: { sequence: z.string().describe("Sequence name or ID") },
    handler: async ({ sequence }: { sequence: string }) =>
      evaluate(`
        if (!app.project) return __error("No project open");
        var wanted = "${esc(sequence)}";
        var target = null;
        for (var i = 0; i < app.project.sequences.numSequences; i++) {
          var candidate = app.project.sequences[i];
          if (String(candidate.name) === wanted || String(candidate.sequenceID) === wanted) {
            target = candidate;
            break;
          }
        }
        if (!target) return __error("No sequence called " + wanted);

        app.project.openSequence(target.sequenceID);
        app.project.activeSequence = target;

        var active = app.project.activeSequence;
        if (!active || String(active.sequenceID) !== String(target.sequenceID)) {
          return __error("Premiere did not switch to " + wanted);
        }
        return __result({ name: String(active.name), id: String(active.sequenceID) });
      `),
  },

  {
    name: "create_sequence_from_items",
    description:
      "Create a new sequence built from one or more project items, and confirm it exists. Premiere derives the settings from the first item, so this needs no preset and opens no dialog. Useful for making a scratch sequence to experiment in.",
    schema: {
      name: z.string().min(1).describe("Name for the new sequence"),
      item_ids: z.array(z.string()).min(1).describe("Node IDs or exact names of project items"),
    },
    handler: async ({ name, item_ids }: { name: string; item_ids: string[] }) =>
      evaluate(
        `
        if (!app.project) return __error("No project open");
        var wanted = [${item_ids.map((id) => `"${esc(id)}"`).join(", ")}];
        var items = [];
        for (var i = 0; i < wanted.length; i++) {
          var item = __findProjectItem(wanted[i]);
          if (!item) return __error("Project item not found: " + wanted[i]);
          if (item.type === ProjectItemType.BIN) return __error(wanted[i] + " is a bin, not media");
          items.push(item);
        }

        var before = app.project.sequences.numSequences;
        var created = app.project.createNewSequenceFromClips("${esc(name)}", items);
        var after = app.project.sequences.numSequences;
        if (after <= before || !created) {
          return __error("Premiere did not create a sequence called ${esc(name)}");
        }
        return __result({
          name: String(created.name),
          id: String(created.sequenceID),
          fromItems: wanted.length,
          sequencesBefore: before,
          sequencesAfter: after
        });
      `,
        { timeoutMs: 90_000 },
      ),
  },
]);

import { readFileSync } from "node:fs";
import { z } from "zod";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { decodePng } from "../analysis/png.js";
import { matchError, planShotMatch, readScopes, type MatchMove, type ScopeReading } from "../analysis/scopes.js";
import { LUMETRI_PROPERTY } from "../premiere/constants.js";
import { discardStill, exportStill } from "../premiere/still.js";
import { defineTools } from "./types.js";

async function scopesAt(seconds: number, label: string): Promise<ScopeReading> {
  const path = await exportStill(seconds, label);
  try {
    return readScopes(decodePng(readFileSync(path)));
  } finally {
    discardStill(path);
  }
}

async function clipMidpoint(nodeId: string): Promise<{ name: string; seconds: number }> {
  return evaluate<{ name: string; seconds: number }>(`
    var found = __findClip("${esc(nodeId)}");
    if (!found) return __error("Clip not found: ${esc(nodeId)}");
    var clip = found.clip;
    return __result({
      name: String(clip.name),
      seconds: clip.start.seconds + (clip.end.seconds - clip.start.seconds) / 2
    });
  `);
}

function writeStatements(moves: MatchMove[]): string {
  return moves
    .map((move) => {
      const index = LUMETRI_PROPERTY[move.field as keyof typeof LUMETRI_PROPERTY];
      const absolute = move.field === "saturation";
      return `applied.${move.field} = write(${index}, ${move.amount}, ${absolute});`;
    })
    .join("\n          ");
}

async function applyMoves(nodeId: string, moves: MatchMove[]): Promise<void> {
  await evaluate(
    `
    var found = __findClip("${esc(nodeId)}");
    if (!found) return __error("Clip not found: ${esc(nodeId)}");
    var lumetri = __component(found.clip, "Lumetri Color");
    if (!lumetri) {
      var qeTrack = __qeTrackFor(found);
      var qeClip = __qeClipAt(qeTrack, found.clip.start.seconds);
      var fx = null;
      try { fx = qe.project.getVideoEffectByName("Lumetri Color"); } catch (lookupError) { fx = null; }
      if (qeClip && fx) {
        qeClip.addVideoEffect(fx);
        lumetri = __component(found.clip, "Lumetri Color");
      }
    }
    if (!lumetri) return __error("Could not attach Lumetri Color to " + found.clip.name);

    var applied = {};
    function write(index, value, absolute) {
      var next = absolute ? value : lumetri.properties[index].getValue() + value;
      lumetri.properties[index].setValue(next, true);
      return lumetri.properties[index].getValue();
    }
    ${writeStatements(moves)}
    return __result({ applied: applied });
  `,
    { timeoutMs: 120_000 },
  );
}

export const scopeTools = defineTools([
  {
    name: "read_scopes",
    description:
      "Read the video scopes at a point in the sequence, the way a colourist would. Returns the waveform as luminance percentiles, the RGB parade per channel so a colour cast shows up as an imbalance between them, the vectorscope as mean hue and saturation, how much of the frame sits outside broadcast legal range, and where skin tones fall against the 123 degree skin tone line. Skin is the most reliable objective check there is, because the red of blood under skin is the same for everyone.",
    schema: {
      time_seconds: z.number().min(0).describe("Where in the sequence to measure"),
    },
    handler: async ({ time_seconds }: { time_seconds: number }) => {
      const scopes = await scopesAt(time_seconds, "scopes");

      if (scopes.waveform.white === 0 && scopes.vectorscope.peakSaturation === 0) {
        return {
          atSeconds: time_seconds,
          ...scopes,
          blankFrame: true,
          warnings: [],
          clean: false,
          warning:
            "This frame is entirely black, so the scopes describe nothing. Usually a gap on the track, a disabled clip, or a point past the last clip. Do not grade from this.",
        };
      }

      const warnings: string[] = [];
      if (scopes.illegal.belowBlack > 1) {
        warnings.push(`${scopes.illegal.belowBlack}% of the frame is crushed below legal black.`);
      }
      if (scopes.illegal.aboveWhite > 1) {
        warnings.push(`${scopes.illegal.aboveWhite}% of the frame is clipped above legal white.`);
      }
      if (scopes.skin && Math.abs(scopes.skin.deviationDegrees) > 8) {
        warnings.push(scopes.skin.verdict);
      }
      if (scopes.waveform.white - scopes.waveform.black < 120) {
        warnings.push("The waveform is narrow, so the shot is flat and wants contrast.");
      }

      return {
        atSeconds: time_seconds,
        ...scopes,
        blankFrame: false,
        warnings,
        clean: warnings.length === 0,
      };
    },
  },

  {
    name: "match_shots",
    description:
      "Match one clip's grade to another by measurement rather than by eye. Reads the scopes of both, computes the Basic Correction moves that bring the target's waveform, parade and vectorscope onto the reference, applies them, then measures again and corrects what is left, for up to a few rounds. Reports the residual error honestly: a gap that will not close means the two shots were lit too differently to match with primaries alone, which is worth knowing rather than guessing at.",
    schema: {
      reference_node_id: z.string().describe("The clip whose look is correct"),
      target_node_ids: z.array(z.string()).min(1).describe("Clips to bring into line with it"),
      apply: z
        .boolean()
        .default(true)
        .describe("False plans the moves and reports them without touching the clips"),
      max_passes: z
        .number()
        .int()
        .min(1)
        .max(5)
        .default(3)
        .describe("How many measure and correct rounds to run before giving up on closing the gap"),
    },
    handler: async ({
      reference_node_id,
      target_node_ids,
      apply = true,
      max_passes = 3,
    }: {
      reference_node_id: string;
      target_node_ids: string[];
      apply?: boolean;
      max_passes?: number;
    }) => {
      const referenceClip = await clipMidpoint(reference_node_id);
      const reference = await scopesAt(referenceClip.seconds, "reference");

      const results = [];

      for (const nodeId of target_node_ids) {
        if (nodeId === reference_node_id) continue;

        const targetClip = await clipMidpoint(nodeId);
        const before = await scopesAt(targetClip.seconds, "target");
        const firstPlan = planShotMatch(reference, before);

        if (!apply || firstPlan.length === 0) {
          results.push({
            nodeId,
            name: targetClip.name,
            applied: false,
            moves: firstPlan,
            note: firstPlan.length === 0 ? "Already matches the reference." : "Planned only.",
          });
          continue;
        }

        let plan = firstPlan;
        let error = matchError(firstPlan);
        const passes: { pass: number; applied: number; remaining: number; errorBefore: number; errorAfter: number }[] = [];

        for (let pass = 0; pass < max_passes && plan.length > 0; pass += 1) {
          await applyMoves(nodeId, plan);

          const after = await scopesAt(targetClip.seconds, `verify${pass}`);
          const residual = planShotMatch(reference, after);
          const residualError = matchError(residual);

          passes.push({
            pass: pass + 1,
            applied: plan.length,
            remaining: residual.length,
            errorBefore: error,
            errorAfter: residualError,
          });

          const improved = residualError < error * 0.95;
          plan = residual;
          error = residualError;
          if (!improved) break;
        }

        results.push({
          nodeId,
          name: targetClip.name,
          applied: true,
          firstPlan,
          passes,
          residualMoves: plan,
          residualError: error,
          closed: plan.length === 0,
          verdict:
            plan.length === 0
              ? `Matched after ${passes.length} pass(es).`
              : `Still ${plan.length} move(s) out after ${passes.length} pass(es). These shots are probably too differently lit to match with primaries alone.`,
        });
      }

      return {
        reference: { nodeId: reference_node_id, name: referenceClip.name, scopes: reference },
        applied: apply,
        results,
      };
    },
  },
]);

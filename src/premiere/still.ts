import { rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluate } from "../bridge/client.js";
import { esc } from "../bridge/script.js";
import { toHostPath } from "./paths.js";

export async function exportStill(atSeconds: number, label: string, into?: string): Promise<string> {
  const target = into ?? join(tmpdir(), `premiere-mcp-still-${label}-${Date.now()}.png`);
  await evaluate(
    `
    var seq = __seq();
    if (!seq) return __error("No active sequence");
    var runsTo = __ticksToSeconds(seq.end);
    if (${atSeconds} > runsTo) {
      return __error(
        "Cannot capture ${atSeconds}s: the sequence ends at " + runsTo +
        "s, and past the end Premiere renders an empty frame that would measure as pure black."
      );
    }
    seq.setPlayerPosition(String(__secondsToTicks(${atSeconds})));
    var qeSeq = __qe();
    var base = "${esc(toHostPath(target))}".replace(/\\.png$/i, "");
    qeSeq.exportFramePNG(String(qeSeq.CTI.timecode), base);
    var written = new File(base + ".png");
    if (!written.exists) return __error("Premiere wrote no still at ${atSeconds}s");
    return __result({ path: written.fsName });
  `,
    { timeoutMs: 90_000 },
  );
  return target;
}

export function discardStill(path: string): void {
  try {
    rmSync(path, { force: true });
  } catch {
    return;
  }
}

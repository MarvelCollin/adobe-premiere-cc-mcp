import { readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decodeWav, type DecodedAudio } from "../analysis/wav.js";
import { evaluate } from "../bridge/client.js";
import { renderWithFoundPreset } from "./encoder.js";

export interface IsolatedRender {
  audio: DecodedAudio;
  originalMutes: boolean[];
  mutesRestored: boolean;
  durationSeconds: number;
}

function list(values: number[]): string {
  return values.map((value) => (Number.isFinite(value) ? String(Math.round(value)) : "0")).join(",");
}

export async function readAudioMutes(): Promise<boolean[]> {
  const state = await evaluate<{ mutes: boolean[] }>(`
    var seq = __seq();
    if (!seq) return __error("No active sequence");
    var tracks = seq.audioTracks;
    var mutes = [];
    for (var t = 0; t < tracks.numTracks; t++) mutes.push(tracks[t].isMuted());
    return __result({ mutes: mutes });
  `);
  return state.mutes;
}

export async function renderIsolatedAudio(
  keep: number[],
  timeoutMs: number,
  label: string,
): Promise<IsolatedRender> {
  const originalMutes = await readAudioMutes();
  const wavPath = join(tmpdir(), `premiere-mcp-${label}-${Date.now()}.wav`);
  let renderError: unknown = null;

  await evaluate(`
    var seq = __seq();
    if (!seq) return __error("No active sequence");
    var tracks = seq.audioTracks;
    var keep = [${list(keep)}];
    var applied = [];
    for (var t = 0; t < tracks.numTracks; t++) {
      var wanted = true;
      for (var k = 0; k < keep.length; k++) { if (keep[k] === t) wanted = false; }
      tracks[t].setMute(wanted ? 1 : 0);
      applied.push(tracks[t].isMuted());
    }
    return __result({ mutes: applied });
  `);

  try {
    await renderWithFoundPreset("Waveform Audio", wavPath, "entire", timeoutMs);
  } catch (error) {
    renderError = error;
  }

  const restored = await evaluate<{ mutes: boolean[] }>(`
    var seq = __seq();
    if (!seq) return __error("No active sequence");
    var tracks = seq.audioTracks;
    var wanted = [${originalMutes.map((muted) => (muted ? "1" : "0")).join(",")}];
    var applied = [];
    for (var t = 0; t < tracks.numTracks && t < wanted.length; t++) {
      tracks[t].setMute(wanted[t]);
      applied.push(tracks[t].isMuted());
    }
    return __result({ mutes: applied });
  `).catch((error: unknown) => {
    throw new Error(
      `Rendered the isolated tracks but could not put the track mute states back (${String(error)}). Audio tracks other than ${keep.join(", ")} may still be muted in the timeline; check them before exporting.`,
    );
  });

  if (renderError) {
    try {
      rmSync(wavPath, { force: true });
    } catch {
      /* the temp render is disposable */
    }
    throw renderError;
  }

  try {
    const audio = decodeWav(readFileSync(wavPath));
    return {
      audio,
      originalMutes,
      mutesRestored:
        restored.mutes.length === originalMutes.length &&
        restored.mutes.every((muted, index) => muted === originalMutes[index]),
      durationSeconds: Math.round((audio.frames / audio.sampleRate) * 100) / 100,
    };
  } finally {
    try {
      rmSync(wavPath, { force: true });
    } catch {
      /* the temp render is disposable */
    }
  }
}

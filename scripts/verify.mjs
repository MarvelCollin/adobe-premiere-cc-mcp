#!/usr/bin/env node
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

const HERE = dirname(fileURLToPath(import.meta.url));
const SERVER = join(HERE, "..", "dist", "index.js");
const SCRATCH = join(tmpdir(), "premiere-mcp-verify");
const DESTRUCTIVE = process.argv.includes("--destructive");

const child = spawn(process.execPath, [SERVER], { stdio: ["pipe", "pipe", "pipe"] });
child.stderr.on("data", () => {});

const pending = new Map();
let inbox = "";
child.stdout.on("data", (chunk) => {
  inbox += chunk.toString();
  let newline;
  while ((newline = inbox.indexOf("\n")) >= 0) {
    const line = inbox.slice(0, newline).trim();
    inbox = inbox.slice(newline + 1);
    if (!line) continue;
    try {
      const message = JSON.parse(line);
      const resolve = pending.get(message.id);
      if (resolve) {
        pending.delete(message.id);
        resolve(message);
      }
    } catch {
      continue;
    }
  }
});

let nextId = 1;
function request(method, params, timeoutMs = 240_000) {
  const id = nextId++;
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ error: { message: `no reply within ${timeoutMs}ms` } }), timeoutMs);
    pending.set(id, (message) => {
      clearTimeout(timer);
      resolve(message);
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", id, method, params })}\n`);
  });
}

async function call(name, args = {}) {
  const reply = await request("tools/call", { name, arguments: args });
  if (reply.error) return { ok: false, text: `transport: ${reply.error.message}` };
  return { ok: !reply.result?.isError, text: String(reply.result?.content?.[0]?.text ?? "") };
}

const results = [];
async function check(label, name, args) {
  const { ok, text } = await call(name, args);
  results.push({ label, ok, detail: ok ? text.replace(/\s+/g, " ").slice(0, 100) : text.slice(0, 200) });
  process.stdout.write(`${ok ? "ok  " : "FAIL"}  ${label}\n`);
  if (!ok) process.stdout.write(`        ${text.split("\n")[0].slice(0, 200)}\n`);
  return { ok, text };
}

function finish() {
  const failed = results.filter((r) => !r.ok);
  process.stdout.write("\n==== summary ====\n");
  for (const r of results) process.stdout.write(`${r.ok ? "ok  " : "FAIL"}  ${r.label.padEnd(26)} ${r.detail}\n`);
  process.stdout.write(`\n${results.length - failed.length}/${results.length} passed\n`);
  if (!DESTRUCTIVE) {
    process.stdout.write("\nSkipped destructive checks. Re-run with --destructive on a scratch project.\n");
  }
  child.kill();
  process.exit(failed.length === 0 ? 0 : 1);
}

await request("initialize", {
  protocolVersion: "2024-11-05",
  capabilities: {},
  clientInfo: { name: "verify", version: "1" },
});
child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" })}\n`);

const connection = await check("ping", "ping", {});
if (!connection.ok) {
  process.stdout.write("\nPremiere is not reachable, so nothing else can run.\n");
  finish();
}

const timeline = await check("get_timeline", "get_timeline", {});
if (!timeline.ok) finish();

const sequence = JSON.parse(timeline.text);
const videoClips = sequence.videoTracks[0]?.clips ?? [];
const audioClips = sequence.audioTracks[0]?.clips ?? [];
if (videoClips.length === 0) {
  process.stdout.write("\nThe active sequence has no clips on V1, so clip checks cannot run.\n");
  finish();
}

const firstVideo = videoClips[0].nodeId;
const lastVideo = videoClips[videoClips.length - 1].nodeId;
const firstAudio = audioClips[0]?.nodeId;
const midpoint = Math.min(sequence.durationSeconds / 2, videoClips[0].end - 0.1);

await check("get_clip", "get_clip", { node_id: firstVideo });
await check("get_playhead", "get_playhead", {});
await check("set_playhead", "set_playhead", { time_seconds: midpoint });
await check("list_project_items", "list_project_items", { limit: 20 });
await check("list_sequences", "list_sequences", {});
await check("list_effects", "list_effects", { kind: "video", filter: "lumetri" });
await check("list_transitions", "list_transitions", { filter: "dissolve" });
await check("list_export_presets", "list_export_presets", { filter: "Match Source", limit: 5 });
await check("get_stabilizer_status", "get_stabilizer_status", {});
await check("get_sequence_range", "get_sequence_range", {});
await check("check_edit", "check_edit", {});
await check("get_grade", "get_grade", {});
await check("export_frame", "export_frame", {
  output_path: join(SCRATCH, "verify_frame.png"),
  time_seconds: midpoint,
});

if (!DESTRUCTIVE) finish();

await check("add_marker", "add_marker", { time_seconds: midpoint, name: "verify", comment: "verification run" });
await check("list_markers", "list_markers", {});
await check("delete_marker", "delete_marker", { time_seconds: midpoint });
await check("create_bin", "create_bin", { name: `VerifyBin_${Date.now()}` });
await check("set_track_state mute", "set_track_state", { track_type: "audio", track_index: 0, muted: true });
await check("set_track_state unmute", "set_track_state", { track_type: "audio", track_index: 0, muted: false });
await check("set_clip_enabled off", "set_clip_enabled", { node_id: lastVideo, enabled: false });
await check("set_clip_enabled on", "set_clip_enabled", { node_id: lastVideo, enabled: true });
await check("set_scale", "set_scale", { node_id: firstVideo, scale: 100 });
await check("set_lumetri", "set_lumetri", { node_id: firstVideo, contrast: 10 });
await check("set_sequence_range", "set_sequence_range", {
  in_seconds: 0,
  out_seconds: Math.max(1, Math.round(sequence.durationSeconds / 2)),
});
if (videoClips.length > 1) {
  await check("grade_clips", "grade_clips", {
    node_ids: [firstVideo, videoClips[1].nodeId],
    contrast: 10,
  });
  await check("match_grade", "match_grade", {
    source_node_id: firstVideo,
    target_node_ids: [videoClips[1].nodeId],
  });
}
if (firstAudio) await check("set_audio_level", "set_audio_level", { node_id: firstAudio, db: -20 });
await check("set_fade", "set_fade", { node_id: firstVideo, fade_in_seconds: 0.5 });
await check("apply_effect", "apply_effect", { node_id: lastVideo, effect_name: "Gaussian Blur" });
await check("set_stabilizer_mode", "set_stabilizer_mode", { node_id: firstVideo, mode: "no_motion" });
const longestClip = videoClips.reduce((best, clip) =>
  clip.end - clip.start > best.end - best.start ? clip : best,
);
if (longestClip.end - longestClip.start > 0.5) {
  await check("add_transition", "add_transition", {
    node_id: longestClip.nodeId,
    transition_name: "Cross Dissolve",
    at: "end",
  });
} else {
  results.push({
    label: "add_transition",
    ok: true,
    detail: "skipped, no clip long enough to carry a transition",
  });
}

const items = JSON.parse((await call("list_project_items", { limit: 100 })).text);
const media = items.items.find((entry) => entry.kind === "media" && /\.(mp4|mov|mxf)$/i.test(entry.name));
if (media && sequence.videoTracks.length > 1) {
  const parkAt = Math.round(sequence.durationSeconds + 2);
  const placed = await check("add_to_timeline", "add_to_timeline", {
    item_id: media.nodeId,
    track_type: "video",
    track_index: 1,
    time_seconds: parkAt,
    mode: "overwrite",
  });
  if (placed.ok) {
    const node = JSON.parse(placed.text).placed?.nodeId;
    if (node) {
      await check("trim_clip", "trim_clip", { node_id: node, edge: "end", time_seconds: parkAt + 3 });
      await check("move_clip", "move_clip", { node_id: node, time_seconds: parkAt + 1 });
      await check("set_clip_speed", "set_clip_speed", { node_id: node, speed_percent: 200 });
      await check("remove_clip cleanup", "remove_clip", { node_id: node, ripple: false });
    }
  }
}

const splitAt = Math.round((longestClip.start + (longestClip.end - longestClip.start) / 2) * 100) / 100;
const split = await check("split_clip", "split_clip", { track_type: "video", track_index: 0, time_seconds: splitAt });
if (split.ok) {
  const after = JSON.parse((await call("get_timeline")).text);
  const victim = after.videoTracks[0].clips.find((clip) => Math.abs(clip.start - splitAt) < 0.05);
  if (victim) await check("remove_clip", "remove_clip", { node_id: victim.nodeId, ripple: false });
}

if (media) {
  const scratchName = `Scratch_${Date.now()}`;
  const made = await check("create_sequence_from_items", "create_sequence_from_items", {
    name: scratchName,
    item_ids: [media.nodeId],
  });
  if (made.ok) {
    await check("set_active_sequence", "set_active_sequence", { sequence: sequence.name });
  }
}

await check("save_project", "save_project", {});
finish();

import { beforeEach, describe, expect, it, vi } from "vitest";

const sent: string[] = [];

vi.mock("../src/bridge/client.js", () => ({
  BRIDGE_DIR: "test-bridge",
  evaluate: async (body: string) => {
    sent.push(body);
    return {};
  },
  sendScript: async (script: string) => {
    sent.push(script);
    return { ok: true, data: {} };
  },
}));

const { allTools } = await import("../src/tools/index.js");
const { wrapScript } = await import("../src/bridge/script.js");

const SAMPLE_ARGS: Record<string, Record<string, unknown>> = {
  get_clip: { node_id: "000f4241" },
  set_scale: { node_id: "000f4241", scale: 100 },
  set_lumetri: { node_id: "000f4241", contrast: 12, saturation: 110 },
  set_audio_level: { node_id: "000f425b", db: -14 },
  set_fade: { node_id: "000f4241", fade_in_seconds: 0.5, fade_out_seconds: 0.5 },
  list_effects: { kind: "video", filter: "lumetri" },
  apply_effect: { node_id: "000f4241", effect_name: "Lumetri Color" },
  list_transitions: { filter: "dissolve" },
  add_transition: { node_id: "000f4241", transition_name: "Cross Dissolve", at: "end" },
  set_stabilizer_mode: { node_id: "000f4241", mode: "no_motion" },
  export_frame: { output_path: "C:/tmp/frame.png", time_seconds: 12 },
  list_export_presets: { filter: "H.264", limit: 5 },
  export_sequence: { output_path: "C:/tmp/out.mp4", preset_path: "C:/tmp/preset.epr" },
  analyse_loudness: { target: "social", range: "entire" },
  normalise_loudness: { target: "social", track_index: 0, range: "entire" },
  get_timeline: { detail: "full", track_type: "both", empty_tracks: true },
  check_media: { limit: 200 },
  critique_edit: { platform: "reels" },
  review_sequence: { output_dir: "C:/tmp/review", frames: 4 },
  attach_proxy: { item_id: "000f4242", proxy_path: "C:/tmp/proxy.mp4" },
  relink_media: { item_id: "000f4242", new_path: "C:/tmp/moved.mp4" },
  run_script: { code: "return __result({ ok: 1 });" },
  set_playhead: { time_seconds: 6 },
  set_track_state: { track_type: "audio", track_index: 0, muted: true },
  add_marker: { time_seconds: 5, name: "beat", comment: "note" },
  delete_marker: { time_seconds: 5 },
  list_project_items: { limit: 50 },
  import_media: { file_paths: ["C:/tmp/clip.mp4"], bin_name: "Footage" },
  create_bin: { name: "Footage" },
  set_clip_enabled: { node_id: "000f4241", enabled: false },
  split_clip: { track_type: "video", track_index: 0, time_seconds: 4 },
  remove_clip: { node_id: "000f4241", ripple: true },
  add_to_timeline: { item_id: "000f4242", track_type: "video", track_index: 0, time_seconds: 3 },
  move_clip: { node_id: "000f4241", time_seconds: 8 },
  trim_clip: { node_id: "000f4241", edge: "end", time_seconds: 9 },
  set_clip_speed: { node_id: "000f4241", speed_percent: 200 },
  set_active_sequence: { sequence: "C0007" },
  create_sequence_from_items: { name: "Scratch", item_ids: ["000f4242"] },
  contact_sheet: { output_dir: "C:/tmp/sheet", track_index: 0, limit: 5 },
  grade_clips: { node_ids: ["000f4241", "000f4243"], contrast: 12, saturation: 110 },
  check_edit: { max_scale: 100, max_audio_db: 0 },
  set_sequence_range: { in_seconds: 1, out_seconds: 5 },
  analyse_frame: { time_seconds: 3 },
  detect_beats: { range: "entire", timeout_ms: 60000 },
  mark_beats: { grid: "downbeats", offset_seconds: 0, limit: 20, range: "entire", timeout_ms: 60000 },
  cut_to_beats: { track_index: 0, grid: "downbeats", offset_seconds: 0, limit: 10, range: "entire", timeout_ms: 60000 },
  analyse_clips: { track_index: 0, limit: 3 },
  match_grade: { source_node_id: "000f4241", target_node_ids: ["000f4243"] },
};

describe("generated ExtendScript", () => {
  beforeEach(() => {
    sent.length = 0;
  });

  for (const tool of allTools) {
    it(`${tool.name} generates a runnable script`, async () => {
      try {
        await tool.handler(SAMPLE_ARGS[tool.name] ?? {});
      } catch {
        // Tools that post-process a real file cannot finish against a mocked
        // bridge. The generated script is still what this test checks.
      }
      expect(sent.length, `${tool.name} sent nothing to the bridge`).toBeGreaterThanOrEqual(1);

      const script = sent[0];
      const body = script.includes("function __json(") ? script.slice(script.lastIndexOf("try {")) : script;
      expect(body).not.toContain("undefined");
      expect(body).not.toContain("[object Object]");
      expect(body).not.toContain("NaN");
      expect(script).toMatch(/__result\(|__error\(/);
    });
  }

  it("has sample arguments for every tool that requires them", () => {
    const missing = allTools
      .filter((tool) => Object.keys(tool.schema).length > 0 && !SAMPLE_ARGS[tool.name])
      .map((tool) => tool.name);
    expect(missing, "add these to SAMPLE_ARGS so their scripts get covered").toEqual([]);
  });

  it("wraps every tool body with the helper preamble", async () => {
    const tool = allTools.find((entry) => entry.name === "get_clip");
    await tool!.handler(SAMPLE_ARGS.get_clip);
    const full = wrapScript(sent[0]);
    expect(full).toContain("function __findClip(");
    expect(full).toContain("function __timecode(");
  });

  it("escapes quotes in user supplied values", async () => {
    const tool = allTools.find((entry) => entry.name === "create_bin");
    await tool!.handler({ name: 'Bin "One"' });
    expect(sent[0]).toContain('Bin \\"One\\"');
  });

  it("normalises Windows paths for the host", async () => {
    const tool = allTools.find((entry) => entry.name === "export_frame");
    await tool!.handler({ output_path: "C:/tmp/a/frame.png", time_seconds: 1 });
    expect(sent[0]).toContain("C:\\\\tmp\\\\a\\\\frame.png");
  });
});

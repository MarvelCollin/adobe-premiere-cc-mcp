# adobe-premiere-cc-mcp

An MCP server for driving Adobe Premiere Pro from an AI assistant.

The design goal is narrow: **a small set of tools that verify their own work.**
Every write reads the value back, and the ones that cannot be verified say so
rather than reporting a cheerful success. That matters because several Premiere
scripting calls return "No Error" while doing nothing at all.

Built and verified against **Premiere Pro 26.2** on Windows. Every tool listed
below has been run against a real project, not just typechecked, including the
destructive ones.

Paths may be passed with forward or backslashes; they are normalised before they
reach Premiere, because `exportAsMediaDirect` fails with a bare
`Error: Unknown Error` on forward slashes.

## How it works

```
assistant  <--stdio-->  MCP server  <--temp files-->  CEP panel  <--evalScript-->  Premiere
```

The server writes `cmd_<id>.jsx` into a shared temp folder. The CEP panel inside
Premiere claims it with an atomic rename, evaluates it, and writes
`res_<id>.json` back. Anything slower than two seconds also gets a
`busy_<id>.json` heartbeat, which is how the server tells "still working" apart
from "the panel is not running".

## Requirements

- Node.js 20.19+
- Adobe Premiere Pro with an MCP bridge CEP panel installed and running
- Adobe Media Encoder is **not** required; exports use Premiere's own encoder

## Setup

```bash
npm install
npm run build
```

Register it with your MCP client, for example:

```json
{
  "mcpServers": {
    "premiere": {
      "command": "node",
      "args": ["C:/BINUS/SELF/adobe-premiere-cc-mcp/dist/index.js"]
    }
  }
}
```

Then ask the assistant to call `ping`.

## Tools

<!-- tools:start -->

34 tools.

| Tool | Parameters | What it does |
| --- | --- | --- |
| `ping` | — | Check that Premiere is running and the bridge panel is alive. |
| `get_timeline` | — | Full picture of the active sequence: resolution, frame rate, duration, and every clip on every track with its node ID, timing, effects and Motion scale. |
| `get_clip` | `node_id` | Everything about one clip: timing, in-point, and every effect with all of its property values and keyframe state. |
| `get_playhead` | — | Current playhead position in the active sequence, in seconds and as timecode. |
| `set_playhead` | `time_seconds` | Move the playhead to a time in seconds and read the position back. |
| `set_track_state` | `track_type`, `track_index`, `muted` | Mute or unmute a video or audio track and read the state back. |
| `list_markers` | — | List every marker on the active sequence with its time, name and comment. |
| `add_marker` | `time_seconds`, `name`, `comment`, `duration_seconds` | Add a marker to the active sequence at a given time, then confirm it exists. |
| `delete_marker` | `time_seconds`, `tolerance_seconds` | Delete the marker nearest a given time, within a small tolerance, and report how many remain. |
| `list_project_items` | `limit` | List the project panel contents: bins and media, with the node ID of each. |
| `import_media` | `file_paths`, `bin_name` | Import one or more media files into the project panel and confirm the item count grew. |
| `create_bin` | `name` | Create a bin in the project panel and confirm it exists. |
| `set_clip_enabled` | `node_id`, `enabled` | Enable or disable a clip. |
| `split_clip` | `track_type`, `track_index`, `time_seconds` | Cut every clip on a track at the given time, the same as the razor tool. |
| `remove_clip` | `node_id`, `ripple` | Remove a clip from the timeline. |
| `add_to_timeline` | `item_id`, `track_type`, `track_index`, `time_seconds`, `mode` | Place a project item onto a track at a given time and confirm the clip count grew. |
| `move_clip` | `node_id`, `time_seconds` | Move a clip to a new start time on its own track and confirm it landed. |
| `set_clip_speed` | `node_id`, `speed_percent` | Change a clip's playback speed. |
| `trim_clip` | `node_id`, `edge`, `time_seconds` | Trim a clip's start or end on the timeline and confirm the new duration. |
| `set_scale` | `node_id`, `scale` | Set a clip's Motion scale and read it back to confirm. |
| `set_lumetri` | `node_id`, `exposure`, `contrast`, `highlights`, `shadows`, `whites`, `blacks`, `saturation`, `temperature`, `tint`, `look_intensity` | Set Lumetri Basic Correction values on a clip and read them back. |
| `set_audio_level` | `node_id`, `db` | Set a clip's audio level in decibels and read it back. |
| `set_fade` | `node_id`, `fade_in_seconds`, `fade_out_seconds` | Put a clean fade in and/or out on a clip: Opacity for video, Volume for audio. |
| `list_effects` | `kind`, `filter` | List every video or audio effect name Premiere can apply. |
| `apply_effect` | `node_id`, `effect_name` | Add a video or audio effect to a clip by name and confirm it attached. |
| `list_transitions` | `filter` | List every video transition name Premiere can apply, for use with add_transition. |
| `add_transition` | `node_id`, `transition_name`, `at` | Add a video transition at a clip's head or tail and confirm it appeared on the track. |
| `get_stabilizer_status` | — | Report Warp Stabilizer state for every clip that has it. |
| `set_stabilizer_mode` | `node_id`, `mode`, `max_scale` | Set Warp Stabilizer to 'no_motion' (locked static frame, what static-camera edits need) or 'smooth_motion' (keeps camera movement, smoothed). |
| `export_frame` | `output_path`, `time_seconds` | Write a full resolution still of the sequence at a given time. |
| `list_export_presets` | `filter`, `limit` | List Adobe .epr export presets on disk, including the ones Premiere ships itself. |
| `export_sequence` | `output_path`, `preset_path`, `timeout_ms` | Render the active sequence to a file using Premiere's own encoder; Adobe Media Encoder is not required. |
| `save_project` | — | Save the current project. |
| `run_script` | `code`, `timeout_ms` | Escape hatch: run raw ExtendScript in Premiere for anything the typed tools do not cover. |

<!-- tools:end -->

## Premiere behaviours worth knowing

These cost real debugging time and are encoded in the tools:

- **`getVideoEffectList()` returns an array of name strings**, not objects. Entries
  have no `.name` and the array has no `.numItems`. Effect objects must come from
  `getVideoEffectByName()`.
- **Keyframe times are absolute source time.** Stills and graphics sit near 3600s,
  so a keyframe written at `0.5` lands outside the clip and never fires.
- **New keyframes interleave with existing ones** rather than replacing them, which
  is how a fade ends up spiking to full mid-clip. Clear before writing.
- **`getKeys()` returns `undefined`**, not `[]`, when a property has no keyframes.
- **Warp Stabilizer never re-analyses from a script.** A clip can report the mode
  you set while being completely unstabilised. The tell is the auto-scale display
  name: a percentage means solved, a bare label means not analysed.
- **QE track item indexes count empty gaps**, so they do not match DOM clip indexes.
  Match on start time.
- **Creative Looks cannot be set by script.** The name property accepts a string but
  the LUT never loads. Pick looks in the Lumetri panel; only intensity is scriptable.
- **`exportAsMediaDirect` returns "No Error" even when it writes nothing**, so the
  file has to be checked on disk.

## Development

```bash
npm run dev      # tsc --watch
npm test         # vitest
npm run check    # typecheck + tests, no build
npm run build    # emit dist/
npm run verify   # run every tool against the open project
```

`npm run verify` covers the read-only tools. Add `-- --destructive` to also exercise
splitting, removing, importing and speed changes; that edits the open project, so
point it at a scratch one.

### Testing against a live Premiere without restarting your assistant

An MCP client loads the server once at startup, so a rebuild does not reach it
until the client restarts. `npm run smoke` skips the client entirely and drives
the built server over stdio the same way:

```bash
npm run build
npm run smoke                                    # read-only sweep
npm run smoke -- --list                          # tool names
npm run smoke -- ping
npm run smoke -- get_clip '{"node_id":"000f4241"}'
npm run smoke -- export_frame '{"output_path":"C:/tmp/check.png","time_seconds":12}'
```

That is the fast loop: edit, `npm run build`, `npm run smoke -- <tool>`. Restart
the assistant only when you want the new tools exposed to it.

## License

MIT

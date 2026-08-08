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

**Inspect**

| Tool | What it does |
| --- | --- |
| `ping` | Confirm Premiere and the bridge are alive |
| `get_timeline` | Every track and clip with node IDs, timing, effects, scale |
| `get_clip` | One clip in full, including every effect property |
| `get_playhead` | Playhead position in seconds and timecode |
| `list_project_items` | Bins and media in the project panel |
| `list_effects` / `list_transitions` | Exact names to pass to the apply tools |
| `list_export_presets` | Presets on disk, including Premiere's own |
| `get_stabilizer_status` | Which clips are actually solved, not just configured |

**Edit**

| Tool | What it does |
| --- | --- |
| `set_playhead` | Move the playhead, bounds checked |
| `add_to_timeline` | Place a project item on a track, insert or overwrite |
| `move_clip` | Move a clip to a new start time |
| `trim_clip` | Move a clip's head or tail |
| `set_clip_speed` | Change playback speed, confirms the new duration |
| `split_clip` | Razor a track at a time, verified by clip count |
| `remove_clip` | Ripple or lift a clip off the timeline |
| `set_clip_enabled` | Disable a shot without deleting it |
| `set_track_state` | Mute or hide a track |
| `add_marker` / `list_markers` / `delete_marker` | Sequence markers |
| `import_media` / `create_bin` | Bring footage in, optionally into a bin |

**Look and sound**

| Tool | What it does |
| --- | --- |
| `set_scale` | Set Motion scale, verified |
| `set_lumetri` | Basic Correction values, verified |
| `apply_effect` | Attach an effect by name, verified |
| `add_transition` | Transition at a clip edge, verified on the track |
| `set_stabilizer_mode` | No Motion vs Smooth Motion, reports if analysis is still needed |
| `set_audio_level` | Set level in dB, clears conflicting keyframes first |
| `set_fade` | Clean fade in/out on Opacity or Volume |

**Deliver**

| Tool | What it does |
| --- | --- |
| `export_frame` | Full resolution still, so you can look at the result |
| `export_sequence` | Render with Premiere's encoder, output verified on disk |
| `save_project` | Save; nothing auto-saves |
| `run_script` | Raw ExtendScript escape hatch |

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

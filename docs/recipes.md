# Recipes

Worked examples. Every one of these was run against Premiere Pro 26.2, not sketched.

## Start of session

```
ping
get_timeline
check_edit
```

`get_timeline` is compact by default: it reports how many effects each clip carries
rather than naming them. Ask for `detail: "full"` only when you need the names, and
narrow with `track_type` and `track_index` on a long edit.

`check_edit` is read-only and cheap. It reports upscaled clips, unsolved stabilisers,
audio above unity, gaps on the main video track, muted tracks, disabled clips, and clips
missing a grade while their neighbours have one.

Nothing auto-saves. Call `save_project` after a batch of edits.

## Look at your work

The single most valuable habit. A tool reporting success is not evidence.

```
export_frame(output_path="C:/tmp/check.png", time_seconds=12)
```

Then `Read` that PNG. It is a real full-resolution render, so it shows exactly what will
export.

## Grade a sequence properly

```
analyse_clips(track_index=0, limit=15)
```

This mutes every other video track for the pass and measures only the rectangle each
clip actually draws, so the numbers belong to the clip rather than to whatever is
composited above it. It returns a `byColourCast` grouping.

Then one call per group:

```
grade_clips(node_ids=[...], temperature=8, whites=12, contrast=8, saturation=108)
```

Grading each group separately is the whole point. A single correction across mixed
lighting is what makes an edit look amateur. Clips that need their own move get
`set_lumetri` afterwards, which only changes the fields you pass.

Verify with `export_frame`, then `get_grade` to see every clip's values side by side.

## Hit a loudness target

Premiere exposes no loudness measurement to scripting, so `analyse_loudness` renders the
sequence audio with the shipped `Waveform Audio 48kHz 16-bit` preset and measures it here
to ITU-R BS.1770.

```
analyse_loudness(target="social", range="in_to_out")
```

Targets are `social` -14, `streaming` and `podcast` -16, `broadcast` -23 LUFS. The
response gives the exact dB to move and warns when the peak ceiling means you cannot get
there without clipping.

To actually apply it:

```
normalise_loudness(target="social", range="in_to_out")
```

It moves every audio track, re-measures, and tells you whether it landed. Do not pass
`track_index` unless you really mean one track: loudness belongs to the whole mix, so
moving a single track undershoots whenever anything else is making noise.

It will not push the mix into clipping. If the gain needed would take the estimated true
peak above -1 dBFS it applies only what fits and reports the shortfall, unless you pass
`allow_clipping`.

## Export only part of a sequence

A sequence's reported duration can be longer than its last clip, which exports a black
tail. Bound it explicitly:

```
set_sequence_range(in_seconds=0, out_seconds=6)
export_sequence(output_path=..., preset_path=..., range="in_to_out")
```

`range` defaults to `entire`. Without it the in and out points are ignored.

## Build a nine up grid

The full worked example, and a good stress test of the server: nine clips playing at once
in a 1080x1920 frame.

Create the sequence from one clip so Premiere derives the settings without opening a
dialog, then add the tracks:

```
create_sequence_from_items(name="Trend_9Grid", item_ids=["<a clip>"])
run_script: __qe().addTracks(9 - seq.videoTracks.numTracks, seq.videoTracks.numTracks, 0,0,0,0,0)
```

Place one clip per track at time 0, trim them all to the same length, then scale. With
1080x1920 sources in a 1080x1920 sequence, `33.3333` gives exactly a 360x640 cell:

```
add_to_timeline(item_id=..., track_index=N, time_seconds=0)
trim_clip(node_id=..., edge="end", time_seconds=6)
set_scale(node_id=..., scale=33.3333)
```

There is no typed tool for position, so `run_script` sets Motion Position, which is
normalised to the frame. Cell centres for a 3x3 grid are `1/6`, `1/2`, `5/6`:

```
var found = __findClip(nodeId);
var pos = __property(__component(found.clip, "Motion"), "Position");
pos.setValue([0.166667, 0.166667], true);
```

Note `__findClip` returns a wrapper, so it is `found.clip`, not the clip itself.

Finish with `set_fade` on each cell, music on A1 via `add_to_timeline` with
`track_type: "audio"`, and `check_edit` to confirm the whole thing is clean before
exporting.

One trap worth knowing: adding a clip to a **video** track also drops its **camera audio**
onto an audio track. Nine cells therefore give you nine audio tracks playing at once
under your music. Mute or remove them with `set_track_state` before you export, and check
`get_timeline(track_type="audio")` rather than assuming.

## Judge whether an edit is ready to post

```
critique_edit(platform="reels")
```

Read only and fast, since it works from the timeline rather than rendering. It reports
the format, how often the picture changes, what happens in the opening seconds, and
whether anything on screen carries the message without sound, then lists what departs
from that platform's norms.

The thresholds are not taste. The opening seconds decide whether a viewer stays, short
form expects a meaningful visual change every two to three seconds, and most short form
viewing is muted, so an edit carrying its message only in audio loses most of its
audience.

It cannot see composition. Pair it with `review_sequence` and actually read the stills,
and with `analyse_loudness` for level.

A worked example: a nine up grid where every cell started at the same moment scored zero
visual changes in the opening three seconds. Staggering the cell entrances two tenths of
a second apart took it from ten cuts per minute to ninety, and from failing to postable.

## When a tool seems to do nothing

- `set_clip_speed` holds the clip's slot on the timeline unless there is room to grow, so
  the duration often does not change. Check `appliedSpeedPercent`, not `durationAfter`.
- Warp Stabilizer never re-analyses from a script. `get_stabilizer_status` tells you
  whether a clip is genuinely solved; a bare `Auto-scale` label means it is not.
- Any modal dialog freezes the bridge until it is dismissed. That is why sequences are
  created with `create_sequence_from_items` rather than the modal route.
- `contact_sheet` and `analyse_clips` both hide the other video tracks by default, so a
  still shows the clip it is named after. If you wanted the finished composite, pass
  `isolate: false` to `contact_sheet`.

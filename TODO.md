# Roadmap

Where this project is going, in rough priority order. Anything marked "unverified"
has been written and typechecked but never run against a live Premiere.

## Status today

- 30 tools, TypeScript, `npm run check` green (typecheck + 15 tests).
- Verified live on Premiere Pro 26.2: `ping`, `get_timeline`, `get_clip`,
  `get_stabilizer_status`, `list_effects`, `list_export_presets`.
- Transport is the **existing signed CEP panel from another project**. That is the
  one piece of the stack we do not own.

---

## Phase 1 — trust what we shipped

- [ ] Smoke every unverified tool against a scratch project, not the real edit:
      `set_playhead`, `set_track_state`, `add_marker`, `list_markers`,
      `delete_marker`, `list_project_items`, `import_media`, `create_bin`,
      `set_clip_enabled`, `split_clip`, `remove_clip`, `set_scale`, `set_lumetri`,
      `set_audio_level`, `set_fade`, `apply_effect`, `list_transitions`,
      `add_transition`, `set_stabilizer_mode`, `export_frame`, `export_sequence`,
      `save_project`.
- [ ] Build a throwaway fixture project so destructive tools are never tested on
      real work.
- [ ] Record each result in a table in the README, so "verified" means something.
- [ ] Fix whatever the sweep breaks.

## Phase 2 — own the whole stack

The CEP panel is currently borrowed. Replacing it is the difference between "our
server" and "our tool".

- [ ] Write our own minimal CEP panel: poll the temp folder, `evalScript`, write
      the response, heartbeat while busy. The protocol is a handful of files.
- [ ] Self-sign it. Unsigned extensions do **not** load on this machine, proven the
      hard way. Needs Adobe `ZXPSignCmd` and a self-signed certificate.
- [ ] Ship an installer script (`npm run install-panel`) that copies the bundle,
      sets `PlayerDebugMode`, and reports what it did.
- [ ] Panel UI: connection state, last command, error log. Debugging blind is slow.
- [ ] Only after the above: drop the dependency on the other project entirely.

## Phase 3 — close the editing gaps

Ordered by how often the gap actually bit us:

- [ ] `add_to_timeline` — put a project item on a track at a time. The biggest hole;
      right now we can inspect and modify but not assemble.
- [ ] `move_clip` and `trim_clip` — needs care, DOM start/end setters behave
      differently for stills and video.
- [ ] `set_clip_speed` — including reverse and audio pitch handling.
- [ ] `create_sequence` and sequence settings.
- [ ] Selection tools — select by name, range, colour label. Cheap and useful for
      batch operations.
- [ ] Work area and sequence in/out points, for partial exports.
- [ ] Proxy attach/detach and offline media handling.

## Phase 4 — workflows, not just verbs

Single tools are a means; the value is a whole job done correctly.

- [ ] `grade_by_group` — read every clip, cluster by lighting, apply per-group
      Basic Correction in one pass. This is the thing we did by hand and is easy to
      get wrong.
- [ ] `check_edit` — one report: upscaled clips, unsolved stabilisers, clipping
      audio, keyframe envelopes that spike, transitions without handles.
- [ ] `contact_sheet` — export a frame per clip and assemble them, so a grade can
      be judged at a glance instead of one frame at a time.
- [ ] Loudness pass: measure and normalise to a target, rather than setting dB by
      hand and hoping.

## Phase 5 — make it a real package

- [ ] GitHub Actions: build + test on push. No badge without a workflow behind it.
- [ ] Per-tool script-generation tests (snapshot the generated ExtendScript) so a
      refactor cannot silently change what runs inside Premiere.
- [ ] Generate the tool reference in the README from the registry, so docs cannot
      drift from code.
- [ ] Publish to npm once Phase 1 and 2 are done. Not before: an unverified tool
      that reports success is worse than no tool.
- [ ] Decide on public vs private for the repo.

---

## Known Premiere limits to revisit

These are host constraints, not bugs in our code. Each is worth re-testing on a
new Premiere release.

- **Creative Look cannot be set by script.** The name property accepts a string but
  the LUT never loads. Only intensity is scriptable. Would need a UXP path or an
  automated UI click to fix.
- **No way to remove a single effect.** QE offers only "remove all". A workaround
  is to record the effect stack, clear it, and re-add everything except the target.
- **Track deletion has no working API.** `Sequence > Delete Tracks` in the UI only.
- **Adjustment layers cannot be created by script.**
- **Warp Stabilizer never re-analyses from a script**, and its solve did not
  survive a project close/reopen in testing. Investigate whether the analysis is
  cached anywhere we can prime, or whether this always needs a UI click.
- **`openDocument` did not open a project** from the Home screen; the call returned
  cleanly and nothing loaded. Either find the correct call or document the UI route.

## Open questions

- Is the stabiliser solve genuinely discarded on reopen, or does Premiere
  re-analyse lazily when it renders? Changes whether a re-export is safe.
- Does the file-based bridge hold up under rapid sequential calls, or do we need a
  request queue in the client?
- `get_timeline` returns everything. At what sequence size does that become too
  large to hand to a model, and should it paginate by track?
- Worth supporting macOS, or is Windows enough?

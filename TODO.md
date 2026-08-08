# Roadmap

Where this project is going, in rough priority order.

## Status today

- 46 tools, TypeScript, `npm run check` green (typecheck + 69 tests), CI green on push.
- Every tool verified live on Premiere Pro 26.2, destructive ones included.
  `npm run verify -- --destructive` reruns the whole sweep on demand.
- All 46 exercised end to end against a nine up grid built in `Prau.prproj`
  (`Trend_9Grid`), which is what surfaced the four defects fixed below. A grid is
  a better test bed than a normal cut because nine tracks are live at once, so
  anything that quietly measures or exports the wrong thing has nowhere to hide.
- Transport is **our own signed CEP panel**, installed with `npm run install-panel`.
  Nothing in the stack is borrowed any more.

---

## Phase 1 — trust what we shipped — done

- [x] Smoke every tool against a live project.
- [x] Fix what the sweep broke: forward-slash paths made `export_sequence` fail with
      `Error: Unknown Error`. All host paths are normalised now, with a regression test.
- [x] Checked-in verification script, one command, read-only by default.
- [x] Scratch sequence creation so destructive checks do not need the real edit.

## Phase 2 — own the whole stack — done

The panel was the one borrowed piece. It is ours now, written from the protocol and
signed with our own certificate.

- [x] Write our own CEP panel: polls the temp folder, `evalScript`, writes the
      response, heartbeats while busy, with a status UI and its own bridge folder
      (`premiere-mcp-link`) so it cannot clash with the borrowed one.
- [x] `npm run install-panel` copies it and sets `PlayerDebugMode`.
- [x] Signed it. Unsigned sideloading is refused on this machine even with
      `PlayerDebugMode` set to `1` as `REG_SZ` on CSXS 9 to 14 and every extension ID
      listed in `.debug`, so signing is mandatory rather than optional.
      `npm run sign-panel` generates a self-signed certificate and packages a `.zxp`.
- [x] Panel UI showing connection state, counts and a live command log.
- [x] **Dependency dropped.** The server defaults to `%TEMP%\premiere-mcp-link`,
      which only our panel serves, and the full read-only sweep passes 12/12 through
      it. The other project's panel is no longer involved.
- [ ] Test the panel on a machine that has never had the other project installed,
      to be sure nothing here depends on its leftovers.
- [ ] macOS support in `install-panel`; the copy path exists but is untested.

## Phase 3 — remaining editing gaps

- [x] `add_to_timeline`, `move_clip`, `trim_clip`, `set_clip_speed`.
- [x] `create_sequence_from_items`, `list_sequences`, `set_active_sequence`.
- [ ] Selection tools: select by name, range or colour label. Deliberately skipped:
      every tool addresses clips by node ID, so selection adds a mode without adding
      capability. Revisit only if a workflow actually needs the UI selection.
- [x] Sequence in and out points, for partial exports. Work area is readable;
      Premiere exposes no setter worth trusting, so in/out is the supported route.
- [x] Proxy and offline media handling: `check_media`, `attach_proxy`, `relink_media`.
      All three verified live. `check_media` reports the link state of every item and
      says `clean` when nothing is offline; `attach_proxy` confirms with `hasProxy()`
      rather than trusting the call; `relink_media` goes through `changeMediaPath`,
      since `unlinkMedia` and `relinkMedia` do not exist on this build, and errors if
      the item is still offline afterwards.
- [ ] Proxy **detach**, and generating proxies. Premiere has no scripted detach that we
      found, and it does not generate proxies from a script at all, so the file must
      already exist. Both are Media Encoder or UI work.
- [ ] ~~Audio track mixer levels, as opposed to per clip levels.~~ **Blocked, with
      evidence.** The classic audio track exposes only clips, id, mediaType, name and
      transitions, and the QE audio track exposes only `setMute` and `isMuted`; there is
      no `setVolume`, `getVolume` or `setPan` on either. The fader is visible as a track
      component whose `matchName` is `AudioFader`, but that component exposes nothing
      beyond id, name and matchName, with no property accessor of any kind. Per clip
      levels via `set_audio_level` remain the only scriptable route.

## Phase 4 — workflows

- [x] `check_edit` — one report for upscaled clips, unsolved stabilisers, hot audio,
      gaps, muted tracks and ungraded clips.
- [x] `contact_sheet` — a still per clip, so a grade can be judged across the edit.
- [x] `grade_clips` — apply one correction to a whole shot group in a single pass.
- [x] `get_grade` — read every clip's grade at once for comparison.
- [x] `match_grade` — copy a reference clip's correction onto others.
- [x] `get_sequence_range` and `set_sequence_range` for partial exports. The range is
      now actually honoured by `export_sequence`; until Phase 6 it was set but unused.
- [x] `analyse_loudness` — measure in LUFS to ITU-R BS.1770 and say how far the mix is
      from a delivery target. Premiere genuinely exposes no loudness measurement, so
      the tool renders the sequence audio with the shipped `Waveform Audio 48kHz 16-bit`
      preset, decodes the WAV here and does the maths itself: K-weighting, 400ms blocks
      at 75% overlap, absolute gate at -70 LUFS then the relative gate at -10 LU.
      The K-weighting coefficients are derived analytically rather than hardcoded at
      48kHz, so any sample rate works, and they reproduce the BS.1770 table to 1e-14.
      Checked against EBU Tech 3341 sine cases: all within 0.02 LU of the expected
      value, against a tolerance of 0.1. Digital silence correctly measures as nothing
      rather than as a number.
- [ ] Normalise to a target, as opposed to only measuring. `analyse_loudness` already
      returns the exact gain needed; applying it means walking the clips on a track and
      offsetting each level, which is easy, but the peak ceiling has to be respected or
      a quiet mix gets pushed into clipping.


## Phase 5 — make it a real package

- [x] GitHub Actions running typecheck, tests and build on push.
- [x] Script-generation tests so a refactor cannot silently change what runs inside
      Premiere, plus a guard that every tool is covered.
- [x] Tool reference generated from the registry into the README.
- [ ] Publish to npm. Now unblocked: `npm run sign-panel` and `npm run install-panel`
      make the install story complete on Windows. Needs a decision on shipping the
      signed `.zxp` in the package or having users sign their own.
- [ ] Decide public vs private for the repo. Currently public.

---

## Phase 6 — what the nine up grid caught — done

Four defects, none of which the earlier sweeps could see because they all pass on a
single track edit. Every one of them reported success while doing the wrong thing.

- [x] **`analyse_clips` measured the sequence composite, not the clip.** It exported a
      full frame at each clip's midpoint and attributed the whole frame's numbers to
      that clip, so on the grid all nine clips returned byte identical stats, and on
      the real edit the V1 readings were partly measuring the V2 overlay and the title
      graphics above it. It now mutes every other video track for the pass and measures
      only the rectangle the clip actually draws, computed from Motion Position, Scale
      and the source dimensions, then restores the mute states. Verified against nine
      cells measured independently outside Premiere: exact match, including the
      rectangle origins.
- [x] **`export_sequence` ignored the in and out points.** `ENCODE_ENTIRE` was
      hardcoded, so `set_sequence_range` could never affect an export and the grid
      rendered 9.6s including 3.6s of black tail. Added a `range` argument
      (`entire`, `in_to_out`, `work_area`). Same sequence now exports 6.0s exactly.
- [x] **`get_grade` never reported `tint`.** `grade_clips`, `set_lumetri` and
      `match_grade` all write and read it, so a tint move was invisible to the one tool
      meant for comparing grades across shots. Added it.
- [x] **`set_clip_speed` confirmed the wrong thing.** It promised "twice as long" and
      returned a duration that often does not change, because the clip keeps its slot
      unless there is room to grow. A caller checking `durationAfter` would conclude it
      failed when the speed had applied fine. It now reads the speed back off the QE
      clip and returns `appliedSpeedPercent`, erroring if Premiere disagrees.

`contact_sheet` has the same composite blind spot as `analyse_clips` had: it names each
still after a clip but captures whatever the sequence shows, so a disabled clip writes a
black frame under that clip's name. Left as is for now, since the stills are meant to be
looked at rather than measured, but it should either isolate the same way or say so.

## Known Premiere limits

Host constraints, not bugs in our code. Worth re-testing on each Premiere release.

- **Creative Look cannot be set by script.** The name property accepts a string but
  the LUT never loads. Only intensity is scriptable.
- **No way to remove a single effect.** QE offers only "remove all".
- **Track deletion has no working API.** `Sequence > Delete Tracks` in the UI only.
- **Adjustment layers cannot be created by script.**
- **Warp Stabilizer never re-analyses from a script**, and its solve did not survive
  a project close and reopen. `check_edit` reports this rather than hiding it.
- **`createNewSequence` opens a modal dialog** and blocks the bridge until dismissed.
  `createNewSequenceFromClips` is the headless route and is what we use.
- **Any modal dialog freezes the bridge.** The client now says so on timeout.
- **`openDocument` did not open a project** from the Home screen; it returned cleanly
  and nothing loaded.

## Open questions

- Is the stabiliser solve genuinely discarded on reopen, or re-analysed lazily?
  Decides whether a re-export is safe.
- ~~Does the file bridge hold up under rapid sequential calls?~~ Answered: 20
  concurrent `ping` calls all succeeded in 276ms, and 20 sequential ones in 2.9s
  (~147ms each, dominated by the poll intervals). No request queue needed. Dropping
  the panel poll below 150ms would cut latency if it ever matters.
- `get_timeline` returns everything. At what sequence size is that too large to hand
  to a model, and should it paginate by track?
- Worth supporting macOS, or is Windows enough?

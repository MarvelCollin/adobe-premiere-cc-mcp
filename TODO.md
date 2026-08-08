# Roadmap

Where this project is going, in rough priority order.

## Status today

- 53 tools, TypeScript, `npm run check` green (typecheck + 76 tests). CI runs the check on
  Windows and Linux across Node 20 and 22, and separately proves the published tarball
  carries the signed panel and no certificate, and that the generated tool table is not
  stale.
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
- [x] `normalise_loudness` — measure, apply the gain, then re-measure and report whether
      the target was actually reached. It moves every audio track by default. The first
      cut took a `track_index` and defaulted to A1, which is wrong: loudness is a
      property of the whole mix, so moving one track undershoots silently whenever
      anything else makes noise. Caught by normalising a grid whose camera audio sat on
      eight other tracks; a 9 dB clip move shifted the sequence by 2.9 dB. It now also
      respects a -1 dBFS true peak ceiling, applying only the gain that fits and saying
      how much was left. Verified: needed 10.43 dB, applied 10.25, landed at -14.26 LUFS
      with the peak exactly on the ceiling.


## Phase 5 — make it a real package

- [x] GitHub Actions running typecheck, tests and build on push.
- [x] Script-generation tests so a refactor cannot silently change what runs inside
      Premiere, plus a guard that every tool is covered.
- [x] Tool reference generated from the registry into the README.
- [x] Decided: **ship our own signed `.zxp`**, so an install depends on nothing of
      Adobe's and nothing of anyone else's. `artifacts/PremiereMcpLink.zxp` is now
      committed and listed in `files`; `install-panel` already prefers it over the panel
      source, so `npm install` gives a working bridge with no signing step. The private
      key (`tools/*.p12`) and Adobe's `ZXPSignCmd.exe` stay ignored and are confirmed
      absent from the tarball. Anyone who would rather not trust our certificate can
      still run `npm run sign-panel` and build their own; `SECURITY.md` says so plainly.
- [ ] Actually run `npm publish`. The name `adobe-premiere-cc-mcp` is unclaimed, the
      tarball is 86 kB across 98 files, and `prepublishOnly` runs typecheck, tests and
      build first. Only needs `npm login`.
- [ ] `os` in `package.json` declares `win32` and `darwin`. Only `win32` is tested; the
      macOS install path is written but has never run.
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

`contact_sheet` had the same composite blind spot and has since been fixed the same way;
see Phase 7.

## Phase 7 — what looking at the screen caught

The API sweep reported 43/44 passing while quietly damaging the project. Only opening
Premiere and looking at the timeline found it.

- [x] **The verify sweep leaked an audio clip into the active sequence on every
      destructive run.** `add_to_timeline` places a clip on a *video* track and Premiere
      also drops its linked audio onto an audio track; cleanup removed only the video
      node. Three orphan clips had accumulated at 12s, 25s and 38s of a real sequence.
      The sweep now removes the linked audio too and asserts it, and the whole run is
      45/45. Worth remembering as a class of bug: every tool can pass while the job as a
      whole is wrong, because nothing asserted what was left behind.
- [x] `contact_sheet` now isolates the clip's track like `analyse_clips` does, so a still
      shows the clip it is named after rather than the composite. `isolate: false` keeps
      the old behaviour when the finished frame is what you want.
- [x] Confirmed against Premiere's own Effect Controls that the tools' writes are real:
      a grid cell reported as position 0.5, 0.1667 at scale 33.3 reads as 540.0, 320.0
      and 33.3 in the UI. Reading a value back through the same API is good; seeing it in
      the interface is better.

## Phase 8 — stale claims and quiet lies

- [x] **CI had been red on every push since the packaging commit**, while the README
      advertised a passing badge. Cause was ours: an `os` field of `win32,darwin` makes
      `npm ci` fail with `EBADPLATFORM` on a Linux runner. The field guarded against
      installing on a platform Premiere does not run on anyway, so it is gone. CI now
      runs on Windows and Linux across Node 20 and 22, which is also the first time the
      primary platform has ever been tested.
- [x] CI now proves two things that were previously only checked by hand: that the
      published tarball contains the signed panel and no certificate or signing binary,
      and that the generated tool table in the README is not stale.
- [x] **`analyse_frame` past the end of a sequence reported a pure black frame as a
      real measurement**, complete with a neutral colour cast and grading suggestions.
      Anything past the last clip renders empty, so the numbers described nothing. It now
      refuses out of range times outright, and any frame that measures as fully black is
      flagged with `blankFrame` and has its suggestions suppressed, since a gap or a
      disabled clip can produce one inside the sequence too.
- [x] **`move_clip` destroyed whatever was in the way while promising it would not.**
      Its description said the move fails if another clip occupies the destination; in
      fact Premiere's QE move overwrites, and the tool only checked that the clip landed,
      never that the space was free. Moving a clip onto a neighbour silently deleted the
      neighbour. It now scans the lane for anything overlapping the destination span and
      refuses, naming what is in the way, unless `overwrite` is passed. Found by testing
      the tool's own documented guarantee rather than its happy path.
- [x] **`remove_clip` reported `rippled: true` by echoing the argument**, not by
      checking. QE's remove often does not ripple, so a gap was left behind while the
      response claimed otherwise. It now records where the following clip sat, compares
      afterwards, and returns `gapClosed` with a warning when a requested ripple did not
      happen.
- [x] Node version was claimed three different ways: `20.19+` in the README, `>=18` in
      `engines`, and only 20 tested in CI. Node 18 is end of life, so it is `>=20` now,
      stated once and tested on 20 and 22.

## Phase 7 — structure

- [x] Shared `src/premiere/encoder.ts` for the export scope mapping and preset discovery,
      which `export_sequence` and the loudness tools had each grown their own copy of,
      and `src/premiere/still.ts` for the frame export that `analyse_frame`,
      `analyse_clips` and `review_sequence` all need.
- [x] Split `review.ts`, which had become four unrelated concerns at 331 lines, into
      `review.ts` (check_edit), `grade-read.ts` (get_grade, match_grade) and
      `overview.ts` (review_sequence, contact_sheet). Largest file is now 243 lines
      across 40 modules.
- [ ] The ExtendScript still lives as template strings inside tool handlers. It works and
      the generated-script tests cover it, but a `src/host/` layer of named script
      builders would separate what runs in Premiere from how a tool is declared. Worth
      doing before the tool count grows much further.

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
- **`sequence.end` is read only in practice.** Assigning to it raises no error and
  changes nothing, so a sequence whose clips were trimmed keeps its original longer end
  and an unbounded export writes a black tail. The in and out range plus
  `range: "in_to_out"` is the only fix; `critique_edit` checks for exactly this.

---

## Platform risk: CEP and ExtendScript are on the way out

Worth knowing before investing further, established by research rather than guesswork.

- Premiere Pro 2026 ships **UXP** as the supported extensibility platform. CEP still
  works — this server is the proof, running against 26.2 — but Adobe has said new
  development goes to UXP and that CEP will eventually stop being loaded.
- Reports of a hard **September 2026 ExtendScript cutoff** exist, but Adobe has not
  published a firm date and third party developers note the timeline is deliberately
  vague. Treat it as a real direction rather than a scheduled outage, and do not panic
  rewrite on the strength of a forum summary.
- What a migration would cost here: UXP calls are asynchronous and do not block the UI,
  which suits this server's bridge model well. The hard part is that **QE DOM has no UXP
  equivalent**, and this project depends on QE for adding tracks, transitions, clip
  speed and frame export. Those would need new routes or would be lost.
- Sensible next step is not a rewrite. It is a spike: check whether UXP exposes frame
  export, track creation and Lumetri writes, since those decide whether a port is even
  possible. Until then CEP is the correct choice.

### Spike result, from the published UXP reference and Adobe's own samples

Documentation only. Nothing here has been run, because running it means building a UXP
plugin, and that is the next piece of work rather than something to assume.

- **Effects, transitions and keyframes: likely fine.** Adobe's `premiere-api` sample
  panel covers "projects, sequences, markers, metadata, effects, transitions, keyframes,
  source monitor, import/export, encoder". Lumetri is not named specifically, so the
  Basic Correction writes this project depends on need confirming, but the category is
  clearly present.
- **Media export: likely fine.** The same sample lists an encoder and import/export, so
  `export_sequence` should have a route.
- **Frame export: not documented anywhere.** No PNG still export appears in the Sequence
  class or the samples. This is the serious one. `export_frame`, `analyse_frame`,
  `analyse_clips`, `contact_sheet` and `review_sequence` all rest on
  `qe.exportFramePNG`, which is undocumented QE in the first place. Measurement and
  visual verification are what make this project worth using, and they are exactly what
  has no visible UXP replacement.
- **Adding tracks: not documented.** The Sequence class exposes `getVideoTrack`,
  `getAudioTrack`, `getCaptionTrack` and counts, but no creation. A nine up grid needs
  nine tracks, so this blocks that whole class of work.
- **In and out points: present**, through a `SetInPointAction` and `SetOutPointAction`.
- The API is action based and asynchronous rather than synchronous like ExtendScript,
  which actually suits this server's request and response bridge well.

**Conclusion.** A port is not currently possible without losing frame export and track
creation. The honest next step is a throwaway UXP plugin that tries exactly those two
things and reports back, before any porting work is planned. If frame export genuinely
has no UXP route, that is worth raising with Adobe on the forums, since it removes the
ability to see what a script did.

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

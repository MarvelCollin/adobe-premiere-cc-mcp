# Roadmap

Where this project is going, in rough priority order.

## Status today

- 41 tools, TypeScript, `npm run check` green (typecheck + 64 tests), CI green on push.
- Every tool verified live on Premiere Pro 26.2, destructive ones included.
  `npm run verify -- --destructive` reruns the whole sweep on demand.
- Transport is **our own signed CEP panel**, installed with `npm run install-panel`.
  Nothing in the stack is borrowed any more.

---

## Phase 1 — trust what we shipped — done

- [x] Smoke every tool against a live project.
- [x] Fix what the sweep broke: forward-slash paths made `export_sequence` fail with
      `Error: Unknown Error`. All host paths are normalised now, with a regression test.
- [x] Checked-in verification script, one command, read-only by default.
- [x] Scratch sequence creation so destructive checks do not need the real edit.

## Phase 2 — own the whole stack

The CEP panel is borrowed. Replacing it is the difference between "our server" and
"our tool". This is now the largest remaining gap.

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
- [ ] Selection tools: select by name, range or colour label. Lower value than
      expected, since tools address clips by node ID rather than by selection.
- [ ] Work area and sequence in/out points, for partial exports.
- [ ] Proxy attach and detach, offline media handling.
- [ ] Audio track mixer levels, as opposed to per clip levels.

## Phase 4 — workflows

- [x] `check_edit` — one report for upscaled clips, unsolved stabilisers, hot audio,
      gaps, muted tracks and ungraded clips.
- [x] `contact_sheet` — a still per clip, so a grade can be judged across the edit.
- [x] `grade_clips` — apply one correction to a whole shot group in a single pass.
- [x] `get_grade` — read every clip's grade at once for comparison.
- [ ] Loudness pass: measure and normalise to a target instead of setting dB by hand.
      Needs an actual loudness measurement, which Premiere does not expose to
      scripting; may require rendering audio and analysing it outside Premiere.
- [ ] `match_grade`: copy one clip's Basic Correction onto others as a starting point.

## Phase 5 — make it a real package

- [x] GitHub Actions running typecheck, tests and build on push.
- [x] Script-generation tests so a refactor cannot silently change what runs inside
      Premiere, plus a guard that every tool is covered.
- [x] Tool reference generated from the registry into the README.
- [ ] Publish to npm. Not before Phase 2: the install story is incomplete while the
      panel comes from somewhere else.
- [ ] Decide public vs private for the repo. Currently public.

---

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
- Does the file bridge hold up under rapid sequential calls, or is a request queue
  needed in the client?
- `get_timeline` returns everything. At what sequence size is that too large to hand
  to a model, and should it paginate by track?
- Worth supporting macOS, or is Windows enough?

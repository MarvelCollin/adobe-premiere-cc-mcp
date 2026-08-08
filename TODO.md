# Roadmap

## The goal

Match a working professional. Not "an assistant that can drive Premiere" but a tool
that makes the judgements an expert colourist, editor, sound mixer and QC operator
would make, and can defend each one with a number.

The design rule is **one tool per expert capability, not one per API call**. Other
Premiere servers ship 279 to 1,027 tools that wrap individual scripting calls, which
leaves every expert decision to the model. Ours puts the expertise inside the tool:
`analyse_clips` renders and measures rather than exposing `getClipScale`. That is why
the surface stays small while the capability grows. Small is a consequence, not the
target.

## Where the line is

A tool ships when it can be checked. Everything here either measures something real,
or verifies its own write. Anything that would need taste alone is left to the model,
with measurements handed to it.

## Status

- 56 tools, 95 tests, live sweep clean, CI green on Windows and Linux across Node 20 and 22.
- Own signed CEP panel. Nothing borrowed.
- Measurement already real: BS.1770 loudness, per-clip image statistics, spectral flux
  beat tracking validated against synthesised click tracks.

---

## Phase A — the colourist's instruments

We measure single numbers per frame today. A colourist works from scopes and matches
shots by them. Waveform for luminance, RGB parade for balance, vectorscope for hue and
saturation, and the skin tone line, which sits near 123 degrees because the red of
blood under skin is the same for everyone.

- [ ] `read_scopes` — waveform, RGB parade, vectorscope and histogram computed from a
      rendered frame and returned as data. A rendered PNG of the scope is a bonus, the
      numbers are the point.
- [ ] Skin tone measurement: isolate likely skin pixels, report their mean angle against
      the 123 degree line and the deviation, since that is the single most reliable
      objective check on whether faces look right.
- [ ] `match_shots` — measure a reference clip and a target clip, then compute the
      lift, gamma and gain moves that bring the target's parade and vectorscope onto the
      reference. Apply, re-measure, report the residual error. This is the tool that
      turns "grade by eye" into "grade by numbers".
- [ ] White balance from a neutral: given a point or region expected to be grey, compute
      and apply the temperature and tint that neutralise it.
- [ ] Broadcast legality: flag luma outside 16 to 235 and out of gamut chroma, which is
      a hard delivery failure rather than a matter of taste.

## Phase B — editorial craft

Research is unanimous on what separates professional cutting: split edits, cutting on
action, and pacing that follows the content rather than a metronome.

- [ ] `make_split_edit` — J and L cuts. Audio leads or trails the picture cut. Needs
      audio and video unlinked and trimmed independently; verify the offset landed.
- [ ] `find_action_peaks` — frame differencing across a clip to find the motion peak, so
      a cut can land on the action rather than near it.
- [ ] `analyse_pacing` — shot length distribution, longest and shortest holds, and where
      the rhythm stalls, measured against the platform norms already used by
      `critique_edit`.
- [ ] `check_continuity` — compare adjacent shots for framing similarity and flag likely
      jump cuts, where two shots are close enough to jar but not close enough to match.
- [ ] Extend `cut_to_beats` with a musical structure pass: cut density that follows
      sections rather than an even grid.

## Phase C — audio post

Dialogue is where amateur work is most obvious, and every step here is measurable.

- [ ] `clean_dialogue` — the standard chain applied and verified: high pass near 80 Hz to
      kill rumble, compression around 3:1 to 4:1 to even out level, de-ess for harshness.
- [ ] `duck_music` — detect speech presence from the rendered stems and keyframe the music
      bed underneath it, rather than setting one static level for the whole timeline.
- [ ] True peak and phase coherence checks alongside the loudness we already measure.
      Broadcast wants -24 LKFS with a -2 dBTP ceiling; streaming and social differ, and
      the targets are already in `analyse_loudness`.
- [ ] Silence and clipping detection per clip, so a dead mic or a distorted take is found
      before delivery rather than after.

## Phase D — quality control

This is the part a professional never skips and an amateur never does. Every check here
is objective, which makes it a natural fit.

- [ ] `check_delivery` — black frames, freeze frames, flash frames, colour bars left in,
      and illegal levels, in one pass over the rendered file.
- [ ] Photosensitive epilepsy screening. The published threshold is a luminance swing
      above roughly 20 cd/m squared, faster than 3 Hz, across more than a quarter of the
      frame. This is a duty of care check, not a nicety.
- [ ] Verify an exported file against its intended spec: resolution, frame rate, bitrate,
      duration and loudness, so "it exported" becomes "it exported correctly".

## Phase E — composition

The honest phase. Headroom, lead room and the rule of thirds all need to know where the
subject is, and Premiere gives a script no subject detection at all.

- [ ] Research whether subject position can be inferred well enough from saliency and
      edge density alone to be worth shipping. If it cannot, say so here and stop.
- [ ] The 180 degree rule and eyeline matching need to understand screen direction across
      shots. Likely out of reach without real vision models. Documented rather than faked.

## Phase F — packaging

- [ ] Publish to npm, deferred by the user for now. The signed panel already ships in the
      tarball and CI proves no key leaks into it.
- [ ] macOS install path, written but untested.
- [ ] `src/host/` layer so ExtendScript stops living inside tool handlers. The last
      structural debt.

---

## Premiere limits found so far

Host constraints, not our bugs. Re-test on each release.

- Captions and titles cannot be created by script at all. This is the one open
  `critique_edit` warning that can only be fixed in the UI.
- Creative Looks cannot be set by script; the name property accepts a string but the LUT
  never loads. Only intensity is scriptable.
- No way to remove a single effect. QE offers only remove all.
- Track deletion has no working API.
- Adjustment layers cannot be created by script.
- Warp Stabilizer never re-analyses from a script, and its solve does not survive a
  project reopen.
- `createNewSequence` opens a modal and freezes the bridge. `createNewSequenceFromClips`
  is the headless route.
- Any modal dialog freezes the bridge until dismissed.
- UXP has no documented frame export or track creation, so it cannot replace CEP without
  losing measurement.

## Open questions

- Tempo trackers confuse half and double time. We now report both, but choosing between
  them needs musical structure, not autocorrelation.
- `get_timeline` returns everything. At what sequence size does that stop fitting in a
  model's context, and should it paginate by track?
- Is the Warp Stabilizer solve discarded on reopen, or re-analysed lazily? Decides
  whether a re-export is safe.

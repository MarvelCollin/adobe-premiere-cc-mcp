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

- 64 tools, 182 tests, live sweep clean, CI green on Windows and Linux across Node 20 and 22.
- Own signed CEP panel. Nothing borrowed.
- Measurement already real: BS.1770 loudness, per-clip image statistics, spectral flux
  beat tracking validated against synthesised click tracks.

---

## Phase A — the colourist's instruments

We measure single numbers per frame today. A colourist works from scopes and matches
shots by them. Waveform for luminance, RGB parade for balance, vectorscope for hue and
saturation, and the skin tone line, which sits near 123 degrees because the red of
blood under skin is the same for everyone.

- [x] `read_scopes` — waveform percentiles, RGB parade, vectorscope and illegal level
      share from a rendered frame. Refuses to describe a blank frame.
- [x] Skin tone measurement against the 123 degree line, with a verdict on which way it
      is off.
- [x] `match_shots` — measures both clips, plans the moves, applies, re-measures and
      corrects again. Damped to 0.6 so it converges instead of oscillating, and stops
      when the weighted error stops falling by 5 percent. Reports the residual honestly
      when two shots are lit too differently to match with primaries.
- [ ] White balance from a neutral: given a point or region expected to be grey, compute
      and apply the temperature and tint that neutralise it.
- [ ] Broadcast legality: flag luma outside 16 to 235 and out of gamut chroma, which is
      a hard delivery failure rather than a matter of taste.

## Phase B — editorial craft

Research is unanimous on what separates professional cutting: split edits, cutting on
action, and pacing that follows the content rather than a metronome.

- [x] `make_split_edit` — J and L cuts, verified by reading the audio and picture
      boundaries back separately.
- [x] `find_action_peaks` — frame differencing with an absolute floor, so a locked off
      shot reports no action rather than inventing peaks from noise.
- [ ] `analyse_pacing` — shot length distribution, longest and shortest holds, and where
      the rhythm stalls, measured against the platform norms already used by
      `critique_edit`.
- [ ] `check_continuity` — compare adjacent shots for framing similarity and flag likely
      jump cuts, where two shots are close enough to jar but not close enough to match.
- [ ] Extend `cut_to_beats` with a musical structure pass: cut density that follows
      sections rather than an even grid.

## Phase C — audio post

Dialogue is where amateur work is most obvious, and every step here is measurable.

- [x] `clean_dialogue` — high pass and compression applied and then measured back. The
      threshold is read off the level the track actually peaks at, because a threshold set
      from the average sits under everything and turns the whole take down instead of
      levelling it, which is what the first version did. Proof of work is the gap between
      the loud and quiet stretches narrowing, not the crest factor: a 10 ms attack never
      catches single sample transients, so crest barely moves either way. No de-esser; see
      the parameter note below.
- [x] `duck_music` — isolates the dialogue track by muting the rest for one measurement
      render, so what triggers the duck is what is on that track rather than the music
      itself. Multiplies the clip's existing envelope instead of flattening it, so a fade
      survives, and reports the measured duck depth so a second pass laid on top of the
      first shows up as -24 dB rather than being silently accepted as -12.
- [ ] De-esser. The mapping for its Center Frequency, Bandwidth and Threshold is not pinned
      down, and a de-esser aimed at the wrong band does audible harm. Left out rather than
      guessed. The route is the same one that worked for the EQ: decode the shipped defaults,
      then confirm against a rendered measurement.
- [ ] True peak and phase coherence checks alongside the loudness we already measure.
      Broadcast wants -24 LKFS with a -2 dBTP ceiling; streaming and social differ, and
      the targets are already in `analyse_loudness`.
- [ ] Silence and clipping detection per clip, so a dead mic or a distorted take is found
      before delivery rather than after.

## Phase D — quality control

This is the part a professional never skips and an amateur never does. Every check here
is objective, which makes it a natural fit.

- [x] `check_delivery` — black frames, freezes and flashing, collapsed into ranges
      rather than one finding per sampled frame.
- [x] Photosensitive epilepsy screening to the published threshold: a large luminance
      swing across more than a quarter of the frame, faster than 3 Hz. Says plainly when
      the sample interval was too coarse to be sure.
- [ ] Colour bars left in, and illegal level checking over a rendered file rather than
      sampled frames.
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

- Audio effect parameters come through scripting as bare 0 to 1 floats with no name, no
  unit and no range. `Cutoff` reads 0.25 and nothing says whether that is Hz, a fraction of
  Nyquist or something else. This is the strongest argument against a server that just wraps
  scripting calls: handing a model `setValue(0.25)` is handing it nothing.
  Worked out so far, in `src/premiere/audio-params.ts`:
  - Parametric Equalizer frequencies: `v = (Hz - 20) / 23980`. Found by decoding the shipped
    defaults, which come out as 50, 200, 800, 3200 and 12800 Hz, a clean four times series.
    Confirmed against rendered audio: asking for 500 Hz measured -2.99 dB at 500 Hz, and
    asking for 1500 Hz put the -3 dB point at 1506 Hz.
  - Single-band Compressor: threshold `-60 + 60v`, ratio `1 + 29v`, attack `500v` ms,
    release `5000v` ms, makeup `-30 + 60v` dB. Every one reproduces the shipped default.
    Makeup confirmed by render: v=0.6 measured +6.01 dB.
  - Still unknown: the legacy standalone Highpass, whose 0.25 default does not fit the EQ
    mapping, and everything on the DeEsser.
- Keyframe interpolation between values written by script is not linear. Plateaus are exact,
  ramps curve. Write the endpoints you care about as keyframes rather than trusting the shape
  in between.
- Captions and titles cannot be created by script at all. This is the one open
  `critique_edit` warning that can only be fixed in the UI.
- Creative Looks cannot be set by script; the name property accepts a string but the LUT
  never loads. Only intensity is scriptable.
- No way to remove an effect at all, single or otherwise. QE's `removeEffects` is documented
  as remove-all but on 26.2 it returns cleanly and removes nothing, with any argument list;
  `removeAudioEffects` does not exist. Tested on a clip carrying nine audio effects, count
  unchanged after every variant. Anything that adds an effect is therefore one way from a
  script, which is why `clean_dialogue` reconfigures a component it finds rather than adding
  a second one.
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

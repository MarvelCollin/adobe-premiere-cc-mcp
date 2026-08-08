# Grading

How to decide what correction a shot needs, rather than guessing and calling it a look.

## Measure first

`analyse_clips` reports, per clip, the black point, white point, contrast range, mean
luma, mean saturation and a colour cast. Those numbers decide the grade; the eye is for
confirming it afterwards.

It measures only the rectangle the clip actually draws and mutes the other video tracks
while it works, so on a multi-track edit the numbers still belong to the clip rather than
to whatever sits above it.

## Read the numbers

- **Black point well above 0** (say 30 or more) means milky shadows. Pull `blacks` down
  until it approaches 0. A black point of 45 usually wants `blacks` near -60, not -20;
  the control is not linear and a timid move leaves the shot flat.
- **White point well below 255** means dull highlights. Raise `whites`. Below about 180
  is visibly soft.
- **Contrast range under 140** is a flat shot. It is either log footage, haze, or an
  overcast sky, and it wants both ends moved rather than a contrast slider alone.
- **Clipped whites above about 2%** cannot be recovered. Lower `highlights` before doing
  anything else, because every later move makes the clipping more obvious.
- **Mean luma under 70** is underexposed for most footage. Raise `exposure` in small
  steps; it is the most destructive control in the panel.
- **Colour cast** comes from the channel averages. Blue heavy reads cold, so raise
  `temperature`. Red heavy reads warm, so lower it. Green heavy is usually foliage
  bounce, and `tint` is the fix, not `temperature`.

## Group before correcting

Clips sharing a colour cast and a similar contrast range belong in one group, and one
`grade_clips` call should serve the whole group. What makes an edit look amateur is a
single blanket correction across mixed lighting, or worse, a per-clip grade that makes
neighbouring shots jump.

`analyse_clips` returns a `byColourCast` grouping to start from. Split a group further
when the contrast ranges differ by more than about 40.

After the group pass, individual outliers get `set_lumetri`, which only changes the
fields you pass, so it layers cleanly on top of the group correction.

## Looks, by content

The creative Look cannot be selected by script, only its intensity, so the LUT is chosen
once in Lumetri Color > Creative > Look and the strength is scripted afterwards.

- **Outdoor, open sky, golden hour** — 40-60%. There is already colour in the scene, so
  the look is seasoning.
- **Harsh midday** — 20-40%. Contrast is already brutal and a strong look crushes it
  further.
- **Overcast, haze, log** — 50-70%. Flat footage is what looks actually help.
- **Interior, mixed artificial light** — 20-30%, and fix the white balance first. A look
  applied over a colour cast multiplies the cast.
- **Night** — under 30%. Looks tend to lift blacks, which is the opposite of what a night
  shot needs.

100% on uncorrected footage is the classic mistake. Correct first, then season.

## Confirm

`export_frame` a representative frame per group and `Read` it. Then `get_grade` to see
every clip's values side by side; a group that was meant to match should read identically.

If a tint or temperature move looks wrong in the frame but right in the numbers, trust
the frame and re-measure — a cast can come from a large coloured object rather than from
the white balance.

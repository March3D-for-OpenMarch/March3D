# March3D --- OpenMarch Notes Instruction Guide

**March3D version:** 0.3.34\
**Applies to:** The marching and color guard instruction update.

March3D can read special commands written in **OpenMarch page/set
notes**. These commands control marcher facing, instrument position,
marching cadence, and color guard equipment animations in the March3D
viewer.

## Getting started

1.  Open your drill in **OpenMarch**.
2.  Select the page/set whose movement you want to control.
3.  Open its **Notes**.
4.  Add the heading `March3D Instructions:` on its own line.
5.  Put one command per line below the heading.
6.  Open or reload the `.dots` file in March3D to pick up saved note
    changes.

**Basic example:**

``` text
March3D Instructions:
Count 1 Brass Horn Down
Count 4 Brass Horn Up
Count 1 Guard Switch To Flag
Count 5 Guard Spinning
```

Only lines **after** the `March3D Instructions:` heading are interpreted
as commands. Other ordinary notes can remain above the heading. Commands
are case-insensitive.

### General syntax

``` text
Count <number> <target> <action>
Count <number> <target> <action> For <number> Counts
Count <number> <target> Face <direction> For <number> Counts over <left|right>
```

`Count <number>` is optional; omitting it defaults to **Count 1**. For
commands supporting a duration, omitting `For ... Counts` defaults to
**1 count**.

Commands are associated with the OpenMarch page containing the note.
They begin on the specified written count of the movement into that set.

## Command reference

### Instrument / horn position

  Command        Effect
  -------------- --------------------------------
  `Horn Up`      Raises the targeted instrument
  `Horns Up`     Same as `Horn Up`
  `Horn Down`    Lowers the targeted instrument
  `Horns Down`   Same as `Horn Down`

``` text
March3D Instructions:
Count 1 Brass Horn Down
Count 5 Trumpets Horn Up
Count 8 Baritones Horn Down
```

Horn-down angles depend on the instrument model. These commands change
the displayed instrument pose, not OpenMarch's audio.

### Facing and turns

  -------------------------------------------------------------------------------
  Command                                     Effect
  ------------------------------------------- -----------------------------------
  `Face Frontfield`                           Turns toward the front sideline

  `Face Backfield`                            Turns toward the back sideline

  `Face Frontfield For 2 Counts over right`   Smooth frontfield turn over 2
                                              counts, via right shoulder

  `Face Backfield For 4 Counts over left`     Smooth backfield turn over 4
                                              counts, via left shoulder
  -------------------------------------------------------------------------------

``` text
March3D Instructions:
Count 1 w8, w7, w9 Face Frontfield For 2 Counts over right
Count 2 w10, w22 Face Frontfield For 2 Counts over left
Count 5 Woodwinds Face Backfield
```

If no shoulder is specified, March3D uses its default shortest-turn
behavior. If no duration is specified, the turn takes **1 count**.

### Marching cadence

  Command         Effect
  --------------- -----------------------------
  `Full Time`     One step per written count
  `Double Time`   Two steps per written count
  `Double`        Alias for `Double Time`
  `Mark Time`     Animate stepping in place

``` text
March3D Instructions:
Count 1 Brass Double Time
Count 5 Brass Full Time
Count 9 Woodwinds Mark Time
Count 13 Woodwinds Full Time
```

**Important:** `Mark Time` currently changes the leg animation only. It
**does not cancel or freeze movement between OpenMarch dots**.
`Full Time` is the default cadence.

### Color guard equipment

  Command              Effect
  -------------------- ----------------------------------------
  `No Equipment`       Hide the guard member's equipment
  `Has Equipment`      Show equipment again
  `Switch To Flag`     Display a flag
  `Switch To Rifle`    Display a rifle
  `Switch To Riffle`   Accepted alternate spelling of `Rifle`
  `Switch To Saber`    Display a simplified saber
  `Switch To Sabre`    Accepted alternate spelling of `Saber`

``` text
March3D Instructions:
Count 1 Guard Switch To Flag
Count 5 Guard No Equipment
Count 7 Guard Has Equipment
Count 9 Guard Switch To Rifle
Count 13 Guard Switch To Saber
```

`Switch To` also makes the selected equipment visible. These commands
affect color guard members, not the rest of the band.

### Color guard spinning and tossing

  -----------------------------------------------------------------------
  Command                             Effect
  ----------------------------------- -----------------------------------
  `Spinning`                          Continuous equipment rotation: one
                                      full cycle per written count

  `Spining`                           Accepted alternate spelling of
                                      `Spinning`

  `Tossing`                           One-count toss by default

  `Tossing For 2 Counts`              Toss lasting two written counts
  -----------------------------------------------------------------------

``` text
March3D Instructions:
Count 1 Guard Switch To Flag
Count 3 Guard Spinning
Count 7 Guard Tossing For 2 Counts
Count 10 Guard Switch To Rifle
Count 12 Guard Spinning
```

**Animation timing:** Spinning and tossing use the **written-beat/drill
timeline**, not real-world elapsed time. Pausing, scrubbing, or changing
playback speed should reproduce the same equipment pose at the same
drill position.

**Current implementation notes:** - Spinning is a simple continuous
rotation, not a choreographed routine. - Tossing is a simplified arc and
rotation, returning to the carry pose at the end of the specified
duration. - A later `Spinning` or `Tossing` command replaces the
previous guard motion; there is not currently a dedicated
`Stop Spinning` command.

## Targeting performers

Write the target between the count and the action.

  Target                         Example
  ------------------------------ --------------------------------------
  Everyone                       `Count 1 All Full Time`
  Everyone (alias)               `Count 1 Everyone Full Time`
  Brass                          `Count 1 Brass Horn Down`
  Woodwinds                      `Count 1 Woodwinds Face Backfield`
  Drumline                       `Count 1 Drumline Double Time`
  Battery (alias)                `Count 1 Battery Double Time`
  Color guard                    `Count 1 Guard Switch To Flag`
  Color guard (aliases)          `Color Guard`, `Colorguard`
  Tubas                          `Count 1 Tubas Horn Down`
  Baritones                      `Count 1 Baritones Horn Down`
  Exact OpenMarch section name   `Count 1 Trumpets Horn Up`
  One marcher                    `Count 1 w8 Face Backfield`
  Several marcher IDs            `Count 1 w8, w7, w9 Face Frontfield`
  Marcher ID range               `Count 1 w3-w9 Face Frontfield`

March3D matches section names using the OpenMarch section labels. If a
group target does not work, use the exact section name or individual
marcher IDs.

## Complete example

Paste this into an OpenMarch page's notes:

``` text
March3D Instructions:
Count 1 Brass Horn Down
Count 1 w8, w7, w9, w15 Face Frontfield For 2 Counts over right
Count 2 w10, w22, w20 Face Frontfield For 2 Counts over left
Count 3 Guard Switch To Flag
Count 4 Guard Spinning
Count 5 Brass Double Time
Count 7 Guard Tossing For 2 Counts
Count 9 Brass Full Time
Count 10 Guard Switch To Rifle
Count 12 Woodwinds Mark Time
Count 16 Woodwinds Full Time
Count 16 Brass Horn Up
```

## Tips and troubleshooting

-   **Use one command per line.** Each command must match the syntax
    shown above.
-   **Put the heading on its own line:** `March3D Instructions:`.
-   **Count numbers start at 1.** A missing count means Count 1.
-   **Commands generally persist** until another instruction changes the
    same state. A facing command persists after the turn completes; a
    cadence change persists until replaced.
-   **Check the target spelling.** An unrecognized target will not match
    a marcher.
-   **Save and reload the drill** if March3D is still displaying older
    notes.
-   **For smooth turns**, use `For 2 Counts over right` or
    `For 2 Counts over left`.
-   **For repeatable guard motion**, test playback, pause, scrub, and
    page boundaries. Equipment poses should be based on drill time.
-   **For a stationary hold**, do not rely on `Mark Time` to override
    OpenMarch's dot path.

## Current limitations

These instructions change **March3D visualization**, not the OpenMarch
drill data or playback controls.

The current version does **not** include dedicated note commands for
`Slide`, `Forward March`, `Backward March`, `Stop Spinning`, or complex
multi-part guard routines. March3D calculates normal marching/slide
direction from the drill path and its built-in movement rules.

------------------------------------------------------------------------

*March3D v0.3.34 --- OpenMarch Notes Instruction Guide*

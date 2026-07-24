# Quick Start

This walkthrough takes you from an empty project to a routed board. It assumes
nothing beyond a modern browser.

## 1. Create a project

From the home dashboard, choose **New Project**. Give it a name — Ziro Designer
creates the schematic and board files for you and keeps them in sync.

## 2. Capture the schematic

1. Open the **Schematic Editor**.
2. Press `A` (or use the left toolbar) to place a symbol, and pick one from the
   library chooser.
3. Wire pins together with the **Wire** tool (`W`). Junctions form
   automatically where wires meet.
4. Label nets and add power symbols as needed.

See [Drawing a Schematic](/schematic/drawing) for the full workflow.

## 3. Move to the board

Switch to the **PCB Editor**. Your components come across as footprints, linked
to the schematic by the ratsnest — the thin lines showing which pads must
connect.

## 4. Place and route

1. Drag footprints into position (`M` to move, `G` to drag with traces).
2. Route with the **Route Tracks** tool — click pad to pad; the ratsnest
   updates live.
3. Add vias to change layers, and pour a ground zone if you need one.

See [Placing Footprints](/pcb/placement) and [Routing & Vias](/pcb/routing).

## 5. Generate outputs

When the board is done, generate **Gerbers and drill files**, and preview them
in the [Gerber Viewer](/tools/gerber-viewer) before sending them to your
fabricator.

::: tip That's the loop
Schematic → board → route → outputs, all in one browser tab, sharing one
project. Everything else in these docs goes deeper on each step.
:::

_This page is a work in progress; screenshots and a sample project will be added._

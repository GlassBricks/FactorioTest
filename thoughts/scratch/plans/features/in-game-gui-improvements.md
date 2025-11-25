# In-Game GUI Improvements

## Overview

Improve the in-game test GUI to be less awkward, with better layout, UX, and performance.

## Current GUI Components

### Progress GUI (`mod/factorio-test/test-gui.ts`)

- Title bar with mod name and close button
- Status text showing current test path
- Progress bar with test count
- Test count table (5 columns: failed, errors, skipped, todo, passed)
- Output scroll pane (600px) with text boxes per message
- Rerun button

### Config GUI (`mod/control/mod-select-gui.ts`)

- Mod selection dropdown
- Run button
- Custom mod text field

## Proposed Improvements

### Better Output Display

- Collapsible groups by describe block
- Search/filter capability
- Revise test count table to just test summary line

### Enhanced Interactivity

- Allow closing during tests
- Note any active test failures/focused tests
- Re-run button for failed tests only
- Interactive tests filter

## Files to Modify

| File                            | Changes                 |
| ------------------------------- | ----------------------- |
| `mod/factorio-test/test-gui.ts` | Main GUI restructure    |
| `mod/control/mod-select-gui.ts` | Config GUI improvements |
| `mod/control/test-gui.ts`       | Close behavior changes  |

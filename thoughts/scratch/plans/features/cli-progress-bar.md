# CLI Progress Bar

## Overview

Add a progress bar and richer terminal output during test runs, giving users visual feedback on test execution.

## Current State

The CLI currently:
- Prints "Running tests..." at start
- Streams test messages if `--show-output` is enabled
- Prints final result: "Test run result: [passed|failed|todo]"
- Uses `BufferLineSplitter` to parse Factorio stdout line-by-line

The in-game GUI already has progress tracking with test counts and a progress bar.

## Proposed Output

```
Running tests for my-mod...

[████████████░░░░░░░░] 60% (30/50)
✓ 25 passed  ✗ 3 failed  ○ 2 skipped

Currently running: describe block > test name
```

## Progress Data Requirements

The CLI needs:
- Total test count (before tests start)
- Tests completed count
- Pass/fail/skip/todo counts
- Currently running test name

## Communication Protocol

Add new marker for progress updates:
```
FACTORIO-TEST-PROGRESS:{"total":50,"ran":30,"passed":25,"failed":3,"skipped":2,"todo":0,"current":"test name"}
```

Emit this:
- Once at `testRunStarted` with total count
- After each test completes with updated counts

## Files to Modify

| File | Changes |
|------|---------|
| `mod/factorio-test/builtin-test-event-listeners.ts` | Emit progress markers |
| `cli/run.ts` | Parse progress markers, render progress bar |
| `cli/package.json` | Add progress bar library (cli-progress, ora, etc.) |

## Progress Bar Libraries

Options:
- `cli-progress` - Full-featured progress bars
- `ora` - Spinners with text
- `progress` - Simple progress bars
- Custom implementation using ANSI escape codes

## Terminal Considerations

- Detect if stdout is a TTY (skip fancy output if piped)
- Handle terminal width for responsive progress bar
- Clear/update lines using ANSI codes for smooth updates
- Fall back to simple output for non-TTY environments

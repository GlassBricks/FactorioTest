# Per-Test Log Capture

## Overview

Capture log output for each test in the CLI and display logs when tests fail, making debugging easier.

## Current State

The mod outputs test messages wrapped in markers:
- `FACTORIO-TEST-MESSAGE-START` / `FACTORIO-TEST-MESSAGE-END` wrap log output
- Test lifecycle is signaled via messages (test entered, passed, failed, etc.)
- CLI parses these markers and streams output to stdout

Logs are currently printed immediately without association to specific tests.

## Proposed Behavior

CLI-only change:
- Buffer log messages between test start and test end markers
- On test pass: discard buffered logs (or show with `--verbose`)
- On test fail: print buffered logs with the failure

## Implementation

In `cli/run.ts`, track current test and buffer logs:

```typescript
let currentTestLogs: string[] = []
let currentTestName: string | undefined

// When parsing lines:
if (isTestStartMarker(line)) {
  currentTestName = extractTestName(line)
  currentTestLogs = []
} else if (isTestPassMarker(line)) {
  // Discard logs for passed tests (unless verbose)
  if (verbose) {
    printLogs(currentTestName, currentTestLogs)
  }
  currentTestLogs = []
  currentTestName = undefined
} else if (isTestFailMarker(line)) {
  // Print logs for failed tests
  printLogs(currentTestName, currentTestLogs)
  currentTestLogs = []
  currentTestName = undefined
} else if (currentTestName && isMessage) {
  // Buffer log during test execution
  currentTestLogs.push(line)
}
```

## Files to Modify

| File | Changes |
|------|---------|
| `cli/run.ts` | Add log buffering logic in line parser |

No mod-side changes required - the existing message markers provide sufficient structure.

## CLI Options

- Default: show logs only for failed tests
- `--verbose`: show logs for all tests
- `--quiet`: suppress all logs, show only summary

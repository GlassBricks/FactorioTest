# Focused Tests Behavior Change

## Overview

Make `.only` (focused) tests not run by default in CLI mode, preventing accidental partial test runs in CI/CD pipelines.

## Current State

When any test uses `.only`:

- `state.hasFocusedTests` is set to `true` in `propagateTestMode()`
- `isSkippedTest()` skips all tests where `mode !== "only"`
- This behavior is identical in CLI and interactive modes

## Proposed Behavior

| Mode        | Default                     | With `--allow-focused` |
| ----------- | --------------------------- | ---------------------- |
| CLI         | Fail if focused tests exist | Run focused tests only |
| Interactive | Run focused tests only      | N/A                    |

## Detection Mechanism

The mod can signal focused tests to the CLI:

```lua
-- In builtin-test-event-listeners.ts
if (event.type === "testRunStarted" && state.hasFocusedTests) {
  print("FACTORIO-TEST-FOCUSED-TESTS")
}
```

CLI parses this marker and either:

- Runs tests, but gives warning message on test start, and returns failing exit code
- Runs tests, passed (if `--allow-focused` is set)

## Mode Detection

No mode detection needed in the mod. The CLI handles all focused test logic:

- Mod emits focus marker regardless of mode
- CLI parses marker and decides exit code

## Files to Modify

| File                                                | Changes                                                                |
| --------------------------------------------------- | ---------------------------------------------------------------------- |
| `cli/run.ts`                                        | Add `--allow-focused` option, parse focus marker, set CLI mode setting |
| `mod/factorio-test/builtin-test-event-listeners.ts` | Emit focus marker on test run start                                    |

## Exit Behavior

When focused tests are detected without `--allow-focused`:

- Print clear error: "Tests contain .only - run with --allow-focused to execute"
- Exit with non-zero code
- This prevents CI from silently passing when only some tests run

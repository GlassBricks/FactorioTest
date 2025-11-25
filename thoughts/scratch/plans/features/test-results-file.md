# Test Results File Output

## Overview

Output test results to a file, enabling result persistence, CI integration, and test reordering based on previous failures.

## Current State

Results are tracked in `TestRunResults`:
```typescript
interface TestRunResults {
  ran: number
  passed: number
  failed: number
  skipped: number
  todo: number
  describeBlockErrors: number
  status?: "passed" | "failed" | "todo"
}
```

Per-test detail (path, errors, timing) is available during execution but not persisted.

## Proposed Output Format

JSON file with full test details:
```json
{
  "timestamp": "2024-01-15T10:30:00Z",
  "modName": "my-mod",
  "summary": {
    "ran": 50,
    "passed": 45,
    "failed": 3,
    "skipped": 2,
    "status": "failed"
  },
  "tests": [
    {
      "path": "describe > test name",
      "result": "passed",
      "duration": 0.5
    },
    {
      "path": "describe > failing test",
      "result": "failed",
      "duration": 1.2,
      "errors": ["Expected 1 but got 2"]
    }
  ]
}
```

## Test Reordering

Using the results file to run failing tests first:

1. CLI reads previous results file if it exists
2. Extract paths of failed tests
3. Pass failed test paths to mod via setting
4. Mod reorders test tree before execution

### Reordering Implementation

In `load.ts` after test discovery:
- Load failed test paths from previous run
- Sort `rootBlock.children` to prioritize failed tests
- Maintain relative order within failed/passed groups

TODO: expand


## Files to Modify

| File | Changes |
|------|---------|
| `mod/factorio-test/results.ts` | Extend to capture per-test data |
| `mod/factorio-test/builtin-test-event-listeners.ts` | Output detailed results |
| `cli/run.ts` | Write results file, load for reordering |
| `mod/factorio-test/load.ts` | Reorder tests based on previous failures |


## TODO modifications
- always output results to file by default, when using CLI
- Also allow this to happen in interactive mode (store previously failing tests in-game; or load if passed by cli)
- Option to disable reordering
- Option to focus only failed tests

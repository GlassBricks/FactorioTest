# Early Test Cancellation

## Overview

Allow cancelling a test run before completion, useful for long test suites or when a critical failure occurs.

## Current State

The test runner is a task-based state machine in `runner.ts`:
- `tick()` processes tasks from a queue each game tick
- Tasks include: init, enterDescribe, enterTest, startTest, runTestPart, waitForTestPart, leaveTest, leaveDescribeBlock, finishTestRun
- `nextTask = undefined` signals completion
- No cancellation mechanism exists

## Cancellation Points

Cancellation can be injected at:

1. **In `tick()`** - Check cancellation flag before processing tasks
2. **In `enterDescribe()`** - Skip entire describe blocks
3. **In `enterTest()`** - Skip individual tests
4. **In `leaveTest()`** - Skip remaining hooks if cancelled

## Implementation Approach

### State Changes

Add to `TestState`:
```typescript
cancelRequested?: boolean
```

Add new `TestStage`:
```typescript
Cancelled = "Cancelled"
```

### Runner Changes

In `tick()`:
```typescript
if (this.state.cancelRequested) {
  this.nextTask = { task: "finishTestRun" }
  return
}
```

In `enterTest()` and `enterDescribe()`:
```typescript
if (this.state.cancelRequested) {
  // Skip to next sibling or finish
  return { task: "leaveDescribeBlock", data: block }
}
```

### Cancellation APIs

**Global function** (for tests to self-cancel):
```typescript
function cancel_all_tests() {
  const state = getTestState()
  state.cancelRequested = true
}
```

**Remote interface** (for GUI/external tools):
```lua
remote.call("factorio-test", "cancelTests")
```

## New Test Event

Add `TestCancelled` event:
```typescript
interface TestCancelled extends BaseTestEvent {
  type: "testCancelled"
  test: Test
}
```

Update results to track cancelled tests.

## Graceful vs Hard Cancel

- **Graceful**: Run `afterEach`/`afterTest` hooks for cleanup
- **Hard**: Skip all hooks, immediately finish

Recommend graceful to allow resource cleanup.

## Files to Modify

| File | Changes |
|------|---------|
| `mod/factorio-test/state.ts` | Add cancelRequested flag |
| `mod/factorio-test/runner.ts` | Check cancellation in tick/enter methods |
| `mod/factorio-test/test-events.ts` | Add TestCancelled event |
| `mod/factorio-test/results.ts` | Track cancelled count |
| `mod/factorio-test/setup-globals.ts` | Add cancel_all_tests() global |
| `mod/factorio-test/load.ts` | Add cancelTests to remote interface |

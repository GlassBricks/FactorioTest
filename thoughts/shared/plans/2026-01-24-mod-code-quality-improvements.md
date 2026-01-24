# Mod Code Quality Improvements Implementation Plan

## Overview

A series of targeted refactoring improvements to the `mod/factorio-test/` codebase focused on eliminating code duplication, separating concerns, and removing hidden side effects. All changes are internal refactoring with no API changes.

## Current State Analysis

The testing framework is well-architected overall with clean separation between modules. However, several patterns have accumulated that reduce maintainability:

1. **Hidden data flow via module-level variables** - `reload-resume.ts:68-69` uses `savedTestPath` and `foundMatchingTest` as implicit return channels from recursive functions
2. **Comparison functions with mutations** - `compareToSavedTest()` and `compareToSavedDescribeBlock()` both compare and mutate, mixing responsibilities
3. **Duplicated utilities** - `getPlayer()` exists in two files with slightly different signatures
4. **Duplicated patterns** - Hook collection logic is defined twice in `runner.ts`
5. **Minor code quality issues** - Redundant assignments, overly nested factories

## Desired End State

After implementation:
- All comparison functions are pure (no side effects)
- State restoration is explicit and separate from validation
- Shared utilities live in `_util.ts`
- No duplicated logic patterns
- Each function has a single responsibility

### Verification
- All existing tests pass: `npm run test --workspace=mod`
- Framework self-tests pass: `npm run test:self --workspace=mod`
- Linting passes: `npm run lint --workspace=mod`

## What We're NOT Doing

- Changing the public API
- Restructuring the module dependency graph
- Refactoring the test builder factory pattern (moderate effort, lower benefit)
- Changing the state singleton pattern
- Modifying the template string processor `m()`

## Implementation Approach

Proceed in order of increasing complexity. Each phase is independently testable. Earlier phases are prerequisites for later ones only where noted.

---

## Phase 1: Quick Fixes

### Overview
Fix trivial issues that require minimal changes and have no risk.

### Changes Required:

#### 1. Remove redundant async assignment
**File**: `mod/factorio-test/setup-globals.ts`
**Changes**: Remove duplicate `testRun.async = true` on line 296

```typescript
// Before (lines 285-297):
function async(timeout?: number) {
  const testRun = getCurrentTestRun()
  testRun.async = true
  testRun.explicitAsync = true

  if (!timeout) {
    timeout = getTestState().config.default_timeout
  }
  if (timeout < 1) error("test timeout must be greater than 0")

  testRun.timeout = timeout
  testRun.async = true  // <-- remove this line
}

// After:
function async(timeout?: number) {
  const testRun = getCurrentTestRun()
  testRun.async = true
  testRun.explicitAsync = true

  if (!timeout) {
    timeout = getTestState().config.default_timeout
  }
  if (timeout < 1) error("test timeout must be greater than 0")

  testRun.timeout = timeout
}
```

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `npm run test --workspace=mod`
- [x] Lint passes: `npm run lint --workspace=mod`

---

## Phase 2: Extract Shared Utilities

### Overview
Replace duplicated `getPlayer()` functions with a simple shared utility that uses `game.players[1]`.

### Changes Required:

#### 1. Add getPlayer to _util.ts
**File**: `mod/factorio-test/_util.ts`
**Changes**: Add exported `getPlayer()` function

```typescript
import { LuaPlayer } from "factorio:runtime"

export function getPlayer(): LuaPlayer {
  return game.players[1] ?? error("No player found")
}
```

#### 2. Update factorio-test/test-gui.ts
**File**: `mod/factorio-test/test-gui.ts`
**Changes**: Remove local `getPlayer()` definition (lines 139-145), import from `_util`

```typescript
// Add to imports:
import { getPlayer } from "./_util"

// Remove lines 139-145 (the local getPlayer function)
```

#### 3. Update control/test-gui.ts
**File**: `mod/control/test-gui.ts`
**Changes**: Remove local `getPlayer()` definition, import from `_util`, remove optional chaining

```typescript
// Add import:
import { getPlayer } from "../factorio-test/_util"

// Remove lines 5-10 (the local getPlayer function)

// Update usage (line 16):
// Before:
getPlayer()?.gui.screen[Misc.TestGui]?.destroy()

// After:
getPlayer().gui.screen[Misc.TestGui]?.destroy()
```

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `npm run test --workspace=mod`
- [x] Lint passes: `npm run lint --workspace=mod`
- [x] Build succeeds: `npm run build --workspace=mod`

---

## Phase 3: Extract Hook Collection Utility

### Overview
Extract the duplicated hook collection pattern from `runner.ts` into a reusable function.

### Changes Required:

#### 1. Add collectHooks utility to tests.ts
**File**: `mod/factorio-test/tests.ts`
**Changes**: Add `collectHooks()` function

```typescript
export type HookTraversalOrder = "ancestors-first" | "descendants-first"

export function collectHooks(
  block: DescribeBlock,
  type: HookType,
  order: HookTraversalOrder,
): HookFn[] {
  const hooks: HookFn[] = []
  collectHooksRecursive(block, type, order, hooks)
  return hooks
}

function collectHooksRecursive(
  block: DescribeBlock,
  type: HookType,
  order: HookTraversalOrder,
  hooks: HookFn[],
): void {
  if (order === "ancestors-first" && block.parent) {
    collectHooksRecursive(block.parent, type, order, hooks)
  }

  for (const hook of block.hooks) {
    if (hook.type === type) {
      hooks.push(hook.func)
    }
  }

  if (order === "descendants-first" && block.parent) {
    collectHooksRecursive(block.parent, type, order, hooks)
  }
}
```

Also add the import for HookFn at the top of tests.ts:
```typescript
import HookFn = FactorioTest.HookFn
```

#### 2. Update runner.ts to use collectHooks
**File**: `mod/factorio-test/runner.ts`
**Changes**: Replace inline `collectHooks` definitions with imported utility

```typescript
// Add to imports:
import { collectHooks } from "./tests"

// In startTest() - replace lines 192-198:
// Before:
function collectHooks(block: DescribeBlock, hooks: Hook[]) {
  if (block.parent) collectHooks(block.parent, hooks)
  hooks.push(...block.hooks.filter((x) => x.type === "beforeEach"))
  return hooks
}
const beforeEach = collectHooks(test.parent, [])

// After:
const beforeEach = collectHooks(test.parent, "beforeEach", "ancestors-first")

// In leaveTest() - replace lines 251-256:
// Before:
function collectHooks(block: DescribeBlock, hooks: TestFn[]) {
  hooks.push(...block.hooks.filter((x) => x.type === "afterEach").map((x) => x.func))
  if (block.parent) collectHooks(block.parent, hooks)
  return hooks
}
const afterEach = collectHooks(test.parent, [...afterTestFuncs])

// After:
const afterEach = [...afterTestFuncs, ...collectHooks(test.parent, "afterEach", "descendants-first")]
```

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `npm run test --workspace=mod`
- [x] Self-tests pass: `npm run test:self --workspace=mod`
- [x] Lint passes: `npm run lint --workspace=mod`

---

## Phase 4: Refactor reload-resume.ts Comparison Logic

### Overview
Separate the concerns of "validating structure matches" from "restoring state from saved data". Remove module-level mutable state.

### Changes Required:

#### 1. Restructure comparison and restoration
**File**: `mod/factorio-test/reload-resume.ts`

**Step 1**: Define a result type to replace module-level variables:

```typescript
interface ComparisonResult {
  matches: boolean
  matchedTest?: Test
}
```

**Step 2**: Create pure comparison functions (no mutations):

```typescript
function structuresMatch(saved: SavedTestData, current: Test): boolean {
  return (
    saved.path === current.path &&
    compare(saved.tags, current.tags) &&
    compare(saved.source, current.source) &&
    saved.numParts === current.parts.length &&
    saved.mode === current.mode &&
    saved.ticksBefore === current.ticksBefore
  )
}

function describeBlockStructuresMatch(saved: SavedDescribeBlockData, current: DescribeBlock): boolean {
  if (saved.path !== current.path) return false
  if (!compare(saved.tags, current.tags)) return false
  if (!compare(saved.source, current.source)) return false
  if (!compare(saved.hookTypes, current.hooks.map((hook) => hook.type))) return false
  if (saved.mode !== current.mode) return false
  if (saved.ticksBetweenTests !== current.ticksBetweenTests) return false
  if (saved.children.length !== current.children.length) return false

  return saved.children.every((child, i) => {
    const currentChild = current.children[i]
    if (!currentChild || currentChild.type !== child.type) return false
    return child.type === "test"
      ? structuresMatch(child, currentChild as Test)
      : describeBlockStructuresMatch(child, currentChild as DescribeBlock)
  })
}
```

**Step 3**: Create explicit state restoration function:

```typescript
function restoreTestState(saved: SavedTestData, current: Test): void {
  current.errors.length = 0
  current.errors.push(...saved.errors)
  current.profiler = saved.profiler
}

function restoreDescribeBlockState(saved: SavedDescribeBlockData, current: DescribeBlock): void {
  current.errors.length = 0
  current.errors.push(...saved.errors)

  for (let i = 0; i < saved.children.length; i++) {
    const savedChild = saved.children[i]!
    const currentChild = current.children[i]!
    if (savedChild.type === "test") {
      restoreTestState(savedChild, currentChild as Test)
    } else {
      restoreDescribeBlockState(savedChild, currentChild as DescribeBlock)
    }
  }
}
```

**Step 4**: Create a function to find test by path:

```typescript
function findTestByPath(block: DescribeBlock, path: string): Test | undefined {
  for (const child of block.children) {
    if (child.type === "test") {
      if (child.path === path) return child
    } else {
      const found = findTestByPath(child, path)
      if (found) return found
    }
  }
  return undefined
}
```

**Step 5**: Update `resumeAfterReload` to use the new functions:

```typescript
export function resumeAfterReload(state: TestState):
  | { test: Test; partIndex: number }
  | undefined {
  const testResume = storage.__testResume ?? error("attempting to resume after reload without resume data saved")
  storage.__testResume = undefined

  state.results = testResume.results
  state.profiler = testResume.profiler
  state.reloaded = true

  const saved = testResume.rootBlock

  if (!describeBlockStructuresMatch(saved, state.rootBlock)) {
    return undefined
  }

  restoreDescribeBlockState(saved, state.rootBlock)

  const test = findTestByPath(state.rootBlock, testResume.resumeTestPath)
  if (!test) {
    return undefined
  }

  return {
    test,
    partIndex: testResume.resumePartIndex,
  }
}
```

**Step 6**: Remove the module-level variables (lines 68-69):
```typescript
// Delete these lines:
let savedTestPath: string
let foundMatchingTest: Test | undefined
```

**Step 7**: Remove the old `compareToSavedTest` and `compareToSavedDescribeBlock` functions entirely.

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `npm run test --workspace=mod`
- [x] Self-tests pass: `npm run test:self --workspace=mod`
- [x] Lint passes: `npm run lint --workspace=mod`

#### Manual Verification:
- [x] Run a test that uses `.after_reload_mods()` to verify reload/resume still works correctly

---

## Phase 5: Consolidate Test Mode Propagation

### Overview
Merge the four related functions (`skipAllChildren`, `focusAllChildren`, `markFocusedTests`, `propagateTestMode`) into a single clearer function.

### Changes Required:

#### 1. Replace mode propagation functions
**File**: `mod/factorio-test/setup-globals.ts`
**Changes**: Replace lines 94-138 with a single consolidated function

```typescript
export function propagateTestMode(state: TestState, block: DescribeBlock, parentMode: TestMode): void {
  if (parentMode === "skip") {
    applyModeToAllChildren(block, "skip")
    return
  }

  if (parentMode === "only") {
    state.hasFocusedTests = true
    const hasNestedOnly = block.children.some((child) => child.declaredMode === "only")
    if (!hasNestedOnly) {
      applyModeToAllChildren(block, "only")
    } else {
      markChildrenWithFocus(state, block)
    }
    return
  }

  markChildrenWithFocus(state, block)
}

function applyModeToAllChildren(block: DescribeBlock, mode: TestMode): void {
  for (const child of block.children) {
    if (child.declaredMode === "skip") continue

    if (mode === "only" && child.declaredMode !== undefined) {
      child.mode = child.declaredMode
    } else {
      child.mode = mode
    }

    if (child.type === "describeBlock") {
      applyModeToAllChildren(child, mode)
    }
  }
}

function markChildrenWithFocus(state: TestState, block: DescribeBlock): void {
  for (const child of block.children) {
    if (child.declaredMode === "only") {
      state.hasFocusedTests = true
    }
  }
}
```

### Success Criteria:

#### Automated Verification:
- [x] Tests pass: `npm run test --workspace=mod`
- [x] Self-tests pass: `npm run test:self --workspace=mod`
- [x] Lint passes: `npm run lint --workspace=mod`

Note: Existing tests in `meta.test.ts:338-469` provide sufficient coverage of `.only`/`.skip` behavior including nested combinations. No additional tests needed before refactoring.

---

## Testing Strategy

### Existing Test Coverage
The framework has self-tests in `mod/factorio-test/test/` that exercise the test lifecycle. These should catch any regressions.

### Key Test Scenarios
After each phase, verify:
1. Basic test execution works
2. `.skip` and `.only` modifiers work correctly
3. Lifecycle hooks (`before_all`, `after_each`, etc.) execute in correct order
4. Reload/resume functionality works (especially after Phase 4)

### Commands
```bash
npm run test --workspace=mod        # Run all mod tests
npm run test:self --workspace=mod   # Run framework self-tests
npm run lint --workspace=mod        # Check for lint errors
```

## References

- Analyzed files:
  - `mod/factorio-test/setup-globals.ts`
  - `mod/factorio-test/reload-resume.ts`
  - `mod/factorio-test/runner.ts`
  - `mod/factorio-test/tests.ts`
  - `mod/factorio-test/state.ts`
  - `mod/factorio-test/_util.ts`
  - `mod/factorio-test/test-gui.ts`
  - `mod/control/test-gui.ts`

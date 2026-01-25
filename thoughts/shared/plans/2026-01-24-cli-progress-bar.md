# CLI Progress Bar Implementation Plan

## Overview

Add a progress bar and richer terminal output during test runs, providing visual feedback on test execution progress.

## Current State Analysis

**CLI Architecture** (refactored in `4f991f4`):
- `FactorioOutputHandler` - parses lines, emits typed events: `event`, `log`, `message`, `result`
- `TestRunCollector` - extends EventEmitter, emits `testFinished` and `runFinished`
- `OutputPrinter` - handles output formatting, subscribed to collector's `testFinished`
- `createOutputComponents()` wires these together in `factorio-process.ts`

**Event Protocol**:
- `testRunStarted` event has no payload (no total count)
- `testStarted` includes test path
- `testPassed/Failed/Skipped/Todo` include test info
- `testRunFinished` includes final `TestRunSummary` with counts

**Test Count**:
- `countActiveTests()` calculates total at run start
- `resultCollector` maintains running counts in `state.results`
- GUI uses `countActiveTests()` at `testRunStarted` to populate total

## Desired End State

```
Running tests (headless)...

[████████████░░░░░░░░] 60%  30/50  ✓25 ✗3 ○2
Running: utilities > parseDate handles timezones
```

When stdout is not a TTY (piped), fall back to current behavior.

## What We're NOT Doing

- No changes to graphics mode (already has GUI)
- No new CLI flags (enabled by default for TTY)

## Implementation Approach

Extend the existing event protocol rather than adding a new `FACTORIO-TEST-PROGRESS:` marker:
1. Add `total` field to `testRunStarted` event
2. CLI derives running totals from existing events (already does this in `TestRunCollector`)
3. Use `log-update` library for in-place terminal updates (handles cursor, clearing, terminal width, Windows compatibility)

## Phase 1: Extend testRunStarted Event

### Changes Required

#### 1. Event Type Definition
**File**: `types/events.d.ts`

Add `total` field to `testRunStarted`:

```typescript
export type TestRunnerEvent =
  | { type: "testRunStarted"; total: number }
  // ... rest unchanged
```

#### 2. Emit Total Count
**File**: `mod/factorio-test/cli-events.ts`

Update `testRunStarted` case:

```typescript
case "testRunStarted":
  emitEvent({ type: "testRunStarted", total: countActiveTests(state.rootBlock, state) })
  break
```

Add import for `countActiveTests` from `./tests`.

### Success Criteria

#### Automated Verification:
- [x] Build mod: `npm run build --workspace=mod`
- [x] Mod tests pass: `npm run test --workspace=mod`
- [x] Type checking passes for types package

#### Manual Verification:
- [x] Run CLI with `--verbose` flag, verify `testRunStarted` event includes `total` field

---

## Phase 2: CLI Progress Renderer

### Changes Required

#### 1. Install log-update
**File**: `cli/package.json`

```bash
npm install log-update --workspace=cli
```

#### 2. Progress Renderer Module
**File**: `cli/progress-renderer.ts` (new)

```typescript
import chalk from "chalk"
import logUpdate from "log-update"
import { TestRunnerEvent } from "../types/events.js"
import { CapturedTest } from "./test-run-collector.js"

export class ProgressRenderer {
  private isTTY: boolean
  private active = false
  private total = 0
  private ran = 0
  private passed = 0
  private failed = 0
  private skipped = 0
  private todo = 0
  private currentTest?: string

  constructor() {
    this.isTTY = process.stdout.isTTY ?? false
  }

  handleEvent(event: TestRunnerEvent): void {
    if (event.type === "testRunStarted") {
      this.total = event.total
    } else if (event.type === "testStarted") {
      this.currentTest = event.test.path
      this.render()
    }
  }

  handleTestFinished(test: CapturedTest): void {
    this.currentTest = undefined
    this.ran++
    if (test.result === "passed") this.passed++
    else if (test.result === "failed") this.failed++
    else if (test.result === "skipped") this.skipped++
    else if (test.result === "todo") this.todo++
    this.render()
  }

  finish(): void {
    if (this.active) logUpdate.clear()
  }

  private render(): void {
    if (!this.isTTY) return
    this.active = true

    const percent = this.total > 0 ? Math.floor((this.ran / this.total) * 100) : 0
    const barWidth = 20
    const filled = Math.floor((percent / 100) * barWidth)
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled)

    const counts = [
      chalk.green(`✓${this.passed}`),
      this.failed > 0 ? chalk.red(`✗${this.failed}`) : null,
      this.skipped > 0 ? chalk.yellow(`○${this.skipped}`) : null,
      this.todo > 0 ? chalk.magenta(`◌${this.todo}`) : null,
    ].filter(Boolean).join(" ")

    const progress = `[${bar}] ${percent}%  ${this.ran}/${this.total}  ${counts}`
    const current = this.currentTest ? `Running: ${this.currentTest}` : ""

    logUpdate(progress + "\n" + current)
  }
}
```

#### 3. Integrate into createOutputComponents
**File**: `cli/factorio-process.ts`

Wire `ProgressRenderer` into the existing event-driven architecture:

```typescript
import { ProgressRenderer } from "./progress-renderer.js"

function createOutputComponents(options: FactorioTestOptions): OutputComponents {
  const handler = new FactorioOutputHandler()
  const collector = new TestRunCollector()
  const printer = new OutputPrinter({ ... })
  const progress = new ProgressRenderer()

  handler.on("event", (event) => {
    collector.handleEvent(event)
    progress.handleEvent(event)
    if (options.verbose) console.log(JSON.stringify(event))
  })
  handler.on("log", (line) => { ... })
  handler.on("message", (line) => printer.printMessage(line))
  handler.on("result", () => progress.finish())

  collector.on("testFinished", (test) => {
    progress.handleTestFinished(test)
    printer.printTestResult(test)
  })

  return { handler, collector, printer }
}
```

### Success Criteria

#### Automated Verification:
- [x] Build CLI: `npm run build --workspace=cli`
- [x] CLI tests pass: `npm run test --workspace=cli`
- [x] Lint passes: `npm run lint --workspace=cli`
- [x] Format passes: `npm run prettier:fix`

#### Manual Verification:
- [ ] Run tests in terminal, verify progress bar displays and updates
- [ ] Pipe output (`... | cat`), verify no progress bar shown
- [ ] Run with `--verbose`, verify progress bar still works alongside verbose output

---

## Phase 3: Tests and Polish

### Changes Required

#### 1. Unit Tests for ProgressRenderer
**File**: `cli/progress-renderer.test.ts` (new)

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import logUpdate from "log-update"
import { ProgressRenderer } from "./progress-renderer.js"

vi.mock("log-update", () => ({
  default: Object.assign(vi.fn(), { clear: vi.fn() }),
}))

describe("ProgressRenderer", () => {
  let originalIsTTY: boolean | undefined

  beforeEach(() => {
    originalIsTTY = process.stdout.isTTY
    vi.mocked(logUpdate).mockClear()
    vi.mocked(logUpdate.clear).mockClear()
  })

  afterEach(() => {
    Object.defineProperty(process.stdout, "isTTY", { value: originalIsTTY, writable: true })
  })

  it("renders nothing when not TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: false, writable: true })
    const renderer = new ProgressRenderer()
    renderer.handleEvent({ type: "testRunStarted", total: 10 })
    renderer.handleEvent({ type: "testStarted", test: { path: "test" } })
    expect(logUpdate).not.toHaveBeenCalled()
  })

  it("renders progress bar when TTY", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true })
    const renderer = new ProgressRenderer()
    renderer.handleEvent({ type: "testRunStarted", total: 10 })
    renderer.handleTestFinished({ path: "test", result: "passed", errors: [], logs: [] })
    expect(logUpdate).toHaveBeenCalled()
    const output = vi.mocked(logUpdate).mock.calls[0][0]
    expect(output).toContain("10%")
    expect(output).toContain("1/10")
  })

  it("includes current test when provided", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true })
    const renderer = new ProgressRenderer()
    renderer.handleEvent({ type: "testRunStarted", total: 10 })
    renderer.handleEvent({ type: "testStarted", test: { path: "describe > my test" } })
    const output = vi.mocked(logUpdate).mock.calls[0][0]
    expect(output).toContain("Running: describe > my test")
  })

  it("clears on finish when active", () => {
    Object.defineProperty(process.stdout, "isTTY", { value: true, writable: true })
    const renderer = new ProgressRenderer()
    renderer.handleEvent({ type: "testRunStarted", total: 10 })
    renderer.handleEvent({ type: "testStarted", test: { path: "test" } })
    renderer.finish()
    expect(logUpdate.clear).toHaveBeenCalled()
  })
})
```

### Success Criteria

#### Automated Verification:
- [ ] All CLI tests pass: `npm run test --workspace=cli`
- [ ] Integration tests pass: `npm run test:integration`

#### Manual Verification:
- [ ] Progress bar shows correct counts as tests complete
- [ ] Failed tests show red count
- [ ] Progress clears cleanly when tests finish

---

## Testing Strategy

### Unit Tests:
- `ProgressRenderer` TTY detection and log-update integration
- Edge cases: 0 tests, all skipped, etc.

### Integration Tests:
- Existing integration tests should continue to pass
- Progress bar output is TTY-only, won't affect captured output

### Manual Testing Steps:
1. Run `npx factorio-test run` in terminal - verify progress bar
2. Run `npx factorio-test run | cat` - verify no progress bar
3. Run with failing tests - verify red count appears
4. Run with skipped tests - verify yellow count appears

## References

- Event protocol: `types/events.d.ts`
- CLI event emitter: `mod/factorio-test/cli-events.ts`
- CLI output handling: `cli/factorio-process.ts`, `cli/factorio-output-handler.ts`

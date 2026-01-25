# Structured Test Events Implementation Plan

## Overview

Replace the string-oriented FACTORIO-TEST-MESSAGE system with structured event output. The mod emits JSON events; the CLI parses them and handles all formatting. This enables per-test log capture, custom formatting, and future features like result recording.

## Current State Analysis

**Event System** (`mod/factorio-test/test-events.ts`):
- Already structured: `TestEvent` union type with `Test`/`DescribeBlock` objects
- Events carry full test data: path, source, errors, profiler, tags

**Message System** (`mod/factorio-test/output.ts`):
- `logListener` transforms events → `RichAndPlainText` strings
- `output()` dispatches to handlers: `logLogger` (CLI), `debugAdapterLogger`, GUI
- `logLogger` wraps strings in `FACTORIO-TEST-MESSAGE-START/END` markers

**Problem**: Structured data is lost when converted to strings. CLI receives formatted text, not data.

## Desired End State

**Mod outputs structured events**:
```
FACTORIO-TEST-EVENT:{"type":"testStarted","test":{"path":"root > mytest"}}
FACTORIO-TEST-EVENT:{"type":"testPassed","test":{"path":"root > mytest","duration":"1.23 ms"}}
```

**CLI parses and formats**:
- Buffers logs between `testStarted` and result event
- Captures raw Factorio log lines (non-FACTORIO-TEST) and associates with current test
- Formats output with colors, indentation
- Stores structured results for future recording feature

**Verification**:
- Integration tests pass with new protocol
- CLI output looks similar to current output
- `--verbose` shows raw Factorio output including structured events
- Failed tests show captured logs

## What We're NOT Doing

- Changing the internal event system (already structured)
- Modifying GUI output (keeps current RichText system)
- Recording test results to files (future feature, but we design for it)
- Breaking debug adapter integration

## Architecture

### Event Types for CLI Protocol

```typescript
// Shared types (new file: types/events.ts or similar)

interface SourceLocation {
  file?: string
  line?: number
}

interface TestInfo {
  path: string
  source?: SourceLocation
  duration?: string  // profiler output as string
}

interface BlockInfo {
  path: string
  source?: SourceLocation
}

interface TestRunResults {
  ran: number
  passed: number
  failed: number
  skipped: number
  todo: number
  describeBlockErrors: number
  status: "passed" | "failed" | "todo"
  duration?: string
}

type TestRunnerEvent =
  | { type: "testRunStarted" }
  | { type: "testStarted"; test: TestInfo }
  | { type: "testPassed"; test: TestInfo }
  | { type: "testFailed"; test: TestInfo; errors: string[] }
  | { type: "testSkipped"; test: TestInfo }
  | { type: "testTodo"; test: TestInfo }
  | { type: "describeBlockEntered"; block: BlockInfo }
  | { type: "describeBlockFinished"; block: BlockInfo }
  | { type: "describeBlockFailed"; block: BlockInfo; errors: string[] }
  | { type: "testRunFinished"; results: TestRunResults }
  | { type: "loadError"; error: string }
```

### CLI Data Model

```typescript
interface CapturedTest {
  path: string
  source?: SourceLocation
  result: "passed" | "failed" | "skipped" | "todo"
  errors: string[]
  logs: string[]      // captured during test execution
  duration?: string
}

interface TestRunData {
  tests: CapturedTest[]
  summary?: TestRunResults
}
```

### Output Protocol

- Events: `FACTORIO-TEST-EVENT:{json}`
- Final result: `FACTORIO-TEST-RESULT:{status}` (keep for backward compat, or embed in testRunFinished)
- Non-event lines during a test: captured as logs for that test

## Phase 1: Define Shared Event Types

### Overview
Create shared TypeScript types for the CLI protocol, usable by both mod (via TSTL) and CLI.

### Changes Required

**File**: `types/events.ts` (new)

```typescript
export interface SourceLocation {
  file?: string
  line?: number
}

export interface TestInfo {
  path: string
  source?: SourceLocation
  duration?: string
}

export interface BlockInfo {
  path: string
  source?: SourceLocation
}

export interface TestRunSummary {
  ran: number
  passed: number
  failed: number
  skipped: number
  todo: number
  describeBlockErrors: number
  status: "passed" | "failed" | "todo"
  duration?: string
}

export type TestRunnerEvent =
  | { type: "testRunStarted" }
  | { type: "testStarted"; test: TestInfo }
  | { type: "testPassed"; test: TestInfo }
  | { type: "testFailed"; test: TestInfo; errors: string[] }
  | { type: "testSkipped"; test: TestInfo }
  | { type: "testTodo"; test: TestInfo }
  | { type: "describeBlockEntered"; block: BlockInfo }
  | { type: "describeBlockFinished"; block: BlockInfo }
  | { type: "describeBlockFailed"; block: BlockInfo; errors: string[] }
  | { type: "testRunFinished"; results: TestRunSummary }
  | { type: "loadError"; error: string }
```

### Success Criteria

#### Automated Verification:
- [x] Types compile: `npm run build --workspace=cli` and `npm run build --workspace=mod`
- [x] Types are exported from package (as `types/events.d.ts`)

---

## Phase 2: Mod - Add Structured Event Emitter

### Overview
Add a new event listener that emits structured JSON events for CLI consumption. Keep existing `logListener` for GUI.

### Changes Required

**File**: `mod/factorio-test/cli-events.ts` (new)

```typescript
import { TestEventListener } from "./test-events"
import { TestRunnerEvent, TestInfo, BlockInfo } from "../../types/events"

const EVENT_PREFIX = "FACTORIO-TEST-EVENT:"

function emitEvent(event: TestRunnerEvent): void {
  print(EVENT_PREFIX + game.table_to_json(event))
}

function testToInfo(test: Test): TestInfo {
  return {
    path: test.path,
    source: test.source.file ? { file: test.source.file, line: test.source.line } : undefined,
    duration: test.profiler ? tostring(test.profiler) : undefined,
  }
}

function blockToInfo(block: DescribeBlock): BlockInfo {
  return {
    path: block.path,
    source: block.source.file ? { file: block.source.file, line: block.source.line } : undefined,
  }
}

export const cliEventEmitter: TestEventListener = (event, state) => {
  switch (event.type) {
    case "testRunStarted":
      emitEvent({ type: "testRunStarted" })
      break
    case "testStarted":
      emitEvent({ type: "testStarted", test: testToInfo(event.test) })
      break
    case "testPassed":
      emitEvent({ type: "testPassed", test: testToInfo(event.test) })
      break
    case "testFailed":
      emitEvent({
        type: "testFailed",
        test: testToInfo(event.test),
        errors: [...event.test.errors],
      })
      break
    case "testSkipped":
      emitEvent({ type: "testSkipped", test: testToInfo(event.test) })
      break
    case "testTodo":
      emitEvent({ type: "testTodo", test: testToInfo(event.test) })
      break
    case "describeBlockEntered":
      emitEvent({ type: "describeBlockEntered", block: blockToInfo(event.block) })
      break
    case "describeBlockFinished":
      emitEvent({ type: "describeBlockFinished", block: blockToInfo(event.block) })
      break
    case "describeBlockFailed":
      emitEvent({
        type: "describeBlockFailed",
        block: blockToInfo(event.block),
        errors: [...event.block.errors],
      })
      break
    case "testRunFinished":
      emitEvent({
        type: "testRunFinished",
        results: {
          ...state.results,
          duration: state.profiler ? tostring(state.profiler) : undefined,
        },
      })
      break
    case "loadError":
      emitEvent({
        type: "loadError",
        error: state.rootBlock.errors[0] ?? "Unknown error",
      })
      break
  }
}
```

**File**: `mod/factorio-test/load.ts`

Register `cliEventEmitter` for headless mode:

```typescript
import { cliEventEmitter } from "./cli-events"

// In doRunTests(), after clearing listeners:
if (settings.startup[Settings.AutoStart]?.value === "headless") {
  addTestListener(cliEventEmitter)
}
```

### Tests

**mod/factorio-test/cli-events.test.ts** (if mod has unit tests):
- `cliEventEmitter` outputs correct JSON for each event type
- `testToInfo` extracts path, source, duration correctly
- Errors array is copied (not referenced) in testFailed/describeBlockFailed

### Success Criteria

#### Automated Verification:
- [x] Mod compiles: `npm run build --workspace=mod`
- [x] Integration tests pass: `npm run test:integration`

#### Manual Verification:
- [ ] Run tests with `--verbose`, see JSON events in output

---

## Phase 3: CLI - Parse Structured Events

### Overview
Replace string-based parsing with structured event parsing. Build test result data structure.

### Changes Required

**File**: `cli/event-parser.ts` (new)

```typescript
import { TestRunnerEvent } from "../types/events.js"

const EVENT_PREFIX = "FACTORIO-TEST-EVENT:"

export function parseEvent(line: string): TestRunnerEvent | undefined {
  if (!line.startsWith(EVENT_PREFIX)) {
    return undefined
  }
  try {
    return JSON.parse(line.slice(EVENT_PREFIX.length)) as TestRunnerEvent
  } catch {
    return undefined
  }
}
```

**File**: `cli/test-run-collector.ts` (new)

```typescript
import { TestRunnerEvent, TestRunSummary, SourceLocation } from "../types/events.js"

export interface CapturedTest {
  path: string
  source?: SourceLocation
  result: "passed" | "failed" | "skipped" | "todo"
  errors: string[]
  logs: string[]
  duration?: string
}

export interface TestRunData {
  tests: CapturedTest[]
  summary?: TestRunSummary
}

export class TestRunCollector {
  private data: TestRunData = { tests: [] }
  private currentTest: CapturedTest | undefined
  private currentLogs: string[] = []

  handleEvent(event: TestRunnerEvent): void {
    switch (event.type) {
      case "testStarted":
        this.flushCurrentTest()
        this.currentTest = {
          path: event.test.path,
          source: event.test.source,
          result: "passed", // will be updated
          errors: [],
          logs: [],
        }
        this.currentLogs = []
        break

      case "testPassed":
        if (this.currentTest) {
          this.currentTest.result = "passed"
          this.currentTest.duration = event.test.duration
          this.currentTest.logs = [...this.currentLogs]
        }
        this.flushCurrentTest()
        break

      case "testFailed":
        if (this.currentTest) {
          this.currentTest.result = "failed"
          this.currentTest.errors = event.errors
          this.currentTest.duration = event.test.duration
          this.currentTest.logs = [...this.currentLogs]
        }
        this.flushCurrentTest()
        break

      case "testSkipped":
        this.flushCurrentTest()
        this.data.tests.push({
          path: event.test.path,
          source: event.test.source,
          result: "skipped",
          errors: [],
          logs: [],
        })
        break

      case "testTodo":
        this.flushCurrentTest()
        this.data.tests.push({
          path: event.test.path,
          source: event.test.source,
          result: "todo",
          errors: [],
          logs: [],
        })
        break

      case "testRunFinished":
        this.flushCurrentTest()
        this.data.summary = event.results
        break
    }
  }

  captureLog(line: string): void {
    if (this.currentTest) {
      this.currentLogs.push(line)
    }
  }

  getData(): TestRunData {
    return this.data
  }

  private flushCurrentTest(): void {
    if (this.currentTest) {
      this.data.tests.push(this.currentTest)
      this.currentTest = undefined
      this.currentLogs = []
    }
  }
}
```

**File**: `cli/output-formatter.ts` (new)

```typescript
import chalk from "chalk"
import { CapturedTest, TestRunData } from "./test-run-collector.js"

export interface FormatterOptions {
  verbose?: boolean
  quiet?: boolean
  showPassedLogs?: boolean
}

export class OutputFormatter {
  constructor(private options: FormatterOptions) {}

  formatTestResult(test: CapturedTest): void {
    if (this.options.quiet) return

    const showLogs = test.result === "failed" || this.options.showPassedLogs

    if (showLogs && test.logs.length > 0) {
      for (const log of test.logs) {
        console.log("    " + log)
      }
    }

    const prefix = this.getPrefix(test.result)
    const duration = test.duration ? ` (${test.duration})` : ""
    console.log(`${prefix} ${test.path}${duration}`)

    if (test.result === "failed") {
      for (const error of test.errors) {
        console.log("    " + error)
      }
    }
  }

  formatSummary(data: TestRunData): void {
    if (!data.summary) return
    const { status } = data.summary
    const color = status === "passed" ? chalk.greenBright
                : status === "todo" ? chalk.yellowBright
                : chalk.redBright
    console.log("Test run result:", color(status))
  }

  private getPrefix(result: CapturedTest["result"]): string {
    switch (result) {
      case "passed": return chalk.green("PASS")
      case "failed": return chalk.red("FAIL")
      case "skipped": return chalk.yellow("SKIP")
      case "todo": return chalk.magenta("TODO")
    }
  }
}
```

### Tests

**cli/event-parser.test.ts**:
- Parse valid event JSON returns typed event object
- Non-event lines return undefined
- Malformed JSON returns undefined (no throw)

**cli/test-run-collector.test.ts**:
- `testStarted` begins new test buffer
- `testPassed` finalizes test with result and duration
- `testFailed` includes errors array
- `captureLog` accumulates logs for current test
- `testSkipped`/`testTodo` add test without prior `testStarted`
- Logs associated with correct test when multiple tests run

**cli/output-formatter.test.ts**:
- Formats each result type with correct color/prefix
- Shows logs before result line for failed tests
- Hides logs for passed tests by default
- `showPassedLogs` option shows all logs
- `quiet` option suppresses all output

### Success Criteria

#### Automated Verification:
- [x] CLI compiles: `npm run build --workspace=cli`
- [x] Unit tests pass: `npm run test --workspace=cli`

---

## Phase 4: CLI - Integrate New Parser

### Overview
Replace `createLineHandler` with new event-based system.

### Changes Required

**File**: `cli/factorio-process.ts`

```typescript
import { parseEvent } from "./event-parser.js"
import { TestRunCollector } from "./test-run-collector.js"
import { OutputFormatter } from "./output-formatter.js"

export interface FactorioTestOptions {
  verbose?: boolean
  showOutput?: boolean
  quiet?: boolean
}

function createLineHandler(
  options: FactorioTestOptions,
  onResult: (status: string) => void,
): (line: string) => void {
  const collector = new TestRunCollector()
  const formatter = new OutputFormatter({
    verbose: options.verbose,
    quiet: options.quiet,
    showPassedLogs: options.verbose,
  })

  return (line: string) => {
    // Handle final result marker (keep for now)
    if (line.startsWith("FACTORIO-TEST-RESULT:")) {
      onResult(line.slice("FACTORIO-TEST-RESULT:".length))
      formatter.formatSummary(collector.getData())
      return
    }

    // Try to parse as structured event
    const event = parseEvent(line)
    if (event) {
      collector.handleEvent(event)

      // Format test results as they complete
      if (event.type === "testPassed" || event.type === "testFailed" ||
          event.type === "testSkipped" || event.type === "testTodo") {
        const tests = collector.getData().tests
        const lastTest = tests[tests.length - 1]
        if (lastTest && options.showOutput) {
          formatter.formatTestResult(lastTest)
        }
      }

      if (options.verbose) {
        console.log(line)
      }
      return
    }

    // Not a structured event - capture as log or print if verbose
    if (options.verbose) {
      console.log(line)
    } else {
      collector.captureLog(line)
    }
  }
}
```

### Success Criteria

#### Automated Verification:
- [x] CLI compiles: `npm run build --workspace=cli`
- [x] Integration tests pass: `npm run test:integration`

### Tests

**integration-tests/**: Add or update integration tests:
- Test with all passing tests → output shows PASS lines, no captured logs
- Test with failing test → output shows captured logs before FAIL line
- Test with mixed results → only failing test logs shown
- Describe block error → ERROR line with block path and error message

#### Manual Verification:
- [ ] Passing tests show only PASS line (no logs)
- [ ] Failing tests show captured logs before FAIL line
- [ ] `--verbose` shows all output including JSON events

---

## Phase 5: Cleanup Legacy Message System

### Overview
Remove FACTORIO-TEST-MESSAGE markers from CLI parsing. Keep logListener for GUI mode only.

### Changes Required

**File**: `mod/factorio-test/load.ts`

Only register `logLogger` handler for GUI mode, not headless:

```typescript
// In doRunTests():
if (settings.startup[Settings.AutoStart]?.value !== "headless") {
  addMessageHandler(debugAdapterEnabled ? debugAdapterLogger : logLogger)
}
```

**File**: `cli/factorio-process.ts`

Remove FACTORIO-TEST-MESSAGE parsing from line handler (no longer needed).

### Tests

Existing integration tests verify no regression after removing legacy parsing.

### Success Criteria

#### Automated Verification:
- [x] Integration tests pass: `npm run test:integration`

#### Manual Verification:
- [ ] GUI mode still works (test with `--graphics`)

---

## Phase 6: Add CLI Options

### Overview
Add `--quiet` option and update schema.

### Changes Required

**File**: `cli/run.ts`

Add option after `--verbose`:

```typescript
.option("-q --quiet", "Suppress per-test output, show only final result.")
```

Update options type and pass to handler.

**File**: `cli/schema.ts`

Add to `cliConfigSchema`:

```typescript
quiet: z.boolean().optional(),
```

### Tests

**integration-tests/**: Add integration test for quiet mode:
- `--quiet` flag suppresses per-test output, shows only final "Test run result: passed/failed"

### Success Criteria

#### Automated Verification:
- [x] `--help` shows new option
- [x] CLI tests pass: `npm run test --workspace=cli`
- [x] Integration tests pass: `npm run test:integration`

---

## Testing Summary

Tests are listed in their respective phases:
- **Phase 2**: Unit tests for cliEventEmitter (mod side)
- **Phase 3**: Unit tests for event-parser, test-run-collector, output-formatter (CLI side)
- **Phase 4**: Integration tests for event flow and log capture
- **Phase 5**: Verify no regression after removing legacy parsing
- **Phase 6**: Integration test for `--quiet` flag

## Future Extensions

This architecture enables:

1. **Result Recording**: Save `TestRunData` to JSON file
2. **Custom Reporters**: Consume events, format differently (JUnit XML, etc.)
3. **Describe Block Tracking**: Events already exist, just add to collector
4. **Watch Mode**: Re-run tests, compare results
5. **Performance Tracking**: Aggregate duration data

## References

- Event types: `mod/factorio-test/test-events.ts:4-71`
- Current output: `mod/factorio-test/output.ts:188-266`
- CLI parsing: `cli/factorio-process.ts:25-48`

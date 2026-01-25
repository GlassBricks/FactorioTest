# Test Results File Output Implementation Plan

## Overview

Output test results to a JSON file after each test run, enabling result persistence, CI integration, and test reordering based on previous failures.

## Current State Analysis

The CLI already captures structured per-test data via `TestRunCollector`:
- `CapturedTest`: path, source, result, errors, logs, duration
- `TestRunData`: tests array + TestRunSummary

The collector is internal to `createLineHandler()` in `factorio-process.ts` - data is used for display but not returned to `run.ts`.

### Current Settings Architecture:
- `factorio-test-mod-to-test` (runtime-global) - GUI mod selection
- `factorio-test-auto-start-mod` (startup, hidden) - mod to auto-start
- `factorio-test-auto-start` (startup, hidden) - "false" | "headless" | "graphics"
- `factorio-test-config` (runtime-global, hidden) - JSON test config

### Key Discoveries:
- `cli/test-run-collector.ts:3-15` - `CapturedTest` and `TestRunData` already capture all needed data
- `cli/factorio-process.ts:42-104` - collector created inside `createLineHandler()`, data not accessible
- `mod/settings.ts` - defines 4 separate settings, 2 for auto-start can be consolidated
- `mod/factorio-test/config.ts:19-27` - merges mod config + settings config

## Desired End State

1. Test results written to JSON file after every CLI test run (by default)
2. Consolidated settings: test config (public) + hidden config (private)
3. New `reorder_failed_first` option (default true) configurable via CLI, file, or in-mod
4. Previously failed tests run first when reordering enabled

### New Settings Architecture:
- `factorio-test-config` (runtime-global) - public test config
  - Existing: test_pattern, tag_whitelist, tag_blacklist, default_timeout, game_speed, log_passed_tests, log_skipped_tests
  - New: `reorder_failed_first` (default true)
- `factorio-test-auto-start-config` (startup, hidden) - private CLI config
  - `mod`: string (mod to test, replaces AutoStartMod)
  - `headless`: boolean (replaces AutoStart)
  - `last_failed_tests`: string[] (for reordering)
- `factorio-test-mod-to-test` (runtime-global) - keep for GUI mode

### Verification:
- Run `npm run test --workspace=cli && npm run test --workspace=mod` - tests pass
- Run integration tests - JSON file created with correct structure
- With reordering enabled, failed tests run first in subsequent run

## What We're NOT Doing

- GUI/interactive mode support for results persistence
- Option to focus only on previously failed tests

## Output File Format

```json
{
  "timestamp": "2026-01-24T10:30:00.000Z",
  "modName": "my-mod",
  "summary": {
    "ran": 50,
    "passed": 45,
    "failed": 3,
    "skipped": 2,
    "todo": 0,
    "cancelled": 0,
    "describeBlockErrors": 0,
    "status": "failed",
    "duration": "1.23 s"
  },
  "tests": [
    {
      "path": "describe > test name",
      "result": "passed",
      "duration": "0.5 ms"
    },
    {
      "path": "describe > failing test",
      "result": "failed",
      "duration": "1.2 ms",
      "errors": ["Expected 1 but got 2"]
    }
  ]
}
```

---

## Phase 1: Consolidate Settings

### Overview
Replace `factorio-test-auto-start` and `factorio-test-auto-start-mod` with a single `factorio-test-auto-start-config` JSON setting.

### Changes Required:

#### 1. mod/constants.d.ts

Replace settings enum entries:
```typescript
export const enum Settings {
  ModToTest = "factorio-test-mod-to-test",
  AutoStartConfig = "factorio-test-auto-start-config",
  Config = "factorio-test-config",
}
```

#### 2. mod/settings.ts

Replace two startup settings with one:
```typescript
data.extend([
  {
    type: "string-setting",
    setting_type: "runtime-global",
    name: Settings.ModToTest,
    default_value: "",
    allow_blank: true,
    order: "a",
  },
  {
    type: "string-setting",
    setting_type: "startup",
    name: Settings.AutoStartConfig,
    default_value: "{}",
    allow_blank: true,
    hidden: true,
    order: "a1",
  },
  {
    type: "string-setting",
    setting_type: "runtime-global",
    name: Settings.Config,
    default_value: "{}",
    allow_blank: true,
    hidden: true,
    order: "c",
  },
])
```

#### 3. mod/factorio-test/auto-start-config.ts (new file)

```typescript
import { Settings } from "../constants"

export interface AutoStartConfig {
  mod?: string
  headless?: boolean
  last_failed_tests?: string[]
}

let cachedConfig: AutoStartConfig | undefined

export function getAutoStartConfig(): AutoStartConfig {
  if (cachedConfig) return cachedConfig
  const json = settings.startup[Settings.AutoStartConfig]?.value as string | undefined
  if (!json || json === "{}") {
    cachedConfig = {}
    return cachedConfig
  }
  cachedConfig = helpers.json_to_table(json) as AutoStartConfig
  return cachedConfig
}

export function isHeadlessMode(): boolean {
  return getAutoStartConfig().headless === true
}

export function isAutoStartEnabled(): boolean {
  const config = getAutoStartConfig()
  return config.mod !== undefined && config.mod !== ""
}

export function getAutoStartMod(): string | undefined {
  return getAutoStartConfig().mod
}
```

#### 4. mod/control/auto-start.ts

Update to use new auto-start config:
```typescript
import { Remote } from "../constants"
import { getAutoStartConfig, isAutoStartEnabled, isHeadlessMode } from "../factorio-test/auto-start-config"
import { LocalisedString } from "factorio:runtime"

script.on_load(() => {
  if (!isAutoStartEnabled()) return

  const headless = isHeadlessMode()
  const modToTest = getAutoStartConfig().mod!

  script.on_event(defines.events.on_tick, () => {
    script.on_event(defines.events.on_tick, undefined)

    function autoStartError(message: LocalisedString) {
      if (!headless) game.print(message)
      log(message)
      print("FACTORIO-TEST-MESSAGE-START")
      log(message)
      print("FACTORIO-TEST-MESSAGE-END")
      print("FACTORIO-TEST-RESULT:could not auto start")
      if (headless) error("FACTORIO-TEST-EXIT")
    }

    if (!(modToTest in script.active_mods)) {
      return autoStartError(`Cannot auto-start tests: mod ${modToTest} is not active.`)
    }

    if (remote.interfaces[Remote.FactorioTest] == undefined) {
      return autoStartError("Cannot auto-start tests: the selected mod is not registered with Factorio Test.")
    }

    remote.call(Remote.FactorioTest, "runTests", modToTest)
  })
})
```

#### 5. mod/control.ts

Update auto-start check:
```typescript
import { isAutoStartEnabled, getAutoStartMod } from "./factorio-test/auto-start-config"

const shouldAutoStart = isAutoStartEnabled() && getAutoStartMod() === script.mod_name
```

#### 6. mod/factorio-test/load.ts

Update headless check at line 100:
```typescript
import { isHeadlessMode, getAutoStartMod } from "./auto-start-config"

// Replace line 61-63
const autoStartMod = getAutoStartMod()
const manualMod = settings.global[Settings.ModToTest]!.value
const modToTest = autoStartMod || manualMod

// Replace line 100
const headless = isHeadlessMode()
```

#### 7. mod/factorio-test/builtin-test-event-listeners.ts

Update headless check at line 9:
```typescript
import { isHeadlessMode } from "./auto-start-config"

// Replace line 9
if (isHeadlessMode()) {
```

#### 8. cli/mod-setup.ts

Update `setSettingsForAutorun` to use new setting:
```typescript
export async function setSettingsForAutorun(
  factorioPath: string,
  dataDir: string,
  modsDir: string,
  modToTest: string,
  mode: "headless" | "graphics",
  verbose?: boolean,
): Promise<void> {
  // ... existing mod-settings.dat creation ...

  if (verbose) console.log("Setting autorun settings")
  const autoStartConfig = JSON.stringify({
    mod: modToTest,
    headless: mode === "headless",
  })
  await runScript("fmtk settings set startup factorio-test-auto-start-config", `'${autoStartConfig}'`, "--modsPath", modsDir)
}

export async function resetAutorunSettings(modsDir: string, verbose?: boolean): Promise<void> {
  if (verbose) console.log("Disabling auto-start settings")
  await runScript("fmtk settings set startup factorio-test-auto-start-config", "{}", "--modsPath", modsDir)
}
```

### Success Criteria:

#### Automated Verification:
- [x] Build passes: `npm run build --workspace=cli && npm run build --workspace=mod`
- [x] Tests pass: `npm run test --workspace=cli && npm run test --workspace=mod`
- [x] Integration tests pass: `npm run test:integration`

---

## Phase 2: Refactor CLI Output Handling

### Overview
Refactor `createLineHandler` into event-driven architecture with clear separation of concerns.

### Changes Required:

#### 1. cli/factorio-output-handler.ts (new file)

Parses raw lines into typed events:

```typescript
import { EventEmitter } from "events"
import { parseEvent } from "./event-parser.js"
import { TestRunnerEvent } from "../types/events.js"

interface FactorioOutputEvents {
  event: [TestRunnerEvent]
  log: [string]
  message: [string]
  result: [string]
}

export class FactorioOutputHandler extends EventEmitter<FactorioOutputEvents> {
  private inMessage = false

  handleLine(line: string): void {
    if (line.startsWith("FACTORIO-TEST-RESULT:")) {
      this.emit("result", line.slice("FACTORIO-TEST-RESULT:".length))
      return
    }

    if (line === "FACTORIO-TEST-MESSAGE-START") {
      this.inMessage = true
      return
    }
    if (line === "FACTORIO-TEST-MESSAGE-END") {
      this.inMessage = false
      return
    }

    const event = parseEvent(line)
    if (event) {
      this.emit("event", event)
      return
    }

    if (this.inMessage) {
      this.emit("message", line)
    } else {
      this.emit("log", line)
    }
  }
}
```

#### 2. cli/test-run-collector.ts

Extend to emit events when tests finish:

```typescript
import { EventEmitter } from "events"
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

interface CollectorEvents {
  testFinished: [CapturedTest]
  runFinished: [TestRunData]
}

export class TestRunCollector extends EventEmitter<CollectorEvents> {
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
          result: "passed",
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
        this.finishTest({
          path: event.test.path,
          source: event.test.source,
          result: "skipped",
          errors: [],
          logs: [],
        })
        break

      case "testTodo":
        this.flushCurrentTest()
        this.finishTest({
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
        this.emit("runFinished", this.data)
        break

      case "testRunCancelled":
        this.flushCurrentTest()
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
      this.finishTest(this.currentTest)
      this.currentTest = undefined
      this.currentLogs = []
    }
  }

  private finishTest(test: CapturedTest): void {
    this.data.tests.push(test)
    this.emit("testFinished", test)
  }
}
```

#### 3. cli/output-formatter.ts

Add `OutputPrinter` class to existing file:

```typescript
// ... existing OutputFormatter code ...

export interface OutputPrinterOptions {
  verbose?: boolean
  quiet?: boolean
  showOutput?: boolean
}

export class OutputPrinter {
  private formatter: OutputFormatter
  private isMessageFirstLine = true

  constructor(private options: OutputPrinterOptions) {
    this.formatter = new OutputFormatter({
      verbose: options.verbose,
      quiet: options.quiet,
      showPassedLogs: options.verbose,
    })
  }

  printTestResult(test: CapturedTest): void {
    if (!this.options.quiet) {
      this.formatter.formatTestResult(test)
    }
  }

  printMessage(line: string): void {
    if (!this.options.showOutput) return
    if (this.isMessageFirstLine) {
      console.log(line.slice(line.indexOf(": ") + 2))
      this.isMessageFirstLine = false
    } else {
      console.log("    " + line)
    }
  }

  resetMessage(): void {
    this.isMessageFirstLine = true
  }

  printVerbose(line: string): void {
    if (this.options.verbose) {
      console.log(line)
    }
  }
}
```

#### 4. cli/factorio-process.ts

Replace `createLineHandler` with event-driven wiring:

```typescript
import { FactorioOutputHandler } from "./factorio-output-handler.js"
import { TestRunCollector, TestRunData } from "./test-run-collector.js"
import { OutputPrinter } from "./output-formatter.js"

export interface FactorioTestResult {
  status: "passed" | "failed" | "todo" | "loadError" | "could not auto start" | string
  hasFocusedTests: boolean
  message?: string
  data?: TestRunData
}

export async function runFactorioTestsHeadless(
  factorioPath: string,
  dataDir: string,
  savePath: string,
  additionalArgs: string[],
  options: FactorioTestOptions,
): Promise<FactorioTestResult> {
  const args = [
    "--benchmark", savePath,
    "--benchmark-ticks", "1000000000",
    "--mod-directory", path.join(dataDir, "mods"),
    "-c", path.join(dataDir, "config.ini"),
    ...additionalArgs,
  ]

  console.log("Running tests (headless)...")
  const factorioProcess = spawn(factorioPath, args, {
    stdio: ["inherit", "pipe", "pipe"],
  })

  const handler = new FactorioOutputHandler()
  const collector = new TestRunCollector()
  const printer = new OutputPrinter({
    verbose: options.verbose,
    quiet: !options.showOutput,
    showOutput: options.showOutput,
  })

  handler.on("event", (event) => {
    collector.handleEvent(event)
    if (options.verbose) console.log(JSON.stringify(event))
  })
  handler.on("log", (line) => {
    collector.captureLog(line)
    printer.printVerbose(line)
  })
  handler.on("message", (line) => printer.printMessage(line))

  collector.on("testFinished", (test) => printer.printTestResult(test))

  let resultMessage: string | undefined
  handler.on("result", (msg) => {
    resultMessage = msg
    printer.resetMessage()
  })

  new BufferLineSplitter(factorioProcess.stdout).on("line", (line) => handler.handleLine(line))
  new BufferLineSplitter(factorioProcess.stderr).on("line", (line) => handler.handleLine(line))

  await new Promise<void>((resolve, reject) => {
    factorioProcess.on("exit", (code, signal) => {
      if (resultMessage !== undefined) resolve()
      else reject(new Error(`Factorio exited with code ${code}, signal ${signal}, no result received`))
    })
  })

  const parsed = parseResultMessage(resultMessage!)
  return { ...parsed, message: resultMessage, data: collector.getData() }
}

export async function runFactorioTestsGraphics(
  factorioPath: string,
  dataDir: string,
  savePath: string,
  additionalArgs: string[],
  options: FactorioTestOptions,
): Promise<FactorioTestResult> {
  const args = [
    "--load-game", savePath,
    "--mod-directory", path.join(dataDir, "mods"),
    "-c", path.join(dataDir, "config.ini"),
    ...additionalArgs,
  ]

  console.log("Running tests (graphics)...")
  const factorioProcess = spawn(factorioPath, args, {
    stdio: ["inherit", "pipe", "inherit"],
  })

  const handler = new FactorioOutputHandler()
  const collector = new TestRunCollector()
  const printer = new OutputPrinter({
    verbose: options.verbose,
    quiet: !options.showOutput,
    showOutput: options.showOutput,
  })

  handler.on("event", (event) => {
    collector.handleEvent(event)
    if (options.verbose) console.log(JSON.stringify(event))
  })
  handler.on("log", (line) => {
    collector.captureLog(line)
    printer.printVerbose(line)
  })
  handler.on("message", (line) => printer.printMessage(line))

  collector.on("testFinished", (test) => printer.printTestResult(test))

  let resultMessage: string | undefined
  handler.on("result", (msg) => {
    resultMessage = msg
    printer.resetMessage()
  })

  new BufferLineSplitter(factorioProcess.stdout).on("line", (line) => handler.handleLine(line))

  await new Promise<void>((resolve, reject) => {
    factorioProcess.on("exit", (code, signal) => {
      if (resultMessage !== undefined) resolve()
      else reject(new Error(`Factorio exited with code ${code}, signal ${signal}`))
    })
  })

  const parsed = parseResultMessage(resultMessage!)
  return { ...parsed, message: resultMessage, data: collector.getData() }
}
```

### Success Criteria:

#### Automated Verification:
- [x] Build passes: `npm run build --workspace=cli`
- [x] Tests pass: `npm run test --workspace=cli`
- [x] Integration tests pass: `npm run test:integration`

---

## Phase 3: Add reorder_failed_first Config Option

### Overview
Add `reorder_failed_first` to test config, configurable via CLI, config file, or in-mod.

### Changes Required:

#### 1. types/config.d.ts

Add new option:
```typescript
export interface TestRunnerConfig {
  test_pattern?: string
  tag_whitelist?: string[]
  tag_blacklist?: string[]
  default_timeout?: number
  game_speed?: number
  log_passed_tests?: boolean
  log_skipped_tests?: boolean
  reorder_failed_first?: boolean
}
```

#### 2. cli/schema.ts

Add to schema and CLI option:
```typescript
// In testRunnerConfigSchema
reorder_failed_first: z.boolean().optional(),

// In testRunnerCliOptions
reorder_failed_first: { flags: "--reorder-failed-first", description: "Run previously failed tests first (default: true)" },

// In registerTestRunnerOptions, add negatable option
if (key === "reorder_failed_first") {
  command.option("--no-reorder-failed-first", "Don't reorder failed tests first")
}
```

#### 3. mod/factorio-test/config.ts

Add default:
```typescript
const defaultConfig: Config = {
  default_timeout: 60 * 60,
  default_ticks_between_tests: 1,
  game_speed: 1000,
  log_passed_tests: true,
  log_skipped_tests: false,
  sound_effects: false,
  reorder_failed_first: true,
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Build passes: `npm run build --workspace=cli && npm run build --workspace=mod`
- [ ] Tests pass: `npm run test --workspace=cli`

---

## Phase 4: Write Results File

### Overview
Write test results to JSON file after test run. Collector data is already exposed from Phase 2 refactor.

### Changes Required:

#### 1. cli/results-writer.ts (new file)

```typescript
import * as fsp from "fs/promises"
import * as path from "path"
import { TestRunData } from "./test-run-collector.js"

export interface ResultsFileContent {
  timestamp: string
  modName: string
  summary: TestRunData["summary"]
  tests: {
    path: string
    result: "passed" | "failed" | "skipped" | "todo"
    duration?: string
    errors?: string[]
  }[]
}

export async function writeResultsFile(
  outputPath: string,
  modName: string,
  data: TestRunData,
): Promise<void> {
  const content: ResultsFileContent = {
    timestamp: new Date().toISOString(),
    modName,
    summary: data.summary,
    tests: data.tests.map((t) => ({
      path: t.path,
      result: t.result,
      ...(t.duration && { duration: t.duration }),
      ...(t.errors.length > 0 && { errors: t.errors }),
    })),
  }
  await fsp.mkdir(path.dirname(outputPath), { recursive: true })
  await fsp.writeFile(outputPath, JSON.stringify(content, null, 2))
}

export async function readPreviousFailedTests(outputPath: string): Promise<string[]> {
  try {
    const content = await fsp.readFile(outputPath, "utf-8")
    const parsed = JSON.parse(content) as ResultsFileContent
    return parsed.tests.filter((t) => t.result === "failed").map((t) => t.path)
  } catch {
    return []
  }
}

export function getDefaultOutputPath(dataDir: string): string {
  return path.join(dataDir, "test-results.json")
}
```

#### 2. cli/schema.ts

Add output file options:
```typescript
// In cliConfigSchema
outputFile: z.string().optional(),
noOutputFile: z.boolean().optional(),
```

#### 3. cli/run.ts

Add options and file writing:
```typescript
import { writeResultsFile, readPreviousFailedTests, getDefaultOutputPath } from "./results-writer.js"

// Add CLI options
.option("--output-file <path>", "Path to write test results JSON file")
.option("--no-output-file", "Disable writing test results file")

// Add to options type
outputFile?: string
noOutputFile?: boolean
reorderFailedFirst?: boolean

// Before running tests, read previous failures
const outputPath = options.outputFile ?? fileConfig.outputFile ?? getDefaultOutputPath(dataDir)
const reorderEnabled = options.reorderFailedFirst ?? fileConfig.test?.reorder_failed_first ?? true
let lastFailedTests: string[] = []
if (reorderEnabled) {
  lastFailedTests = await readPreviousFailedTests(outputPath)
}

// Update auto-start config to include last_failed_tests
const autoStartConfig = JSON.stringify({
  mod: modToTest,
  headless: mode === "headless",
  ...(lastFailedTests.length > 0 && { last_failed_tests: lastFailedTests }),
})
await runScript("fmtk settings set startup factorio-test-auto-start-config", `'${autoStartConfig}'`, "--modsPath", modsDir)

// After test run, write results file
if (!options.noOutputFile && result.data) {
  await writeResultsFile(outputPath, modToTest, result.data)
  if (options.verbose) console.log(`Results written to ${outputPath}`)
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Build passes: `npm run build --workspace=cli`
- [ ] Tests pass: `npm run test --workspace=cli`
- [ ] Integration tests pass: `npm run test:integration`

#### Manual Verification:
- [ ] Run tests, verify JSON file created in data directory
- [ ] Verify JSON structure matches specification

---

## Phase 5: Implement Test Reordering in Mod

### Overview
Sort tests to run previously failed tests first. If a deeply nested test failed, parent describe blocks should also be prioritized.

### Approach
1. Build set of failed test paths once from `last_failed_tests` - O(f)
2. Single pass over tree to mark failed tests and propagate `_hasFailedDescendant` up - O(n)
3. When entering each describe block, reorder using flags only (no set lookups) - O(n log k) total

### Changes Required:

#### 1. mod/factorio-test/test-reordering.ts (new file)

```typescript
import { DescribeBlock, Test } from "./tests"
import { getAutoStartConfig } from "./auto-start-config"
import { TestState } from "./state"

export function shouldReorderFailedFirst(state: TestState): boolean {
  return state.config.reorder_failed_first !== false &&
         (getAutoStartConfig().last_failed_tests?.length ?? 0) > 0
}

export function markFailedTestsAndDescendants(block: DescribeBlock): void {
  const failedPaths = new LuaSet<string>()
  for (const path of getAutoStartConfig().last_failed_tests ?? []) {
    failedPaths.add(path)
  }
  markRecursive(block, failedPaths)
}

function markRecursive(block: DescribeBlock, failedPaths: LuaSet<string>): boolean {
  let hasFailedDescendant = false

  for (const child of block.children) {
    if (child.type === "test") {
      if (failedPaths.has(child.path)) {
        child._previouslyFailed = true
        hasFailedDescendant = true
      }
    } else {
      if (markRecursive(child, failedPaths)) {
        child._hasFailedDescendant = true
        hasFailedDescendant = true
      }
    }
  }

  return hasFailedDescendant
}

export function reorderChildren(block: DescribeBlock): void {
  if (block._reordered) return
  block._reordered = true

  table.sort(block.children, (a, b) => {
    const aPriority = hasPriority(a)
    const bPriority = hasPriority(b)
    if (aPriority && !bPriority) return true
    if (!aPriority && bPriority) return false
    return a.indexInParent < b.indexInParent
  })
}

function hasPriority(node: Test | DescribeBlock): boolean {
  if (node.type === "test") {
    return node._previouslyFailed === true
  }
  return node._hasFailedDescendant === true
}
```

#### 2. mod/factorio-test/runner.ts

Import and use reordering:
```typescript
import { shouldReorderFailedFirst, markFailedTestsAndDescendants, reorderChildren } from "./test-reordering"

// In startTestRun(), after test tree is built but before execution:
if (shouldReorderFailedFirst(this.state)) {
  markFailedTestsAndDescendants(this.state.rootBlock)
}

// In enterDescribeBlock(), before iterating children:
if (shouldReorderFailedFirst(this.state)) {
  reorderChildren(block)
}
```

#### 3. mod/factorio-test/tests.ts

Add flags to interfaces:
```typescript
export interface Test {
  // ... existing fields ...
  _previouslyFailed?: boolean
}

export interface DescribeBlock {
  // ... existing fields ...
  _hasFailedDescendant?: boolean
  _reordered?: boolean
}
```

### Success Criteria:

#### Automated Verification:
- [ ] Build passes: `npm run build --workspace=mod`
- [ ] Tests pass: `npm run test --workspace=mod`
- [ ] Integration tests pass: `npm run test:integration`

#### Manual Verification:
- [ ] Run tests with failures, then run again
- [ ] Verify console output shows failed tests running first

---

## Phase 6: Add Unit Tests

### Overview
Add unit tests for new modules and functionality.

### Changes Required:

#### 1. cli/results-writer.test.ts (new file)

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fsp from "fs/promises"
import { writeResultsFile, readPreviousFailedTests, getDefaultOutputPath, ResultsFileContent } from "./results-writer.js"
import { TestRunData } from "./test-run-collector.js"

vi.mock("fs/promises")

describe("writeResultsFile", () => {
  beforeEach(() => {
    vi.mocked(fsp.mkdir).mockResolvedValue(undefined)
    vi.mocked(fsp.writeFile).mockResolvedValue()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it("writes results with correct structure", async () => {
    const data: TestRunData = {
      tests: [
        { path: "test1", result: "passed", errors: [], logs: [], duration: "1 ms" },
        { path: "test2", result: "failed", errors: ["error"], logs: [], duration: "2 ms" },
      ],
      summary: {
        ran: 2, passed: 1, failed: 1, skipped: 0, todo: 0,
        cancelled: 0, describeBlockErrors: 0, status: "failed",
      },
    }

    await writeResultsFile("/out/results.json", "test-mod", data)

    expect(fsp.mkdir).toHaveBeenCalledWith("/out", { recursive: true })
    const written = JSON.parse(vi.mocked(fsp.writeFile).mock.calls[0][1] as string) as ResultsFileContent
    expect(written.modName).toBe("test-mod")
    expect(written.tests).toHaveLength(2)
    expect(written.tests[0].errors).toBeUndefined()
    expect(written.tests[1].errors).toEqual(["error"])
  })

  it("omits duration when not present", async () => {
    const data: TestRunData = {
      tests: [{ path: "test1", result: "skipped", errors: [], logs: [] }],
    }

    await writeResultsFile("/out/results.json", "test-mod", data)

    const written = JSON.parse(vi.mocked(fsp.writeFile).mock.calls[0][1] as string) as ResultsFileContent
    expect(written.tests[0].duration).toBeUndefined()
  })
})

describe("readPreviousFailedTests", () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it("returns failed test paths", async () => {
    const content: ResultsFileContent = {
      timestamp: "2026-01-24T00:00:00Z",
      modName: "test",
      tests: [
        { path: "passing", result: "passed" },
        { path: "failing1", result: "failed" },
        { path: "failing2", result: "failed" },
      ],
    }
    vi.mocked(fsp.readFile).mockResolvedValue(JSON.stringify(content))

    const result = await readPreviousFailedTests("/path/to/results.json")

    expect(result).toEqual(["failing1", "failing2"])
  })

  it("returns empty array on file not found", async () => {
    vi.mocked(fsp.readFile).mockRejectedValue(new Error("ENOENT"))

    const result = await readPreviousFailedTests("/path/to/results.json")

    expect(result).toEqual([])
  })
})

describe("getDefaultOutputPath", () => {
  it("returns path in data directory", () => {
    expect(getDefaultOutputPath("/data/dir")).toBe("/data/dir/test-results.json")
  })
})
```

### Success Criteria:

#### Automated Verification:
- [ ] Tests pass: `npm run test --workspace=cli`

---

## Testing Strategy

### Unit Tests:
- `results-writer.test.ts`: File writing, reading previous results, path generation
- Existing tests continue to pass

### Integration Tests:
- Results file created with correct structure
- Failed tests reordered on subsequent run

---

## References

- Original feature doc: `thoughts/scratch/plans/features/test-results-file.md`
- Test collector: `cli/test-run-collector.ts`
- Config schema: `cli/schema.ts`
- Test runner: `mod/factorio-test/runner.ts`
- Current settings: `mod/settings.ts`

import { EventEmitter } from "events"
import * as fsp from "fs/promises"
import * as path from "path"
import { TestRunnerEvent, TestRunSummary, SourceLocation } from "../types/events.js"

export interface CapturedTest {
  path: string
  source?: SourceLocation
  result: "passed" | "failed" | "error" | "skipped" | "todo"
  errors: string[]
  logs: string[]
  durationMs?: number
}

export interface TestRunData {
  tests: CapturedTest[]
  summary?: TestRunSummary
}

interface CollectorEvents {
  testFinished: [CapturedTest]
  describeBlockFailed: [CapturedTest]
  runFinished: [TestRunData]
}

export class TestRunCollector extends EventEmitter<CollectorEvents> {
  private data: TestRunData = { tests: [] }
  private currentTest: CapturedTest | undefined
  private currentLogs: string[] = []
  private pendingLogs: string[] = []
  private testStartTime: number | undefined

  handleEvent(event: TestRunnerEvent): void {
    switch (event.type) {
      case "testStarted":
        this.flushCurrentTest()
        this.pendingLogs = []
        this.testStartTime = performance.now()
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
          if (this.testStartTime !== undefined) {
            this.currentTest.durationMs = performance.now() - this.testStartTime
          }
          this.currentTest.logs = [...this.currentLogs]
        }
        this.flushCurrentTest()
        break

      case "testFailed":
        if (this.currentTest) {
          this.currentTest.result = "failed"
          this.currentTest.errors = event.errors
          if (this.testStartTime !== undefined) {
            this.currentTest.durationMs = performance.now() - this.testStartTime
          }
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

      case "describeBlockFailed": {
        this.flushCurrentTest()
        const captured: CapturedTest = {
          path: event.block.path,
          source: event.block.source,
          result: "error",
          errors: event.errors,
          logs: [...this.pendingLogs],
        }
        this.data.tests.push(captured)
        this.emit("describeBlockFailed", captured)
        this.pendingLogs = []
        break
      }

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
    } else {
      this.pendingLogs.push(line)
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
      this.testStartTime = undefined
    }
  }

  private finishTest(test: CapturedTest): void {
    this.data.tests.push(test)
    this.emit("testFinished", test)
  }
}

export interface ResultsFileContent {
  timestamp: string
  modName: string
  summary: TestRunData["summary"]
  tests: {
    path: string
    result: "passed" | "failed" | "error" | "skipped" | "todo"
    durationMs?: number
    errors?: string[]
  }[]
}

export async function writeResultsFile(outputPath: string, modName: string, data: TestRunData): Promise<void> {
  const content: ResultsFileContent = {
    timestamp: new Date().toISOString(),
    modName,
    summary: data.summary,
    tests: data.tests.map((t) => ({
      path: t.path,
      result: t.result,
      ...(t.durationMs !== undefined && { durationMs: t.durationMs }),
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

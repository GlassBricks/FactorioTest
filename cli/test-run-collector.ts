import { TestRunnerEvent, TestRunSummary, SourceLocation } from "../types/events.js"

export interface CapturedTest {
  path: string
  source?: SourceLocation
  result: "passed" | "failed" | "skipped" | "todo"
  errors: string[]
  logs: string[]
  durationMs?: number
}

export interface TestRunData {
  tests: CapturedTest[]
  summary?: TestRunSummary
}

export class TestRunCollector {
  private data: TestRunData = { tests: [] }
  private currentTest: CapturedTest | undefined
  private currentLogs: string[] = []
  private testStartTime: number | undefined

  handleEvent(event: TestRunnerEvent): void {
    switch (event.type) {
      case "testStarted":
        this.flushCurrentTest()
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
      this.data.tests.push(this.currentTest)
      this.currentTest = undefined
      this.currentLogs = []
      this.testStartTime = undefined
    }
  }
}

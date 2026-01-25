import { describe, it, expect, beforeEach } from "vitest"
import { TestRunCollector } from "./test-run-collector.js"

describe("TestRunCollector", () => {
  let collector: TestRunCollector

  beforeEach(() => {
    collector = new TestRunCollector()
  })

  it("handles testStarted followed by testPassed", () => {
    collector.handleEvent({ type: "testStarted", test: { path: "root > test1" } })
    collector.handleEvent({ type: "testPassed", test: { path: "root > test1", duration: "1.5 ms" } })

    const data = collector.getData()
    expect(data.tests).toHaveLength(1)
    expect(data.tests[0]).toEqual({
      path: "root > test1",
      source: undefined,
      result: "passed",
      errors: [],
      logs: [],
      duration: "1.5 ms",
    })
  })

  it("handles testStarted followed by testFailed with errors", () => {
    collector.handleEvent({ type: "testStarted", test: { path: "test" } })
    collector.handleEvent({
      type: "testFailed",
      test: { path: "test" },
      errors: ["assertion failed", "stack trace"],
    })

    const data = collector.getData()
    expect(data.tests).toHaveLength(1)
    expect(data.tests[0].result).toBe("failed")
    expect(data.tests[0].errors).toEqual(["assertion failed", "stack trace"])
  })

  it("captures logs between testStarted and result", () => {
    collector.handleEvent({ type: "testStarted", test: { path: "test" } })
    collector.captureLog("log line 1")
    collector.captureLog("log line 2")
    collector.handleEvent({ type: "testPassed", test: { path: "test" } })

    const data = collector.getData()
    expect(data.tests[0].logs).toEqual(["log line 1", "log line 2"])
  })

  it("does not capture logs when no test is running", () => {
    collector.captureLog("orphan log")
    collector.handleEvent({ type: "testSkipped", test: { path: "test" } })

    const data = collector.getData()
    expect(data.tests[0].logs).toEqual([])
  })

  it("handles testSkipped without prior testStarted", () => {
    collector.handleEvent({ type: "testSkipped", test: { path: "skipped test" } })

    const data = collector.getData()
    expect(data.tests).toHaveLength(1)
    expect(data.tests[0]).toEqual({
      path: "skipped test",
      source: undefined,
      result: "skipped",
      errors: [],
      logs: [],
    })
  })

  it("handles testTodo without prior testStarted", () => {
    collector.handleEvent({ type: "testTodo", test: { path: "todo test" } })

    const data = collector.getData()
    expect(data.tests).toHaveLength(1)
    expect(data.tests[0].result).toBe("todo")
  })

  it("associates logs with correct test when multiple tests run", () => {
    collector.handleEvent({ type: "testStarted", test: { path: "test1" } })
    collector.captureLog("test1 log")
    collector.handleEvent({ type: "testPassed", test: { path: "test1" } })

    collector.handleEvent({ type: "testStarted", test: { path: "test2" } })
    collector.captureLog("test2 log")
    collector.handleEvent({ type: "testPassed", test: { path: "test2" } })

    const data = collector.getData()
    expect(data.tests[0].logs).toEqual(["test1 log"])
    expect(data.tests[1].logs).toEqual(["test2 log"])
  })

  it("stores testRunFinished summary", () => {
    collector.handleEvent({
      type: "testRunFinished",
      results: {
        ran: 5,
        passed: 3,
        failed: 1,
        skipped: 1,
        todo: 0,
        cancelled: 0,
        describeBlockErrors: 0,
        status: "failed",
      },
    })

    const data = collector.getData()
    expect(data.summary?.status).toBe("failed")
    expect(data.summary?.ran).toBe(5)
  })

  it("preserves source location when provided", () => {
    collector.handleEvent({
      type: "testStarted",
      test: { path: "test", source: { file: "test.ts", line: 42 } },
    })
    collector.handleEvent({ type: "testPassed", test: { path: "test" } })

    const data = collector.getData()
    expect(data.tests[0].source).toEqual({ file: "test.ts", line: 42 })
  })
})

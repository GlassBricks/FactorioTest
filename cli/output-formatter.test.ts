import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { OutputFormatter } from "./output-formatter.js"
import { CapturedTest } from "./test-run-collector.js"

describe("OutputFormatter", () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>
  let output: string[]

  beforeEach(() => {
    output = []
    consoleSpy = vi.spyOn(console, "log").mockImplementation((...args) => {
      output.push(args.join(" "))
    })
  })

  afterEach(() => {
    consoleSpy.mockRestore()
  })

  const passedTest: CapturedTest = {
    path: "root > test1",
    result: "passed",
    errors: [],
    logs: [],
    durationMs: 1.23,
  }

  const failedTest: CapturedTest = {
    path: "root > failing",
    result: "failed",
    errors: ["assertion failed", "at test.ts:10"],
    logs: ["debug output"],
    durationMs: 0.5,
  }

  it("formats passed test with duration", () => {
    const formatter = new OutputFormatter({})
    formatter.formatTestResult(passedTest)

    expect(output).toHaveLength(1)
    expect(output[0]).toContain("PASS")
    expect(output[0]).toContain("root > test1")
    expect(output[0]).toContain("1.2ms")
  })

  it("formats failed test with errors", () => {
    const formatter = new OutputFormatter({})
    formatter.formatTestResult(failedTest)

    expect(output.some((line) => line.includes("FAIL"))).toBe(true)
    expect(output.some((line) => line.includes("assertion failed"))).toBe(true)
    expect(output.some((line) => line.includes("at test.ts:10"))).toBe(true)
  })

  it("shows logs before failed test result", () => {
    const formatter = new OutputFormatter({})
    formatter.formatTestResult(failedTest)

    const logIndex = output.findIndex((line) => line.includes("debug output"))
    const failIndex = output.findIndex((line) => line.includes("FAIL"))
    expect(logIndex).toBeLessThan(failIndex)
  })

  it("hides logs for passed tests by default", () => {
    const formatter = new OutputFormatter({})
    const testWithLogs: CapturedTest = { ...passedTest, logs: ["should not appear"] }
    formatter.formatTestResult(testWithLogs)

    expect(output.some((line) => line.includes("should not appear"))).toBe(false)
  })

  it("shows logs for passed tests when showPassedLogs is true", () => {
    const formatter = new OutputFormatter({ showPassedLogs: true })
    const testWithLogs: CapturedTest = { ...passedTest, logs: ["visible log"] }
    formatter.formatTestResult(testWithLogs)

    expect(output.some((line) => line.includes("visible log"))).toBe(true)
  })

  it("suppresses all output when quiet is true", () => {
    const formatter = new OutputFormatter({ quiet: true })
    formatter.formatTestResult(passedTest)
    formatter.formatTestResult(failedTest)

    expect(output).toHaveLength(0)
  })

  it("formats skipped test", () => {
    const formatter = new OutputFormatter({})
    const skippedTest: CapturedTest = {
      path: "skipped test",
      result: "skipped",
      errors: [],
      logs: [],
    }
    formatter.formatTestResult(skippedTest)

    expect(output[0]).toContain("SKIP")
    expect(output[0]).toContain("skipped test")
  })

  it("formats todo test", () => {
    const formatter = new OutputFormatter({})
    const todoTest: CapturedTest = {
      path: "todo test",
      result: "todo",
      errors: [],
      logs: [],
    }
    formatter.formatTestResult(todoTest)

    expect(output[0]).toContain("TODO")
    expect(output[0]).toContain("todo test")
  })
})

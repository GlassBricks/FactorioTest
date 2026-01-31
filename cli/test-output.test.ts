import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import logUpdate from "log-update"
import { ProgressRenderer, OutputFormatter, OutputPrinter, CapturedTest, TestRunData } from "./test-output.js"

vi.mock("log-update", () => ({
  default: Object.assign(vi.fn(), { clear: vi.fn() }),
}))

describe("ProgressRenderer", () => {
  beforeEach(() => {
    vi.mocked(logUpdate).mockClear()
    vi.mocked(logUpdate.clear).mockClear()
  })

  describe("withPermanentOutput", () => {
    it("clears and re-renders around permanent output when active", () => {
      const renderer = new ProgressRenderer(true)
      renderer.handleEvent({ type: "testRunStarted", total: 10 })
      renderer.handleEvent({ type: "testStarted", test: { path: "test" } })

      vi.mocked(logUpdate).mockClear()
      vi.mocked(logUpdate.clear).mockClear()

      let callbackExecuted = false
      renderer.withPermanentOutput(() => {
        callbackExecuted = true
      })

      expect(logUpdate.clear).toHaveBeenCalledTimes(1)
      expect(callbackExecuted).toBe(true)
      expect(logUpdate).toHaveBeenCalledTimes(1)
    })

    it("executes callback without clear when not active", () => {
      const renderer = new ProgressRenderer(true)

      let callbackExecuted = false
      renderer.withPermanentOutput(() => {
        callbackExecuted = true
      })

      expect(callbackExecuted).toBe(true)
      expect(logUpdate.clear).not.toHaveBeenCalled()
    })

    it("executes callback without clear when not TTY", () => {
      const renderer = new ProgressRenderer(false)

      let callbackExecuted = false
      renderer.withPermanentOutput(() => {
        callbackExecuted = true
      })

      expect(callbackExecuted).toBe(true)
      expect(logUpdate.clear).not.toHaveBeenCalled()
      expect(logUpdate).not.toHaveBeenCalled()
    })
  })

  describe("render", () => {
    it("renders nothing when not TTY", () => {
      const renderer = new ProgressRenderer(false)
      renderer.handleEvent({ type: "testRunStarted", total: 10 })
      renderer.handleEvent({ type: "testStarted", test: { path: "test" } })
      expect(logUpdate).not.toHaveBeenCalled()
    })

    it("renders progress bar when TTY via withPermanentOutput", () => {
      const renderer = new ProgressRenderer(true)
      renderer.handleEvent({ type: "testRunStarted", total: 10 })
      renderer.handleEvent({ type: "testStarted", test: { path: "test" } })

      vi.mocked(logUpdate).mockClear()

      renderer.handleTestFinished({ path: "test", result: "passed", errors: [], logs: [] })
      renderer.withPermanentOutput(() => {})

      expect(logUpdate).toHaveBeenCalled()
      const output = vi.mocked(logUpdate).mock.calls[0][0]
      expect(output).toContain("10%")
      expect(output).toContain("1/10")
    })

    it("includes current test when running", () => {
      const renderer = new ProgressRenderer(true)
      renderer.handleEvent({ type: "testRunStarted", total: 10 })
      renderer.handleEvent({ type: "testStarted", test: { path: "describe > my test" } })
      const output = vi.mocked(logUpdate).mock.calls[0][0]
      expect(output).toContain("Running: describe > my test")
    })

    it("handles ran exceeding total without error", () => {
      const renderer = new ProgressRenderer(true)
      renderer.handleEvent({ type: "testRunStarted", total: 2 })

      for (let i = 0; i < 5; i++) {
        renderer.handleTestFinished({ path: `test${i}`, result: "passed", errors: [], logs: [] })
      }

      expect(() => {
        renderer.handleEvent({ type: "testStarted", test: { path: "extra test" } })
      }).not.toThrow()
    })

    it("does not count skipped or todo tests in ran", () => {
      const renderer = new ProgressRenderer(true)
      renderer.handleEvent({ type: "testRunStarted", total: 2 })

      renderer.handleTestFinished({ path: "test1", result: "passed", errors: [], logs: [] })
      renderer.handleTestFinished({ path: "skipped", result: "skipped", errors: [], logs: [] })
      renderer.handleTestFinished({ path: "todo", result: "todo", errors: [], logs: [] })
      renderer.handleTestFinished({ path: "test2", result: "failed", errors: [], logs: [] })

      vi.mocked(logUpdate).mockClear()
      renderer.handleEvent({ type: "testStarted", test: { path: "next" } })

      const output = vi.mocked(logUpdate).mock.calls[0][0]
      expect(output).toContain("2/2")
      expect(output).toContain("100%")
    })
  })

  describe("finish", () => {
    it("clears on finish when active", () => {
      const renderer = new ProgressRenderer(true)
      renderer.handleEvent({ type: "testRunStarted", total: 10 })
      renderer.handleEvent({ type: "testStarted", test: { path: "test" } })
      renderer.finish()
      expect(logUpdate.clear).toHaveBeenCalled()
    })

    it("does not clear when not active", () => {
      const renderer = new ProgressRenderer(true)
      renderer.finish()
      expect(logUpdate.clear).not.toHaveBeenCalled()
    })
  })
})

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

describe("OutputFormatter.formatSummary", () => {
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

  const makeSummary = (
    overrides: Partial<TestRunData["summary"] & object> = {},
  ): NonNullable<TestRunData["summary"]> => ({
    ran: 0,
    passed: 0,
    failed: 0,
    skipped: 0,
    todo: 0,
    cancelled: 0,
    describeBlockErrors: 0,
    status: "passed",
    ...overrides,
  })

  it("shows only counts line when no failures or todos", () => {
    const formatter = new OutputFormatter({})
    const data: TestRunData = {
      tests: [{ path: "a", result: "passed", errors: [], logs: [] }],
      summary: makeSummary({ ran: 1, passed: 1 }),
    }
    formatter.formatSummary(data)

    expect(output.some((l) => l.includes("Tests:"))).toBe(true)
    expect(output.some((l) => l.includes("1 passed"))).toBe(true)
    expect(output.some((l) => l.includes("Failures:"))).toBe(false)
    expect(output.some((l) => l.includes("Todo:"))).toBe(false)
  })

  it("shows failure recap and counts line when there are failures", () => {
    const formatter = new OutputFormatter({})
    const data: TestRunData = {
      tests: [
        { path: "a", result: "passed", errors: [], logs: [] },
        { path: "b", result: "failed", errors: ["err1"], logs: [], durationMs: 0.5 },
      ],
      summary: makeSummary({ ran: 2, passed: 1, failed: 1, status: "failed" }),
    }
    formatter.formatSummary(data)

    expect(output.some((l) => l.includes("Failures:"))).toBe(true)
    const failLines = output.filter((l) => l.includes("FAIL"))
    expect(failLines.length).toBeGreaterThanOrEqual(1)
    expect(output.some((l) => l.includes("1 failed"))).toBe(true)
    expect(output.some((l) => l.includes("1 passed"))).toBe(true)
  })

  it("shows todo recap and counts line when there are todos", () => {
    const formatter = new OutputFormatter({})
    const data: TestRunData = {
      tests: [
        { path: "a", result: "passed", errors: [], logs: [] },
        { path: "b", result: "todo", errors: [], logs: [] },
      ],
      summary: makeSummary({ ran: 1, passed: 1, todo: 1, status: "todo" }),
    }
    formatter.formatSummary(data)

    expect(output.some((l) => l.includes("Todo:"))).toBe(true)
    expect(output.some((l) => l.includes("TODO"))).toBe(true)
    expect(output.some((l) => l.includes("1 todo"))).toBe(true)
  })

  it("omits zero-count categories except passed", () => {
    const formatter = new OutputFormatter({})
    const data: TestRunData = {
      tests: [{ path: "a", result: "passed", errors: [], logs: [] }],
      summary: makeSummary({ ran: 1, passed: 1 }),
    }
    formatter.formatSummary(data)

    const countsLine = output.find((l) => l.includes("Tests:"))!
    expect(countsLine).toContain("1 passed")
    expect(countsLine).not.toContain("failed")
    expect(countsLine).not.toContain("skipped")
    expect(countsLine).not.toContain("todo")
    expect(countsLine).toContain("(1 total)")
  })

  it("includes all non-zero categories in counts line", () => {
    const formatter = new OutputFormatter({})
    const data: TestRunData = {
      tests: [
        { path: "a", result: "passed", errors: [], logs: [] },
        { path: "b", result: "failed", errors: ["e"], logs: [] },
        { path: "c", result: "skipped", errors: [], logs: [] },
        { path: "d", result: "todo", errors: [], logs: [] },
      ],
      summary: makeSummary({ ran: 2, passed: 1, failed: 1, skipped: 1, todo: 1, status: "failed" }),
    }
    formatter.formatSummary(data)

    const countsLine = output.find((l) => l.includes("Tests:"))!
    expect(countsLine).toContain("1 failed")
    expect(countsLine).toContain("1 todo")
    expect(countsLine).toContain("1 skipped")
    expect(countsLine).toContain("1 passed")
    expect(countsLine).toContain("(4 total)")
  })

  it("does nothing when summary is undefined", () => {
    const formatter = new OutputFormatter({})
    formatter.formatSummary({ tests: [] })
    expect(output).toHaveLength(0)
  })
})

describe("OutputPrinter", () => {
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

  const skippedTest: CapturedTest = { path: "skipped", result: "skipped", errors: [], logs: [] }
  const todoTest: CapturedTest = { path: "todo", result: "todo", errors: [], logs: [] }
  const passedTest: CapturedTest = { path: "passed", result: "passed", errors: [], logs: [] }
  const failedTest: CapturedTest = { path: "failed", result: "failed", errors: ["err"], logs: [] }

  it("hides skipped tests without verbose", () => {
    const printer = new OutputPrinter({})
    printer.printTestResult(skippedTest)
    expect(output).toHaveLength(0)
  })

  it("shows todo tests without verbose", () => {
    const printer = new OutputPrinter({})
    printer.printTestResult(todoTest)
    expect(output.some((line) => line.includes("TODO"))).toBe(true)
  })

  it("shows skipped tests with verbose", () => {
    const printer = new OutputPrinter({ verbose: true })
    printer.printTestResult(skippedTest)
    expect(output.some((line) => line.includes("SKIP"))).toBe(true)
  })

  it("shows todo tests with verbose", () => {
    const printer = new OutputPrinter({ verbose: true })
    printer.printTestResult(todoTest)
    expect(output.some((line) => line.includes("TODO"))).toBe(true)
  })

  it("shows passed, failed, and todo tests without verbose", () => {
    const printer = new OutputPrinter({})
    printer.printTestResult(passedTest)
    printer.printTestResult(failedTest)
    printer.printTestResult(todoTest)
    expect(output.some((line) => line.includes("PASS"))).toBe(true)
    expect(output.some((line) => line.includes("FAIL"))).toBe(true)
    expect(output.some((line) => line.includes("TODO"))).toBe(true)
  })

  it("hides all tests in quiet mode", () => {
    const printer = new OutputPrinter({ quiet: true })
    printer.printTestResult(passedTest)
    printer.printTestResult(failedTest)
    printer.printTestResult(skippedTest)
    printer.printTestResult(todoTest)
    expect(output).toHaveLength(0)
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fsp from "fs/promises"
import {
  TestRunCollector,
  TestRunData,
  writeResultsFile,
  readPreviousFailedTests,
  getDefaultOutputPath,
  ResultsFileContent,
} from "./test-results.js"

vi.mock("fs/promises")

describe("TestRunCollector", () => {
  let collector: TestRunCollector

  beforeEach(() => {
    collector = new TestRunCollector()
  })

  it("handles testStarted followed by testPassed", () => {
    collector.handleEvent({ type: "testStarted", test: { path: "root > test1" } })
    collector.handleEvent({ type: "testPassed", test: { path: "root > test1" } })

    const data = collector.getData()
    expect(data.tests).toHaveLength(1)
    expect(data.tests[0].path).toBe("root > test1")
    expect(data.tests[0].result).toBe("passed")
    expect(data.tests[0].errors).toEqual([])
    expect(data.tests[0].logs).toEqual([])
    expect(typeof data.tests[0].durationMs).toBe("number")
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
        { path: "test1", result: "passed", errors: [], logs: [], durationMs: 1 },
        { path: "test2", result: "failed", errors: ["error"], logs: [], durationMs: 2 },
      ],
      summary: {
        ran: 2,
        passed: 1,
        failed: 1,
        skipped: 0,
        todo: 0,
        cancelled: 0,
        describeBlockErrors: 0,
        status: "failed",
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
    expect(written.tests[0].durationMs).toBeUndefined()
  })

  it("omits errors array when empty", async () => {
    const data: TestRunData = {
      tests: [{ path: "test1", result: "passed", errors: [], logs: [], durationMs: 5 }],
    }

    await writeResultsFile("/out/results.json", "test-mod", data)

    const written = JSON.parse(vi.mocked(fsp.writeFile).mock.calls[0][1] as string) as ResultsFileContent
    expect(written.tests[0].errors).toBeUndefined()
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
      summary: undefined,
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

  it("returns empty array on invalid JSON", async () => {
    vi.mocked(fsp.readFile).mockResolvedValue("not valid json")

    const result = await readPreviousFailedTests("/path/to/results.json")

    expect(result).toEqual([])
  })
})

describe("getDefaultOutputPath", () => {
  it("returns path in data directory", () => {
    expect(getDefaultOutputPath("/data/dir")).toBe("/data/dir/test-results.json")
  })
})

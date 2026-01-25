import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import * as fsp from "fs/promises"
import {
  writeResultsFile,
  readPreviousFailedTests,
  getDefaultOutputPath,
  ResultsFileContent,
} from "./results-writer.js"
import type { TestRunData } from "./test-run-collector.js"

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

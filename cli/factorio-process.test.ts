import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { parseResultMessage } from "./factorio-process.js"

vi.mock("child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("child_process")>()
  return {
    ...original,
    spawnSync: vi.fn(() => ({ status: 1 })),
  }
})

describe("parseResultMessage", () => {
  it.each([
    ["passed", { status: "passed", hasFocusedTests: false }],
    ["failed", { status: "failed", hasFocusedTests: false }],
    ["todo", { status: "todo", hasFocusedTests: false }],
    ["loadError", { status: "loadError", hasFocusedTests: false }],
    ["passed:focused", { status: "passed", hasFocusedTests: true }],
    ["failed:focused", { status: "failed", hasFocusedTests: true }],
    ["todo:focused", { status: "todo", hasFocusedTests: true }],
    ["bailed:failed", { status: "bailed", hasFocusedTests: false }],
    ["bailed:failed:focused", { status: "bailed", hasFocusedTests: true }],
  ] as const)("parses %s", (input, expected) => {
    expect(parseResultMessage(input)).toEqual(expected)
  })
})

describe("autoDetectFactorioPath", () => {
  beforeEach(() => {
    vi.resetModules()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it("returns 'factorio' if in PATH", async () => {
    const { spawnSync } = await import("child_process")
    vi.mocked(spawnSync).mockReturnValue({ status: 0 } as ReturnType<typeof spawnSync>)

    const { autoDetectFactorioPath } = await import("./factorio-process.js")
    expect(autoDetectFactorioPath()).toBe("factorio")
  })

  it("throws if no path found and factorio not in PATH", async () => {
    const { spawnSync } = await import("child_process")
    vi.mocked(spawnSync).mockReturnValue({ status: 1 } as ReturnType<typeof spawnSync>)

    const { autoDetectFactorioPath } = await import("./factorio-process.js")
    expect(() => autoDetectFactorioPath()).toThrow(/Could not auto-detect/)
  })
})

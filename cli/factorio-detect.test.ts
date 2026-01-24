import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

vi.mock("child_process", () => ({
  spawnSync: vi.fn(() => ({ status: 1 })),
}))

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

    const { autoDetectFactorioPath } = await import("./factorio-detect.js")
    expect(autoDetectFactorioPath()).toBe("factorio")
  })

  it("throws if no path found and factorio not in PATH", async () => {
    const { spawnSync } = await import("child_process")
    vi.mocked(spawnSync).mockReturnValue({ status: 1 } as ReturnType<typeof spawnSync>)

    const { autoDetectFactorioPath } = await import("./factorio-detect.js")
    expect(() => autoDetectFactorioPath()).toThrow(/Could not auto-detect/)
  })
})

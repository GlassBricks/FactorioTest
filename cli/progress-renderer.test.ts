import { describe, it, expect, vi, beforeEach } from "vitest"
import logUpdate from "log-update"
import { ProgressRenderer } from "./progress-renderer.js"

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

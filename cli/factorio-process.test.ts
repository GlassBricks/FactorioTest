import { EventEmitter } from "events"
import * as path from "path"
import { PassThrough } from "stream"
import { finished } from "stream/promises"
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { FactorioOutputHandler } from "./factorio-output-parser.js"
import {
  buildLaunchSteps,
  type HeadlessSuperviseOptions,
  type LaunchSteps,
  parseFactorioVersion,
  parseResultMessage,
} from "./factorio-process.js"
import type { RunMode } from "./factorio-setup.js"
import type { RunPlan } from "./run-plan.js"

vi.mock("child_process", async (importOriginal) => {
  const original = await importOriginal<typeof import("child_process")>()
  return {
    ...original,
    spawnSync: vi.fn(() => ({ status: 1 })),
  }
})

vi.mock("fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("fs")>()
  return {
    ...original,
    statSync: vi.fn(original.statSync),
  }
})

describe("parseFactorioVersion", () => {
  it.each([
    ["Version: 2.1.20 (build 87512, linux64, headless, space-age)\nBinary version: 64", "2.1.20"],
    ["some wrapper noise\nVersion: 2.0.77 (build 1, linux64, full)", "2.0.77"],
    ["no version here", undefined],
  ])("%j => %s", (output, expected) => {
    expect(parseFactorioVersion(output)).toBe(expected)
  })
})

describe("buildLaunchSteps", () => {
  const dataDir = path.resolve("/data")
  const common = ["--mod-directory", path.join(dataDir, "mods"), "-c", path.join(dataDir, "config.ini"), "--x"]
  const options = { dataDir, bundledSave: "/bundled.zip", factorioArgs: ["--x"], testArgs: ["--udp"] }
  const headless = (save: string) => ["--benchmark", save, "--benchmark-ticks", "1000000000", ...common, "--udp"]
  const graphics = (save: string) => ["--load-game", save, ...common, "--udp"]
  const scenarioSave = path.join(dataDir, "saves", "my-mod", "s1.zip")
  const scenario2map = {
    ref: "my-mod/s1",
    args: ["--scenario2map", "my-mod/s1", ...common],
    savePath: scenarioSave,
  }
  const modTarget = { kind: "mod", modName: "my-mod" } as const
  const scenarioTarget = { kind: "scenario", ref: "my-mod/s1" } as const

  it.each<[string, RunPlan, RunMode, LaunchSteps]>([
    [
      "mod, bundled, headless",
      { target: modTarget, world: { kind: "bundled" } },
      "headless",
      { test: { args: headless("/bundled.zip") } },
    ],
    [
      "mod, bundled, graphics",
      { target: modTarget, world: { kind: "bundled" } },
      "graphics",
      { test: { args: graphics("/bundled.zip") } },
    ],
    [
      "mod, save, headless",
      { target: modTarget, world: { kind: "save", path: "/my-save.zip" } },
      "headless",
      { test: { args: headless(path.resolve("/my-save.zip")) } },
    ],
    [
      "mod, start scenario, graphics",
      { target: modTarget, world: { kind: "scenario", ref: "my-mod/s1" } },
      "graphics",
      { scenario2map, test: { args: graphics(scenarioSave) } },
    ],
    [
      "scenario, headless",
      { target: scenarioTarget, world: { kind: "scenario", ref: "my-mod/s1" } },
      "headless",
      { scenario2map, test: { args: headless(scenarioSave) } },
    ],
    [
      "scenario, graphics",
      { target: scenarioTarget, world: { kind: "scenario", ref: "my-mod/s1" } },
      "graphics",
      { scenario2map, test: { args: graphics(scenarioSave) } },
    ],
  ])("%s", (_, plan, mode, expected) => {
    expect(buildLaunchSteps(plan, mode, options)).toEqual(expected)
  })
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
    const { statSync } = await import("fs")
    vi.mocked(statSync).mockReturnValue(undefined)

    const { autoDetectFactorioPath } = await import("./factorio-process.js")
    expect(() => autoDetectFactorioPath()).toThrow(/Could not auto-detect/)
  })
})

describe("BufferLineSplitter", () => {
  async function splitLines(chunks: string[]): Promise<string[]> {
    const { BufferLineSplitter } = await import("./factorio-process.js")
    const stream = new PassThrough()
    const lines: string[] = []
    new BufferLineSplitter(stream).on("line", (line) => lines.push(line))
    for (const chunk of chunks) stream.write(chunk)
    stream.end()
    await finished(stream)
    stream.destroy()
    await new Promise((resolve) => setImmediate(resolve))
    return lines
  }

  it.each([
    [["a\nb\n"], ["a", "b"]],
    [
      ["a", "b\nc", "\n"],
      ["ab", "c"],
    ],
    [["a\r\nb\r\n"], ["a", "b"]],
    [
      ["a\r", "\nb\n"],
      ["a", "b"],
    ],
    [["a\ntrailing"], ["a", "trailing"]],
  ])("splits %j into %j", async (chunks, expected) => {
    expect(await splitLines(chunks)).toEqual(expected)
  })
})

class FakeProcess extends EventEmitter {
  stdout = new PassThrough()
  stderr = new PassThrough()
  kill = vi.fn(() => this.exit(null, "SIGTERM"))

  writeLine(line: string, stream: "stdout" | "stderr" = "stdout"): void {
    this[stream].write(line + "\n")
  }

  exit(code: number | null, signal: NodeJS.Signals | null = null): void {
    this.emit("exit", code, signal)
  }
}

const testRunStartedLine = 'FACTORIO-TEST-EVENT:{"type":"testRunStarted","total":1}'
const resultLine = "FACTORIO-TEST-RESULT:passed"
const dataDir = "/data-dir"
const logHint = path.join(dataDir, "factorio-current.log")

async function flushStreams(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve))
}

describe("superviseHeadlessRun", () => {
  let proc: FakeProcess
  let handler: FactorioOutputHandler

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
    proc = new FakeProcess()
    handler = new FactorioOutputHandler()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  async function startedRun(options: Partial<HeadlessSuperviseOptions> = {}) {
    const { superviseHeadlessRun } = await import("./factorio-process.js")
    const run = superviseHeadlessRun(proc, handler, { dataDir, ...options })
    run.catch(() => {})
    proc.writeLine(testRunStartedLine)
    await flushStreams()
    return { run }
  }

  it("finishes when a result is received before exit", async () => {
    const { run } = await startedRun()
    proc.writeLine(resultLine)
    await flushStreams()
    proc.exit(0)
    expect(await run).toBe("finished")
    expect(handler.getResultMessage()).toBe("passed")
  })

  it("reads protocol lines from stderr too", async () => {
    const { run } = await startedRun()
    proc.writeLine(resultLine, "stderr")
    await flushStreams()
    proc.exit(0)
    expect(await run).toBe("finished")
  })

  it("kills the process when no output arrives within outputTimeout", async () => {
    const { run } = await startedRun({ outputTimeout: 3 })
    await vi.advanceTimersByTimeAsync(3000)
    expect(proc.kill).toHaveBeenCalled()
    await expect(run).rejects.toThrow("no output received for 3 seconds")
    await expect(run).rejects.toThrow(logHint)
  })

  it("resets the output watchdog on each line", async () => {
    const { run } = await startedRun({ outputTimeout: 3 })
    for (let i = 0; i < 3; i++) {
      await vi.advanceTimersByTimeAsync(2000)
      proc.writeLine("log line")
      await flushStreams()
    }
    expect(proc.kill).not.toHaveBeenCalled()
    proc.writeLine(resultLine)
    await flushStreams()
    proc.exit(0)
    expect(await run).toBe("finished")
  })

  it("kills the process when the test run does not start in time", async () => {
    const { superviseHeadlessRun } = await import("./factorio-process.js")
    const run = superviseHeadlessRun(proc, handler, { dataDir, startupTimeoutMs: 5000 })
    run.catch(() => {})
    await vi.advanceTimersByTimeAsync(5000)
    expect(proc.kill).toHaveBeenCalled()
    await expect(run).rejects.toThrow("no test run started within 5 seconds")
  })

  it("does not apply the startup timeout once the test run started", async () => {
    const { run } = await startedRun({ startupTimeoutMs: 5000 })
    await vi.advanceTimersByTimeAsync(10_000)
    expect(proc.kill).not.toHaveBeenCalled()
    proc.writeLine(resultLine)
    await flushStreams()
    proc.exit(0)
    expect(await run).toBe("finished")
  })

  it("is cancelled when the signal aborts", async () => {
    const controller = new AbortController()
    const { run } = await startedRun({ signal: controller.signal })
    controller.abort()
    expect(proc.kill).toHaveBeenCalled()
    expect(await run).toBe("cancelled")
  })

  it("rejects when the process exits without a result", async () => {
    const { run } = await startedRun()
    proc.exit(1)
    await expect(run).rejects.toThrow(`Factorio exited with code 1, signal null, no result received`)
    await expect(run).rejects.toThrow(logHint)
  })
})

describe("superviseGraphicsRun", () => {
  let proc: FakeProcess
  let handler: FactorioOutputHandler

  beforeEach(() => {
    proc = new FakeProcess()
    handler = new FactorioOutputHandler()
  })

  async function supervise(resolveOnResult?: boolean) {
    const { superviseGraphicsRun } = await import("./factorio-process.js")
    let settled = false
    const run = superviseGraphicsRun(proc, handler, { dataDir, resolveOnResult })
    void run.then(
      () => (settled = true),
      () => (settled = true),
    )
    return { run, isSettled: () => settled }
  }

  it.each([
    [true, true],
    [false, false],
  ])("with resolveOnResult=%s, settles on result without exit: %s", async (resolveOnResult, settlesEarly) => {
    const { run, isSettled } = await supervise(resolveOnResult)
    proc.writeLine(resultLine)
    await flushStreams()
    expect(isSettled()).toBe(settlesEarly)
    proc.exit(0)
    await expect(run).resolves.toBeUndefined()
  })

  it("rejects when the process exits without a result", async () => {
    const { run } = await supervise()
    proc.exit(0)
    await expect(run).rejects.toThrow(logHint)
  })
})

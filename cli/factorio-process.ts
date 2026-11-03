import { execFile, spawn, spawnSync } from "child_process"
import { EventEmitter, once } from "events"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { Readable } from "stream"
import { fileURLToPath } from "url"
import { promisify } from "util"
import { CliError } from "./cli-error.js"
import { BAILED_PREFIX, FactorioOutputHandler, FOCUSED_SUFFIX } from "./factorio-output-parser.js"
import type { RunMode } from "./factorio-setup.js"
import { compareVersions } from "./mods/dependency.js"
import type { RunPlan, World } from "./run-plan.js"
import { OutputPrinter, ProgressRenderer } from "./test-output.js"
import { TestRunCollector, TestRunData } from "./test-results.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export class BufferLineSplitter extends EventEmitter<{ line: [string] }> {
  private buf = ""

  constructor(stream: Readable) {
    super()
    stream.on("close", () => this.flush())
    stream.on("end", () => this.flush())
    stream.on("data", (chunk: Buffer) => {
      this.buf += chunk.toString()
      let lineBreak: RegExpExecArray | null
      while ((lineBreak = /\r?\n/.exec(this.buf))) {
        this.emit("line", this.buf.slice(0, lineBreak.index))
        this.buf = this.buf.slice(lineBreak.index + lineBreak[0].length)
      }
    })
  }

  private flush(): void {
    if (this.buf.length === 0) return
    const rest = this.buf
    this.buf = ""
    this.emit("line", rest)
  }
}

/** Real path (symlinks followed) of an executable path or a command on PATH; undefined if not found. */
export async function findExecutableRealPath(executable: string): Promise<string | undefined> {
  const candidates = executable.includes(path.sep)
    ? [executable]
    : (process.env.PATH ?? "").split(path.delimiter).map((dir) => path.join(dir, executable))
  for (const candidate of candidates) {
    const realPath = await fs.promises.realpath(candidate).catch(() => undefined)
    if (realPath) return realPath
  }
  return undefined
}

function factorioIsInPath(): boolean {
  const result = spawnSync("factorio", ["--version"], { stdio: "ignore" })
  return result.status === 0
}

export function autoDetectFactorioPath(): string {
  if (factorioIsInPath()) {
    return "factorio"
  }

  let pathsToTry: string[]
  if (os.platform() === "linux" || os.platform() === "darwin") {
    pathsToTry = [
      "~/.local/share/Steam/steamapps/common/Factorio/bin/x64/factorio",
      "~/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio",
      "~/.factorio/bin/x64/factorio",
      "/Applications/factorio.app/Contents/MacOS/factorio",
      "/usr/share/factorio/bin/x64/factorio",
      "/usr/share/games/factorio/bin/x64/factorio",
    ]
  } else if (os.platform() === "win32") {
    pathsToTry = [
      "factorio.exe",
      process.env["ProgramFiles(x86)"] + "\\Steam\\steamapps\\common\\Factorio\\bin\\x64\\factorio.exe",
      process.env["ProgramFiles"] + "\\Factorio\\bin\\x64\\factorio.exe",
    ]
  } else {
    throw new CliError(`Cannot auto-detect factorio path on platform ${os.platform()}`)
  }

  pathsToTry = pathsToTry.map((p) => p.replace(/^~\//, os.homedir() + "/"))

  for (const testPath of pathsToTry) {
    if (fs.statSync(testPath, { throwIfNoEntry: false })?.isFile()) {
      return path.resolve(testPath)
    }
  }

  throw new CliError(
    `Could not auto-detect factorio executable. Tried: ${pathsToTry.join(", ")}. ` +
      "Either add the factorio bin to your path, or specify the path with --factorio-path",
  )
}

const VERSION_PATTERN = /Version: (\d+\.\d+\.\d+)/

export function parseFactorioVersion(output: string): string | undefined {
  return VERSION_PATTERN.exec(output)?.[1]
}

export async function getFactorioVersion(factorioPath: string): Promise<string> {
  const { stdout } = await promisify(execFile)(factorioPath, ["--version"]).catch((e: unknown) => {
    throw new CliError(`Could not run "${factorioPath} --version".`, { cause: e })
  })
  const version = parseFactorioVersion(stdout)
  if (!version) throw new CliError(`Could not read the Factorio version from "${factorioPath} --version".`)
  return version
}

export interface LaunchOptions {
  dataDir: string
  /** The bundled save for this Factorio version. */
  bundledSave: string
  /** `--factorio-args`, passed to every launch. */
  factorioArgs: readonly string[]
  /** Only for the test launch. */
  testArgs?: readonly string[]
}

export interface Scenario2MapStep {
  ref: string
  args: string[]
  savePath: string
}

export interface LaunchSteps {
  /** Creates the save for a scenario world in graphics mode, before every test launch. */
  scenario2map?: Scenario2MapStep
  test: { args: string[] }
}

function worldSavePath(world: World, { dataDir, bundledSave }: LaunchOptions): string {
  switch (world.kind) {
    case "bundled":
      return bundledSave
    case "save":
      return path.resolve(world.path)
    case "scenario":
      return scenarioSavePath(dataDir, world.ref)
  }
}

/** Where `--scenario2map [MOD/]NAME` writes its save. */
export function scenarioSavePath(dataDir: string, ref: string): string {
  return path.join(dataDir, "saves", `${ref}.zip`)
}

export function buildLaunchSteps({ world }: RunPlan, mode: RunMode, options: LaunchOptions): LaunchSteps {
  const { dataDir, factorioArgs, testArgs = [] } = options
  const common = [
    "--mod-directory",
    path.join(dataDir, "mods"),
    "-c",
    path.join(dataDir, "config.ini"),
    ...factorioArgs,
  ]
  if (mode === "headless") {
    const load =
      world.kind === "scenario" ? ["--test-scenario", world.ref] : ["--test-save", worldSavePath(world, options)]
    return { test: { args: [...load, ...common, ...testArgs] } }
  }
  const savePath = worldSavePath(world, options)
  const test = { args: ["--load-game", savePath, ...common, ...testArgs] }
  if (world.kind !== "scenario") return { test }
  return { scenario2map: { ref: world.ref, args: ["--scenario2map", world.ref, ...common], savePath }, test }
}

/** Creates a scenario world's save; a failure fails the run, with Factorio's output (LAUNCH-2). */
export async function runScenario2Map(factorioPath: string, step: Scenario2MapStep, verbose?: boolean): Promise<void> {
  await fs.promises.rm(step.savePath, { force: true })
  console.log(`Creating a game from scenario "${step.ref}"...`)
  if (verbose) console.log("Running:", factorioPath, ...step.args)
  const proc = spawn(factorioPath, step.args, { stdio: ["inherit", "pipe", "pipe"] })
  const lines: string[] = []
  forEachLine(proc, (line) => {
    lines.push(line)
    if (verbose) console.log(line)
  })
  const [code] = (await once(proc, "exit")) as [number | null, NodeJS.Signals | null]
  if (code === 0) return
  throw new CliError(`Creating a game from scenario "${step.ref}" failed (exit code ${code}):\n${lines.join("\n")}`)
}

export interface FactorioTestOptions {
  verbose?: boolean
  quiet?: boolean
  signal?: AbortSignal
  outputTimeout?: number
}

export interface FactorioTestResult {
  status: "passed" | "failed" | "todo" | "loadError" | "could not auto start" | "cancelled" | string
  hasFocusedTests: boolean
  message?: string
  data?: TestRunData
}

export function getHeadlessSavePath(): string {
  return path.join(__dirname, "headless-save.zip")
}

export const MIN_FACTORIO_VERSION = "2.1.24"

/** The CLI relies on `--test-save`/`--test-scenario`, added in Factorio 2.1.24. */
export function checkFactorioVersionSupported(version: string): void {
  if (compareVersions(version, MIN_FACTORIO_VERSION) >= 0) return
  throw new CliError(
    `factorio-test requires Factorio ${MIN_FACTORIO_VERSION} or newer (found ${version}).\n` +
      "Downgrade factorio-test-cli to v3.8.0 to use earlier factorio versions.",
  )
}

export function parseResultMessage(message: string): Pick<FactorioTestResult, "status" | "hasFocusedTests"> {
  let remaining = message
  let status: string

  const hasFocused = remaining.endsWith(FOCUSED_SUFFIX)
  if (hasFocused) remaining = remaining.slice(0, -FOCUSED_SUFFIX.length)

  if (remaining.startsWith(BAILED_PREFIX)) {
    status = "bailed"
  } else {
    status = remaining
  }

  return {
    status: status as FactorioTestResult["status"],
    hasFocusedTests: hasFocused,
  }
}

export interface OutputComponents {
  handler: FactorioOutputHandler
  collector: TestRunCollector
}

function factorioLogHint(dataDir: string): string {
  return `\nCheck Factorio log for details: ${path.join(dataDir, "factorio-current.log")}`
}

export function createOutputComponents(options: FactorioTestOptions): OutputComponents {
  const handler = new FactorioOutputHandler()
  const collector = new TestRunCollector()
  const isTTY = process.stdout.isTTY ?? false
  const printer = new OutputPrinter({
    verbose: options.verbose,
    quiet: options.quiet,
  })
  const progress = new ProgressRenderer(isTTY)

  handler.on("event", (event) => {
    collector.handleEvent(event)
    progress.handleEvent(event)
    if (options.verbose) {
      progress.withPermanentOutput(() => printer.printEvent(event))
    }
  })
  handler.on("log", (line) => {
    collector.captureLog(line)
    progress.withPermanentOutput(() => printer.printVerbose(line))
  })
  handler.on("message", (line) => {
    progress.withPermanentOutput(() => printer.printMessage(line))
  })

  collector.on("testFinished", (test) => {
    progress.handleTestFinished(test)
    progress.withPermanentOutput(() => printer.printTestResult(test))
  })
  collector.on("describeBlockFailed", (block) => {
    progress.withPermanentOutput(() => printer.printTestResult(block))
  })

  handler.on("result", () => {
    progress.finish()
    printer.resetMessage()
  })

  return { handler, collector }
}

export interface SupervisedProcess {
  stdout: Readable
  stderr?: Readable | null
  kill(signal?: NodeJS.Signals): void
  once(event: "exit", listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown
}

export interface HeadlessSuperviseOptions {
  dataDir: string
  outputTimeout?: number
  startupTimeoutMs?: number
  signal?: AbortSignal
}

const DEFAULT_STARTUP_TIMEOUT_MS = 10_000
/** In test mode, Factorio ignores SIGTERM while a tick is stuck in Lua. */
const FORCE_KILL_DELAY_MS = 3_000

const LOG_LINE = /^\s*\d+\.\d{3} /
const ERROR_LOG_LINE = /^\s*\d+\.\d{3} Error /

/** Keeps Factorio's last `Error` log entry, with its continuation lines. */
export class LastErrorCollector {
  private lines: string[] = []
  private capturing = false

  add(line: string): void {
    if (ERROR_LOG_LINE.test(line)) {
      this.lines = [line.trim()]
      this.capturing = true
    } else if (LOG_LINE.test(line) || line.startsWith("FACTORIO-TEST-")) {
      this.capturing = false
    } else if (this.capturing) {
      this.lines.push(line)
    }
  }

  get(): string | undefined {
    return this.lines.length > 0 ? this.lines.join("\n").trimEnd() : undefined
  }
}

function forEachLine(proc: SupervisedProcess, onLine: (line: string) => void): void {
  new BufferLineSplitter(proc.stdout).on("line", onLine)
  if (proc.stderr) new BufferLineSplitter(proc.stderr).on("line", onLine)
}

export function superviseHeadlessRun(
  proc: SupervisedProcess,
  handler: FactorioOutputHandler,
  options: HeadlessSuperviseOptions,
): Promise<"finished" | "cancelled"> {
  const { dataDir, outputTimeout, signal, startupTimeoutMs = DEFAULT_STARTUP_TIMEOUT_MS } = options

  let testRunStarted = false
  let startupTimedOut = false
  let wasCancelled = false
  let outputTimedOut = false

  let forceKill: ReturnType<typeof setTimeout> | undefined
  function terminate(): void {
    proc.kill()
    forceKill ??= setTimeout(() => proc.kill("SIGKILL"), FORCE_KILL_DELAY_MS)
  }

  const startupTimeout = setTimeout(() => {
    if (testRunStarted) return
    startupTimedOut = true
    terminate()
  }, startupTimeoutMs)

  handler.on("event", (event) => {
    if (event.type !== "testRunStarted") return
    testRunStarted = true
    clearTimeout(startupTimeout)
  })

  let outputWatchdog: ReturnType<typeof setTimeout> | undefined
  function resetOutputWatchdog(): void {
    if (!outputTimeout) return
    clearTimeout(outputWatchdog)
    outputWatchdog = setTimeout(() => {
      outputTimedOut = true
      terminate()
    }, outputTimeout * 1000)
  }
  resetOutputWatchdog()

  const abortHandler = () => {
    wasCancelled = true
    terminate()
  }
  signal?.addEventListener("abort", abortHandler)

  const lastError = new LastErrorCollector()
  forEachLine(proc, (line) => {
    resetOutputWatchdog()
    lastError.add(line)
    handler.handleLine(line)
  })

  return new Promise((resolve, reject) => {
    proc.once("exit", (code, exitSignal) => {
      clearTimeout(startupTimeout)
      clearTimeout(outputWatchdog)
      clearTimeout(forceKill)
      signal?.removeEventListener("abort", abortHandler)
      if (wasCancelled) {
        resolve("cancelled")
      } else if (outputTimedOut) {
        reject(
          new CliError(
            `Factorio process stuck: no output received for ${outputTimeout} seconds${factorioLogHint(dataDir)}`,
          ),
        )
      } else if (startupTimedOut) {
        reject(
          new CliError(
            `Factorio unresponsive: no test run started within ${startupTimeoutMs / 1000} seconds${factorioLogHint(dataDir)}`,
          ),
        )
      } else if (handler.getResultMessage() !== undefined) {
        resolve("finished")
      } else {
        reject(
          new CliError(
            `Factorio exited with code ${code}, signal ${exitSignal}, no result received` +
              (lastError.get() ? `:\n${lastError.get()}` : "") +
              factorioLogHint(dataDir),
          ),
        )
      }
    })
  })
}

export interface GraphicsSuperviseOptions {
  dataDir: string
  resolveOnResult?: boolean
}

export function superviseGraphicsRun(
  proc: SupervisedProcess,
  handler: FactorioOutputHandler,
  options: GraphicsSuperviseOptions,
): Promise<void> {
  forEachLine(proc, (line) => handler.handleLine(line))

  return new Promise((resolve, reject) => {
    if (options.resolveOnResult) handler.on("result", () => resolve())
    proc.once("exit", (code, signal) => {
      if (handler.getResultMessage() !== undefined) {
        resolve()
      } else {
        reject(new CliError(`Factorio exited with code ${code}, signal ${signal}${factorioLogHint(options.dataDir)}`))
      }
    })
  })
}

function completedResult(handler: FactorioOutputHandler, collector: TestRunCollector): FactorioTestResult {
  const resultMessage = handler.getResultMessage()!
  return { ...parseResultMessage(resultMessage), message: resultMessage, data: collector.getData() }
}

export async function runFactorioTestsHeadless(
  factorioPath: string,
  dataDir: string,
  args: string[],
  options: FactorioTestOptions,
): Promise<FactorioTestResult> {
  console.log("Running tests (headless)...")
  const factorioProcess = spawn(factorioPath, args, {
    stdio: ["inherit", "pipe", "pipe"],
  })

  const { handler, collector } = createOutputComponents(options)
  const outcome = await superviseHeadlessRun(factorioProcess, handler, {
    dataDir,
    outputTimeout: options.outputTimeout,
    signal: options.signal,
  })

  if (outcome === "cancelled") {
    return { status: "cancelled", hasFocusedTests: false }
  }
  return completedResult(handler, collector)
}

export interface GraphicsTestOptions extends FactorioTestOptions {
  resolveOnResult?: boolean
}

export async function runFactorioTestsGraphics(
  factorioPath: string,
  dataDir: string,
  args: string[],
  options: GraphicsTestOptions,
): Promise<FactorioTestResult> {
  console.log("Running tests (graphics)...")
  const factorioProcess = spawn(factorioPath, args, {
    stdio: ["inherit", "pipe", "inherit"],
  })

  const { handler, collector } = createOutputComponents(options)
  await superviseGraphicsRun(factorioProcess, handler, { dataDir, resolveOnResult: options.resolveOnResult })
  return completedResult(handler, collector)
}

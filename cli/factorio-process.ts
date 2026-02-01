import { EventEmitter } from "events"
import { spawn, spawnSync } from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { Readable } from "stream"
import { fileURLToPath } from "url"
import { FactorioOutputHandler } from "./factorio-output-parser.js"
import { OutputPrinter, ProgressRenderer } from "./test-output.js"
import { TestRunCollector, TestRunData } from "./test-results.js"
import { CliError } from "./cli-error.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

class BufferLineSplitter extends EventEmitter<{ line: [string] }> {
  private buf = ""

  constructor(stream: Readable) {
    super()
    stream.on("close", () => {
      if (this.buf.length > 0) this.emit("line", this.buf)
    })
    stream.on("end", () => {
      if (this.buf.length > 0) this.emit("line", this.buf)
    })
    stream.on("data", (chunk: Buffer) => {
      this.buf += chunk.toString()
      let index: number
      while ((index = this.buf.search(/\r?\n/)) !== -1) {
        this.emit("line", this.buf.slice(0, index))
        this.buf = this.buf.slice(index + 1)
      }
    })
  }
}

export function getFactorioPlayerDataPath(): string {
  const platform = os.platform()
  if (platform === "win32") {
    return path.join(process.env.APPDATA!, "Factorio", "player-data.json")
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "factorio", "player-data.json")
  }
  return path.join(os.homedir(), ".factorio", "player-data.json")
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

export function getHeadlessSavePath(overridePath?: string): string {
  if (overridePath) {
    return path.resolve(overridePath)
  }
  return path.join(__dirname, "headless-save.zip")
}

export function parseResultMessage(message: string): Pick<FactorioTestResult, "status" | "hasFocusedTests"> {
  let remaining = message
  let status: string

  const hasFocused = remaining.endsWith(":focused")
  if (hasFocused) remaining = remaining.slice(0, -":focused".length)

  if (remaining.startsWith("bailed:")) {
    status = "bailed"
  } else {
    status = remaining
  }

  return {
    status: status as FactorioTestResult["status"],
    hasFocusedTests: hasFocused,
  }
}

interface OutputComponents {
  handler: FactorioOutputHandler
  collector: TestRunCollector
}

function factorioLogHint(dataDir: string): string {
  return `\nCheck Factorio log for details: ${path.join(dataDir, "factorio-current.log")}`
}

function createOutputComponents(options: FactorioTestOptions): OutputComponents {
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
      progress.withPermanentOutput(() => console.log(JSON.stringify(event)))
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

  handler.on("result", () => {
    progress.finish()
    printer.resetMessage()
  })

  return { handler, collector }
}

export async function runFactorioTestsHeadless(
  factorioPath: string,
  dataDir: string,
  savePath: string,
  additionalArgs: string[],
  options: FactorioTestOptions,
): Promise<FactorioTestResult> {
  const args = [
    "--benchmark",
    savePath,
    "--benchmark-ticks",
    "1000000000",
    "--mod-directory",
    path.join(dataDir, "mods"),
    "-c",
    path.join(dataDir, "config.ini"),
    ...additionalArgs,
  ]

  console.log("Running tests (headless)...")
  const factorioProcess = spawn(factorioPath, args, {
    stdio: ["inherit", "pipe", "pipe"],
  })

  const { handler, collector } = createOutputComponents(options)

  let testRunStarted = false
  let startupTimedOut = false
  let wasCancelled = false
  let outputTimedOut = false

  handler.on("event", (event) => {
    if (event.type === "testRunStarted") {
      testRunStarted = true
      clearTimeout(startupTimeout)
    }
  })

  const startupTimeout = setTimeout(() => {
    if (!testRunStarted) {
      startupTimedOut = true
      factorioProcess.kill()
    }
  }, 10_000)

  const outputTimeout = options.outputTimeout
  let outputWatchdog: ReturnType<typeof setTimeout> | undefined

  function resetOutputWatchdog(): void {
    if (!outputTimeout) return
    clearTimeout(outputWatchdog)
    outputWatchdog = setTimeout(() => {
      outputTimedOut = true
      factorioProcess.kill()
    }, outputTimeout * 1000)
  }

  if (outputTimeout) {
    resetOutputWatchdog()
  }

  const abortHandler = () => {
    wasCancelled = true
    factorioProcess.kill()
  }
  options.signal?.addEventListener("abort", abortHandler)

  const stdoutSplitter = new BufferLineSplitter(factorioProcess.stdout)
  const stderrSplitter = new BufferLineSplitter(factorioProcess.stderr)
  stdoutSplitter.on("line", (line) => {
    resetOutputWatchdog()
    handler.handleLine(line)
  })
  stderrSplitter.on("line", (line) => {
    resetOutputWatchdog()
    handler.handleLine(line)
  })

  await new Promise<void>((resolve, reject) => {
    factorioProcess.on("exit", (code, signal) => {
      clearTimeout(startupTimeout)
      clearTimeout(outputWatchdog)
      options.signal?.removeEventListener("abort", abortHandler)
      if (wasCancelled) {
        resolve()
      } else if (outputTimedOut) {
        reject(
          new CliError(
            `Factorio process stuck: no output received for ${outputTimeout} seconds${factorioLogHint(dataDir)}`,
          ),
        )
      } else if (startupTimedOut) {
        reject(new CliError(`Factorio unresponsive: no test run started within 10 seconds${factorioLogHint(dataDir)}`))
      } else if (handler.getResultMessage() !== undefined) {
        resolve()
      } else {
        reject(
          new CliError(
            `Factorio exited with code ${code}, signal ${signal}, no result received${factorioLogHint(dataDir)}`,
          ),
        )
      }
    })
  })

  if (wasCancelled) {
    return { status: "cancelled", hasFocusedTests: false }
  }

  const resultMessage = handler.getResultMessage()!
  const parsed = parseResultMessage(resultMessage)
  return { ...parsed, message: resultMessage, data: collector.getData() }
}

export interface GraphicsTestOptions extends FactorioTestOptions {
  resolveOnResult?: boolean
}

export async function runFactorioTestsGraphics(
  factorioPath: string,
  dataDir: string,
  savePath: string,
  additionalArgs: string[],
  options: GraphicsTestOptions,
): Promise<FactorioTestResult> {
  const args = [
    "--load-game",
    savePath,
    "--mod-directory",
    path.join(dataDir, "mods"),
    "-c",
    path.join(dataDir, "config.ini"),
    ...additionalArgs,
  ]

  console.log("Running tests (graphics)...")
  const factorioProcess = spawn(factorioPath, args, {
    stdio: ["inherit", "pipe", "inherit"],
  })

  const { handler, collector } = createOutputComponents(options)

  let resolvePromise: (() => void) | undefined

  if (options.resolveOnResult) {
    handler.on("result", () => resolvePromise?.())
  }

  new BufferLineSplitter(factorioProcess.stdout).on("line", (line) => handler.handleLine(line))

  await new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    factorioProcess.on("exit", (code, signal) => {
      if (handler.getResultMessage() !== undefined) {
        resolve()
      } else {
        reject(new CliError(`Factorio exited with code ${code}, signal ${signal}${factorioLogHint(dataDir)}`))
      }
    })
  })

  const resultMessage = handler.getResultMessage()!
  const parsed = parseResultMessage(resultMessage)
  return { ...parsed, message: resultMessage, data: collector.getData() }
}

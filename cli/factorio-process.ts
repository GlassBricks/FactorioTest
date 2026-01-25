import { spawn } from "child_process"
import * as path from "path"
import { fileURLToPath } from "url"
import BufferLineSplitter from "./buffer-line-splitter.js"
import { FactorioOutputHandler } from "./factorio-output-parser.js"
import { OutputPrinter } from "./output-formatter.js"
import { ProgressRenderer } from "./progress-renderer.js"
import { TestRunCollector, TestRunData } from "./test-run-collector.js"
import { CliError } from "./cli-error.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface FactorioTestOptions {
  verbose?: boolean
  quiet?: boolean
  signal?: AbortSignal
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
  if (message.endsWith(":focused")) {
    return {
      status: message.slice(0, -":focused".length) as FactorioTestResult["status"],
      hasFocusedTests: true,
    }
  }
  return {
    status: message as FactorioTestResult["status"],
    hasFocusedTests: false,
  }
}

interface OutputComponents {
  handler: FactorioOutputHandler
  collector: TestRunCollector
  printer: OutputPrinter
  progress: ProgressRenderer
}

function createOutputComponents(options: FactorioTestOptions): OutputComponents {
  const handler = new FactorioOutputHandler()
  const collector = new TestRunCollector()
  const printer = new OutputPrinter({
    verbose: options.verbose,
    quiet: options.quiet,
  })
  const progress = new ProgressRenderer()

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

  return { handler, collector, printer, progress }
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

  const { handler, collector, printer, progress } = createOutputComponents(options)

  let resultMessage: string | undefined
  let testRunStarted = false
  let startupTimedOut = false
  let wasCancelled = false

  handler.on("result", (msg) => {
    resultMessage = msg
    progress.finish()
    printer.resetMessage()
  })
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

  const abortHandler = () => {
    wasCancelled = true
    factorioProcess.kill()
  }
  options.signal?.addEventListener("abort", abortHandler)

  new BufferLineSplitter(factorioProcess.stdout).on("line", (line) => handler.handleLine(line))
  new BufferLineSplitter(factorioProcess.stderr).on("line", (line) => handler.handleLine(line))

  await new Promise<void>((resolve, reject) => {
    factorioProcess.on("exit", (code, signal) => {
      clearTimeout(startupTimeout)
      options.signal?.removeEventListener("abort", abortHandler)
      if (wasCancelled) {
        resolve()
      } else if (startupTimedOut) {
        reject(new CliError("Factorio unresponsive: no test run started within 10 seconds"))
      } else if (resultMessage !== undefined) {
        resolve()
      } else {
        reject(new CliError(`Factorio exited with code ${code}, signal ${signal}, no result received`))
      }
    })
  })

  if (wasCancelled) {
    return { status: "cancelled", hasFocusedTests: false }
  }

  const parsed = parseResultMessage(resultMessage!)
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

  const { handler, collector, printer, progress } = createOutputComponents(options)

  let resultMessage: string | undefined
  let resolvePromise: (() => void) | undefined

  handler.on("result", (msg) => {
    resultMessage = msg
    progress.finish()
    printer.resetMessage()
    if (options.resolveOnResult && resolvePromise) {
      resolvePromise()
    }
  })

  new BufferLineSplitter(factorioProcess.stdout).on("line", (line) => handler.handleLine(line))

  await new Promise<void>((resolve, reject) => {
    resolvePromise = resolve
    factorioProcess.on("exit", (code, signal) => {
      if (resultMessage !== undefined) {
        resolve()
      } else {
        reject(new CliError(`Factorio exited with code ${code}, signal ${signal}`))
      }
    })
  })

  const parsed = parseResultMessage(resultMessage!)
  return { ...parsed, message: resultMessage, data: collector.getData() }
}

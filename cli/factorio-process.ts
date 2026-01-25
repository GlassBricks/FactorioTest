import { spawn } from "child_process"
import * as path from "path"
import { fileURLToPath } from "url"
import BufferLineSplitter from "./buffer-line-splitter.js"
import { FactorioOutputHandler } from "./factorio-output-handler.js"
import { TestRunCollector, TestRunData } from "./test-run-collector.js"
import { OutputPrinter } from "./output-formatter.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface FactorioTestOptions {
  verbose?: boolean
  showOutput?: boolean
}

export interface FactorioTestResult {
  status: "passed" | "failed" | "todo" | "loadError" | "could not auto start" | string
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
}

function createOutputComponents(options: FactorioTestOptions): OutputComponents {
  const handler = new FactorioOutputHandler()
  const collector = new TestRunCollector()
  const printer = new OutputPrinter({
    verbose: options.verbose,
    quiet: !options.showOutput,
    showOutput: options.showOutput,
  })

  handler.on("event", (event) => {
    collector.handleEvent(event)
    if (options.verbose) console.log(JSON.stringify(event))
  })
  handler.on("log", (line) => {
    collector.captureLog(line)
    printer.printVerbose(line)
  })
  handler.on("message", (line) => printer.printMessage(line))

  collector.on("testFinished", (test) => printer.printTestResult(test))

  return { handler, collector, printer }
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

  const { handler, collector, printer } = createOutputComponents(options)

  let resultMessage: string | undefined
  handler.on("result", (msg) => {
    resultMessage = msg
    printer.resetMessage()
  })

  new BufferLineSplitter(factorioProcess.stdout).on("line", (line) => handler.handleLine(line))
  new BufferLineSplitter(factorioProcess.stderr).on("line", (line) => handler.handleLine(line))

  await new Promise<void>((resolve, reject) => {
    factorioProcess.on("exit", (code, signal) => {
      if (resultMessage !== undefined) {
        resolve()
      } else {
        reject(new Error(`Factorio exited with code ${code}, signal ${signal}, no result received`))
      }
    })
  })

  const parsed = parseResultMessage(resultMessage!)
  return { ...parsed, message: resultMessage, data: collector.getData() }
}

export async function runFactorioTestsGraphics(
  factorioPath: string,
  dataDir: string,
  savePath: string,
  additionalArgs: string[],
  options: FactorioTestOptions,
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

  const { handler, collector, printer } = createOutputComponents(options)

  let resultMessage: string | undefined
  handler.on("result", (msg) => {
    resultMessage = msg
    printer.resetMessage()
  })

  new BufferLineSplitter(factorioProcess.stdout).on("line", (line) => handler.handleLine(line))

  await new Promise<void>((resolve, reject) => {
    factorioProcess.on("exit", (code, signal) => {
      if (resultMessage !== undefined) {
        resolve()
      } else {
        reject(new Error(`Factorio exited with code ${code}, signal ${signal}`))
      }
    })
  })

  const parsed = parseResultMessage(resultMessage!)
  return { ...parsed, message: resultMessage, data: collector.getData() }
}

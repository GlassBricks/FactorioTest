import { spawn } from "child_process"
import * as path from "path"
import { fileURLToPath } from "url"
import BufferLineSplitter from "./buffer-line-splitter.js"
import { parseEvent } from "./event-parser.js"
import { TestRunCollector } from "./test-run-collector.js"
import { OutputFormatter } from "./output-formatter.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export interface FactorioTestOptions {
  verbose?: boolean
  showOutput?: boolean
}

export interface FactorioTestResult {
  status: "passed" | "failed" | "todo" | "loadError" | "could not auto start" | string
  hasFocusedTests: boolean
  message?: string
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

function createLineHandler(options: FactorioTestOptions, onResult: (msg: string) => void): (line: string) => void {
  const collector = new TestRunCollector()
  const formatter = new OutputFormatter({
    verbose: options.verbose,
    quiet: !options.showOutput,
    showPassedLogs: options.verbose,
  })
  let inMessage = false
  let isMessageFirstLine = true

  return (line: string) => {
    if (line.startsWith("FACTORIO-TEST-RESULT:")) {
      onResult(line.slice("FACTORIO-TEST-RESULT:".length))
      return
    }

    if (line === "FACTORIO-TEST-MESSAGE-START") {
      inMessage = true
      isMessageFirstLine = true
      return
    }
    if (line === "FACTORIO-TEST-MESSAGE-END") {
      inMessage = false
      return
    }

    const event = parseEvent(line)
    if (event) {
      collector.handleEvent(event)

      if (
        event.type === "testPassed" ||
        event.type === "testFailed" ||
        event.type === "testSkipped" ||
        event.type === "testTodo"
      ) {
        const tests = collector.getData().tests
        const lastTest = tests[tests.length - 1]
        if (lastTest) {
          formatter.formatTestResult(lastTest)
        }
      }

      if (options.verbose) {
        console.log(line)
      }
      return
    }

    if (options.verbose) {
      console.log(line)
    } else if (inMessage && options.showOutput) {
      if (isMessageFirstLine) {
        console.log(line.slice(line.indexOf(": ") + 2))
        isMessageFirstLine = false
      } else {
        console.log("    " + line)
      }
    } else {
      collector.captureLog(line)
    }
  }
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

  let resultMessage: string | undefined
  const handleLine = createLineHandler(options, (msg) => {
    resultMessage = msg
  })

  new BufferLineSplitter(factorioProcess.stdout).on("line", handleLine)
  new BufferLineSplitter(factorioProcess.stderr).on("line", handleLine)

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
  return { ...parsed, message: resultMessage }
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

  let resultMessage: string | undefined
  const handleLine = createLineHandler(options, (msg) => {
    resultMessage = msg
  })

  new BufferLineSplitter(factorioProcess.stdout).on("line", handleLine)

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
  return { ...parsed, message: resultMessage }
}

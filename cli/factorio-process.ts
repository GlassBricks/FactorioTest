import { spawn } from "child_process"
import * as path from "path"
import { fileURLToPath } from "url"
import BufferLineSplitter from "./buffer-line-splitter.js"

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
  let isMessage = false
  let isMessageFirstLine = true

  return (line: string) => {
    if (line.startsWith("FACTORIO-TEST-RESULT:")) {
      onResult(line.slice("FACTORIO-TEST-RESULT:".length))
    } else if (line === "FACTORIO-TEST-MESSAGE-START") {
      isMessage = true
      isMessageFirstLine = true
    } else if (line === "FACTORIO-TEST-MESSAGE-END") {
      isMessage = false
    } else if (options.verbose) {
      console.log(line)
    } else if (isMessage && options.showOutput) {
      if (isMessageFirstLine) {
        console.log(line.slice(line.indexOf(": ") + 2))
        isMessageFirstLine = false
      } else {
        console.log("    " + line)
      }
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

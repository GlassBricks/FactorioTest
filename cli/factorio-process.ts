import { spawn } from "child_process"
import * as path from "path"
import BufferLineSplitter from "./buffer-line-splitter.js"

export interface FactorioTestOptions {
  verbose?: boolean
  showOutput?: boolean
}

export async function runFactorioTests(
  factorioPath: string,
  dataDir: string,
  additionalArgs: string[],
  options: FactorioTestOptions,
): Promise<string | undefined> {
  const args = [
    "--load-scenario",
    "factorio-test/Test",
    "--disable-migration-window",
    "--mod-directory",
    path.join(dataDir, "mods"),
    "-c",
    path.join(dataDir, "config.ini"),
    "--graphics-quality",
    "low",
    ...additionalArgs,
  ]

  console.log("Running tests...")
  const factorioProcess = spawn(factorioPath, args, {
    stdio: ["inherit", "pipe", "inherit"],
  })

  let resultMessage: string | undefined
  let isMessage = false
  let isMessageFirstLine = true

  new BufferLineSplitter(factorioProcess.stdout).on("line", (line) => {
    if (line.startsWith("FACTORIO-TEST-RESULT:")) {
      resultMessage = line.slice("FACTORIO-TEST-RESULT:".length)
      factorioProcess.kill()
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
  })

  await new Promise<void>((resolve, reject) => {
    factorioProcess.on("exit", (code, signal) => {
      if (code === 0 && resultMessage !== undefined) {
        resolve()
      } else {
        reject(new Error(`Factorio exited with code ${code}, signal ${signal}`))
      }
    })
  })

  return resultMessage
}

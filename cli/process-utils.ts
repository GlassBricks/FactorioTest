import { spawn } from "child_process"
import { createRequire } from "module"
import * as path from "path"
import { CliError } from "./cli-error.js"

let verbose = false

export function setVerbose(v: boolean): void {
  verbose = v
}

let fmtkCliPath: string | undefined

function resolveFmtkCli(): string {
  const require = createRequire(import.meta.url)
  const packageJsonPath = require.resolve("factoriomod-debug/package.json")
  const { bin } = require(packageJsonPath) as { bin: Record<string, string> }
  return path.resolve(path.dirname(packageJsonPath), bin["fmtk"]!)
}

export function runFmtk(...args: string[]): Promise<void> {
  fmtkCliPath ??= resolveFmtkCli()
  return runProcess(verbose, process.execPath, fmtkCliPath, ...args)
}

export function runProcess(inheritStdio: boolean, command: string, ...args: string[]): Promise<void> {
  if (verbose) console.log("Running:", command, ...args)
  const proc = spawn(command, args, {
    stdio: inheritStdio ? "inherit" : "ignore",
  })
  return new Promise<void>((resolve, reject) => {
    proc.on("error", reject)
    proc.on("exit", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new CliError(`Command exited with code ${code}: ${command} ${args.join(" ")}`))
      }
    })
  })
}

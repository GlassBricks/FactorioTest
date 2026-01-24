import { spawn } from "child_process"

let verbose = false

export function setVerbose(v: boolean): void {
  verbose = v
}

export function runScript(...command: string[]): Promise<void> {
  return runProcess(true, "npx", ...command)
}

export function runProcess(inheritStdio: boolean, command: string, ...args: string[]): Promise<void> {
  if (verbose) console.log("Running:", command, ...args)
  const proc = spawn(command, args, {
    stdio: inheritStdio ? "inherit" : "ignore",
    shell: true,
  })
  return new Promise<void>((resolve, reject) => {
    proc.on("error", reject)
    proc.on("exit", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command exited with code ${code}: ${command} ${args.join(" ")}`))
      }
    })
  })
}

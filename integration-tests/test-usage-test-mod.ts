// Usage test mod result: passed

import * as child_process from "child_process"
import * as path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, "..")

const child = child_process.spawn(
  "npm",
  ["run", "cli", "--workspace=cli", "--", "run", "--mod-path=./usage-test-mod", ...process.argv.slice(3)],
  {
    stdio: ["inherit", "pipe", "inherit"],
    cwd: root,
    shell: true,
  },
)
let stdOut = ""
child.stdout.on("data", (data) => {
  stdOut += data
  process.stdout.write(data)
})

await new Promise<void>((resolve, reject) => {
  child.on("error", reject)
  child.on("exit", (code) => {
    if (code === 1) {
      resolve()
    } else {
      reject(new Error(`Process did not exit with code 1, but ${code}`))
    }
  })
})

const passed = stdOut.includes("Usage test mod result: passed")
console.log("Results are as expected: ", passed)

process.exit(passed ? 0 : 1)

import * as child_process from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { root, symlinkLocalFactorioTest } from "./test-utils.js"

const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "factorio-test-usage-"))
const dataDir = path.join(tempDir, "data")
const modsDir = path.join(dataDir, "mods")

try {
  await symlinkLocalFactorioTest(modsDir)

  const child = child_process.spawn(
    "npm",
    [
      "run",
      "cli",
      "--workspace=cli",
      "--",
      "run",
      "--mod-path=../integration-tests/fixtures/usage-test-mod",
      `--data-directory=${dataDir}`,
      ...process.argv.slice(3),
    ],
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
} finally {
  await fs.promises.rm(tempDir, { recursive: true, force: true })
}

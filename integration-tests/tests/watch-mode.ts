import * as child_process from "child_process"
import * as fs from "fs"
import * as path from "path"
import { root, runTests, sleep, spawnCli, TestContext, TestDefinition, waitForOutput } from "../test-utils.js"

const modFiles = ["info.json", "control.lua", "test1.lua", "lualib_bundle.lua"]

async function copyModToTemp(ctx: TestContext): Promise<string> {
  const modDir = path.join(ctx.tempDir, "test-mod")
  await fs.promises.mkdir(modDir, { recursive: true })
  const srcModDir = path.join(root, "integration-tests/fixtures/usage-test-mod")
  for (const file of modFiles) {
    await fs.promises.copyFile(path.join(srcModDir, file), path.join(modDir, file))
  }
  return modDir
}

function spawnWatchCli(
  modDir: string,
  dataDir: string,
): {
  child: child_process.ChildProcess
  output: { value: string }
} {
  const output = { value: "" }
  const child = spawnCli({
    modPath: modDir,
    dataDir,
    extraArgs: ["--watch", "--test-pattern", "Pass"],
  })

  child.stdout?.on("data", (data) => {
    output.value += data.toString()
  })
  child.stderr?.on("data", (data) => {
    output.value += data.toString()
  })

  return { child, output }
}

async function killChild(child: child_process.ChildProcess): Promise<void> {
  if (child.killed) return
  child.kill("SIGTERM")
  await sleep(100)
  if (!child.killed) child.kill("SIGKILL")
}

export const tests: TestDefinition[] = [
  {
    name: "Watch mode reruns on file change",
    async run(ctx: TestContext): Promise<boolean> {
      const modDir = await copyModToTemp(ctx)
      const { child, output } = spawnWatchCli(modDir, ctx.dataDir)

      try {
        const firstRunCompleted = await waitForOutput(output, "Tests:", 60000)
        if (!firstRunCompleted) {
          ctx.log(`FAIL: First test run did not complete within timeout`)
          ctx.log(`Output: ${output.value.slice(-1000)}`)
          return false
        }
        ctx.log("PASS: First test run completed")

        output.value = ""
        await sleep(500)

        const testFile = path.join(modDir, "test1.lua")
        const now = new Date()
        await fs.promises.utimes(testFile, now, now)

        const rerunDetected = await waitForOutput(output, "File change detected", 5000)
        if (!rerunDetected) {
          ctx.log("FAIL: File change was not detected")
          ctx.log(`Output after touch: ${output.value}`)
          return false
        }
        ctx.log("PASS: File change detected")

        const secondRunCompleted = await waitForOutput(output, "Tests:", 60000)
        if (!secondRunCompleted) {
          ctx.log("FAIL: Second test run did not complete")
          ctx.log(`Output: ${output.value.slice(-1000)}`)
          return false
        }
        ctx.log("PASS: Second test run completed after file change")

        return true
      } finally {
        await killChild(child)
      }
    },
  },
]

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests(tests)
}

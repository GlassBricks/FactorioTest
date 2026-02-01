import * as path from "path"
import { runCliWithTimeout, runTestsDirectly, TestContext, TestDefinition } from "../test-utils.js"

export const tests: TestDefinition[] = [
  {
    name: "--output-timeout kills stuck process",
    async run(ctx: TestContext): Promise<boolean> {
      const { stdout, stderr, code } = await runCliWithTimeout(
        {
          modPath: "../integration-tests/fixtures/infinite-loop-mod",
          dataDir: ctx.dataDir,
          extraArgs: ["--output-timeout", "3"],
        },
        30,
      )

      const output = stdout + stderr
      const expectedLogPath = path.join(ctx.dataDir, "factorio-current.log")

      let passed = true

      if (code === 0) {
        ctx.log(`FAIL: Expected non-zero exit code, got ${code}`)
        passed = false
      } else {
        ctx.log(`PASS: Non-zero exit code (${code})`)
      }

      if (output.includes("no output received for 3 seconds")) {
        ctx.log(`PASS: Found timeout message`)
      } else {
        ctx.log(`FAIL: Expected "no output received for 3 seconds" in output`)
        ctx.log(`Output snippet: ${output.slice(0, 1000)}`)
        passed = false
      }

      if (output.includes(expectedLogPath)) {
        ctx.log(`PASS: Found log path hint`)
      } else {
        ctx.log(`FAIL: Expected log path "${expectedLogPath}" in output`)
        ctx.log(`Output snippet: ${output.slice(-500)}`)
        passed = false
      }

      return passed
    },
  },
]

if (import.meta.url === `file://${process.argv[1]}`) {
  runTestsDirectly(tests)
}

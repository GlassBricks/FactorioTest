import * as fs from "fs"
import * as path from "path"
import { runCli, runTests, TestContext, TestDefinition } from "../test-utils.js"

async function testFailedTestsReorderedFirst(ctx: TestContext): Promise<boolean> {
  ctx.log("First run...")
  await runCli({ dataDir: ctx.dataDir })

  const resultsPath = path.join(ctx.dataDir, "test-results.json")
  if (!fs.existsSync(resultsPath)) {
    ctx.log("FAIL: test-results.json not created")
    return false
  }

  ctx.log("Second run (should reorder)...")
  const { stdout } = await runCli({ dataDir: ctx.dataDir, extraArgs: ["--reorder-failed-first"] })

  const passIndex = stdout.indexOf("PASS test1 > Pass")
  const failIndex = stdout.indexOf("FAIL test1 > each 2")

  if (passIndex === -1 || failIndex === -1) {
    ctx.log("FAIL: Could not find test results in output")
    return false
  }

  if (failIndex < passIndex) {
    ctx.log("PASS: Failed test ran before passing test")
  } else {
    ctx.log("FAIL: Failed test should run first")
    return false
  }

  return true
}

export const tests: TestDefinition[] = [{ name: "Failed tests reordered first", run: testFailedTestsReorderedFirst }]

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests(tests)
}

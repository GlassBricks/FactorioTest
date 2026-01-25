import { runCli, runTestsDirectly, TestContext, TestDefinition } from "../test-utils.js"

async function runTest(ctx: TestContext): Promise<boolean> {
  const { stdout, code } = await runCli({ dataDir: ctx.dataDir })

  if (code !== 1) {
    ctx.log(`FAIL: Expected exit code 1, got ${code}`)
    return false
  }
  ctx.log("PASS: Exit code is 1")

  if (!stdout.includes("Usage test mod result: passed")) {
    ctx.log("FAIL: Expected 'Usage test mod result: passed' in output")
    ctx.log(`Output: ${stdout.slice(0, 500)}`)
    return false
  }
  ctx.log("PASS: Found expected output")

  return true
}

export const tests: TestDefinition[] = [{ name: "Usage test mod runs correctly", run: runTest }]

if (import.meta.url === `file://${process.argv[1]}`) {
  runTestsDirectly(tests)
}

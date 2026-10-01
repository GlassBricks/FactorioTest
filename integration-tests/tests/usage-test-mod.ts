import * as fs from "fs"
import * as path from "path"
import { runCli, runTests, TestContext, TestDefinition } from "../test-utils.js"

interface ResultsFile {
  tests: unknown[]
  summary: { status: string }
}

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

  const expectedSummary = "Tests: 1 failed, 2 errors, 1 todo, 2 skipped, 5 passed (9 total)"
  if (!stdout.includes(expectedSummary)) {
    ctx.log(`FAIL: Expected summary line "${expectedSummary}"; re-record cli transcript if mod output changed`)
    ctx.log(`Output: ${stdout.slice(-500)}`)
    return false
  }
  ctx.log(`PASS: Summary line matches`)

  const resultsPath = path.join(ctx.dataDir, "test-results.json")
  if (!fs.existsSync(resultsPath)) {
    ctx.log("FAIL: test-results.json not created")
    return false
  }
  const results = JSON.parse(await fs.promises.readFile(resultsPath, "utf-8")) as ResultsFile
  if (results.tests.length !== 11 || results.summary.status !== "failed") {
    ctx.log(`FAIL: Unexpected results file: ${results.tests.length} tests, status ${results.summary.status}`)
    return false
  }
  ctx.log("PASS: Results file written")

  return true
}

export const tests: TestDefinition[] = [{ name: "Usage test mod runs correctly", run: runTest }]

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests(tests)
}

import * as fs from "fs"
import * as path from "path"
import { runCli, runTestsDirectly, TestContext, TestDefinition } from "../test-utils.js"

async function testResultsFileCreated(ctx: TestContext): Promise<boolean> {
  await runCli({ dataDir: ctx.dataDir })

  const resultsPath = path.join(ctx.dataDir, "test-results.json")
  if (!fs.existsSync(resultsPath)) {
    ctx.log("FAIL: test-results.json not created")
    return false
  }
  ctx.log("PASS: test-results.json created")

  const content = JSON.parse(await fs.promises.readFile(resultsPath, "utf-8"))

  if (typeof content.timestamp !== "string") {
    ctx.log("FAIL: Missing timestamp")
    return false
  }
  ctx.log("PASS: Has timestamp")

  if (!Array.isArray(content.tests) || content.tests.length === 0) {
    ctx.log("FAIL: Missing tests array")
    return false
  }
  ctx.log(`PASS: Has ${content.tests.length} tests`)

  const expectedSummary = { failed: 1, passed: 5, skipped: 2, todo: 1, describeBlockErrors: 2, status: "failed" }
  let summaryPassed = true
  for (const [key, expected] of Object.entries(expectedSummary)) {
    const actual = content.summary?.[key]
    if (actual !== expected) {
      ctx.log(`FAIL: Expected summary.${key}=${expected}, got ${actual}`)
      summaryPassed = false
    } else {
      ctx.log(`PASS: summary.${key}=${expected}`)
    }
  }
  if (!summaryPassed) return false

  const expectedTestCount = 11
  if (content.tests.length !== expectedTestCount) {
    ctx.log(`FAIL: Expected ${expectedTestCount} tests, got ${content.tests.length}`)
    return false
  }
  ctx.log(`PASS: Correct test count (${expectedTestCount})`)

  return true
}

async function testNoOutputFileOption(ctx: TestContext): Promise<boolean> {
  await runCli({ dataDir: ctx.dataDir, extraArgs: ["--no-output-file"] })

  const resultsPath = path.join(ctx.dataDir, "test-results.json")
  if (fs.existsSync(resultsPath)) {
    ctx.log("FAIL: test-results.json should not exist with --no-output-file")
    return false
  }
  ctx.log("PASS: test-results.json not created")

  return true
}

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

export const tests: TestDefinition[] = [
  { name: "Failed tests reordered first", run: testFailedTestsReorderedFirst },
  { name: "Results file created", run: testResultsFileCreated },
  { name: "--no-output-file option", run: testNoOutputFileOption },
]

if (import.meta.url === `file://${process.argv[1]}`) {
  runTestsDirectly(tests)
}

import * as child_process from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { root, symlinkLocalFactorioTest } from "./test-utils.js"

interface TestResult {
  name: string
  passed: boolean
  messages: string[]
}

function runCli(dataDir: string, extraArgs: string[] = []): Promise<{ stdout: string; code: number }> {
  return new Promise((resolve) => {
    const args = [
      "run",
      "cli",
      "--workspace=cli",
      "--",
      "run",
      "--mod-path=../integration-tests/fixtures/usage-test-mod",
      `--data-directory=${dataDir}`,
      ...extraArgs,
    ]

    const child = child_process.spawn("npm", args, {
      stdio: ["inherit", "pipe", "pipe"],
      cwd: root,
      shell: true,
    })

    let stdout = ""
    child.stdout.on("data", (data) => (stdout += data.toString()))
    child.stderr.on("data", (data) => (stdout += data.toString()))
    child.on("exit", (code) => resolve({ stdout, code: code ?? 1 }))
  })
}

async function testResultsFileCreated(): Promise<TestResult> {
  const messages: string[] = []
  const log = (msg: string) => messages.push(msg)

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "factorio-test-results-"))
  const dataDir = path.join(tempDir, "data")
  const modsDir = path.join(dataDir, "mods")

  try {
    await symlinkLocalFactorioTest(modsDir)
    await runCli(dataDir)

    const resultsPath = path.join(dataDir, "test-results.json")
    if (!fs.existsSync(resultsPath)) {
      log("FAIL: test-results.json not created")
      return { name: "Results file created", passed: false, messages }
    }
    log("PASS: test-results.json created")

    const content = JSON.parse(await fs.promises.readFile(resultsPath, "utf-8"))

    if (typeof content.timestamp !== "string") {
      log("FAIL: Missing timestamp")
      return { name: "Results file created", passed: false, messages }
    }
    log("PASS: Has timestamp")

    if (!Array.isArray(content.tests) || content.tests.length === 0) {
      log("FAIL: Missing tests array")
      return { name: "Results file created", passed: false, messages }
    }
    log(`PASS: Has ${content.tests.length} tests`)

    if (content.summary?.failed !== 1) {
      log(`FAIL: Expected summary.failed=1, got ${content.summary?.failed}`)
      return { name: "Results file created", passed: false, messages }
    }
    log("PASS: Correct summary.failed count")

    return { name: "Results file created", passed: true, messages }
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
}

async function testNoOutputFileOption(): Promise<TestResult> {
  const messages: string[] = []
  const log = (msg: string) => messages.push(msg)

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "factorio-test-no-output-"))
  const dataDir = path.join(tempDir, "data")
  const modsDir = path.join(dataDir, "mods")

  try {
    await symlinkLocalFactorioTest(modsDir)
    await runCli(dataDir, ["--no-output-file"])

    const resultsPath = path.join(dataDir, "test-results.json")
    if (fs.existsSync(resultsPath)) {
      log("FAIL: test-results.json should not exist with --no-output-file")
      return { name: "--no-output-file option", passed: false, messages }
    }
    log("PASS: test-results.json not created")

    return { name: "--no-output-file option", passed: true, messages }
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
}

async function testFailedTestsReorderedFirst(): Promise<TestResult> {
  const messages: string[] = []
  const log = (msg: string) => messages.push(msg)

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "factorio-test-reorder-"))
  const dataDir = path.join(tempDir, "data")
  const modsDir = path.join(dataDir, "mods")

  try {
    await symlinkLocalFactorioTest(modsDir)

    log("First run...")
    await runCli(dataDir)

    const resultsPath = path.join(dataDir, "test-results.json")
    if (!fs.existsSync(resultsPath)) {
      log("FAIL: test-results.json not created")
      return { name: "Failed tests reordered first", passed: false, messages }
    }

    log("Second run (should reorder)...")
    const { stdout: stdout2 } = await runCli(dataDir)

    const passIndex = stdout2.indexOf("PASS test1 > Pass")
    const failIndex = stdout2.indexOf("FAIL test1 > each 2")

    if (passIndex === -1 || failIndex === -1) {
      log("FAIL: Could not find test results in output")
      return { name: "Failed tests reordered first", passed: false, messages }
    }

    if (failIndex < passIndex) {
      log("PASS: Failed test ran before passing test")
    } else {
      log("FAIL: Failed test should run first")
      return { name: "Failed tests reordered first", passed: false, messages }
    }

    return { name: "Failed tests reordered first", passed: true, messages }
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
}

async function main() {
  const tests = [testResultsFileCreated, testNoOutputFileOption, testFailedTestsReorderedFirst]

  console.log(`Running ${tests.length} results file tests sequentially...`)

  let passed = 0
  let failed = 0

  for (const test of tests) {
    const result = await test()
    console.log(`\n=== ${result.name} ===`)
    for (const msg of result.messages) {
      console.log(`  ${msg}`)
    }
    if (result.passed) {
      passed++
    } else {
      failed++
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}

main()

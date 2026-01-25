import * as child_process from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { root, symlinkLocalFactorioTest, sleep, waitForOutput, TestResult } from "../test-utils.js"

async function testWatchModeRerunsOnFileChange(): Promise<TestResult> {
  const messages: string[] = []
  const log = (msg: string) => messages.push(msg)

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "factorio-test-watch-"))
  const dataDir = path.join(tempDir, "data")
  const modsDir = path.join(dataDir, "mods")
  const modDir = path.join(tempDir, "test-mod")

  let child: child_process.ChildProcess | undefined

  try {
    await symlinkLocalFactorioTest(modsDir)

    await fs.promises.mkdir(modDir, { recursive: true })
    const srcModDir = path.join(root, "integration-tests/fixtures/usage-test-mod")
    for (const file of ["info.json", "control.lua", "test1.lua", "lualib_bundle.lua"]) {
      await fs.promises.copyFile(path.join(srcModDir, file), path.join(modDir, file))
    }

    const args = [
      "run",
      "cli",
      "--workspace=cli",
      "--",
      "run",
      `--mod-path=${modDir}`,
      `--data-directory=${dataDir}`,
      "--watch",
      "--test-pattern",
      "Pass",
    ]

    const output = { value: "" }

    child = child_process.spawn("npm", args, {
      stdio: ["inherit", "pipe", "pipe"],
      cwd: root,
    })

    child.stdout?.on("data", (data) => {
      output.value += data.toString()
    })
    child.stderr?.on("data", (data) => {
      output.value += data.toString()
    })

    const firstRunCompleted = await waitForOutput(output, "Test run result:", 60000)
    if (!firstRunCompleted) {
      log("  FAIL: First test run did not complete within timeout")
      log(`  Output: ${output.value.slice(-1000)}`)
      return { name: "Watch mode reruns on file change", passed: false, messages }
    }
    log("  PASS: First test run completed")

    output.value = ""

    await sleep(500)
    const testFile = path.join(modDir, "test1.lua")
    const now = new Date()
    await fs.promises.utimes(testFile, now, now)

    const rerunDetected = await waitForOutput(output, "File change detected", 5000)
    if (!rerunDetected) {
      log("  FAIL: File change was not detected")
      log(`  Output after touch: ${output.value}`)
      return { name: "Watch mode reruns on file change", passed: false, messages }
    }
    log("  PASS: File change detected")

    const secondRunCompleted = await waitForOutput(output, "Test run result:", 60000)
    if (!secondRunCompleted) {
      log("  FAIL: Second test run did not complete")
      log(`  Output: ${output.value.slice(-1000)}`)
      return { name: "Watch mode reruns on file change", passed: false, messages }
    }
    log("  PASS: Second test run completed after file change")

    return { name: "Watch mode reruns on file change", passed: true, messages }
  } finally {
    if (child && !child.killed) {
      child.kill("SIGTERM")
      await sleep(100)
      if (!child.killed) child.kill("SIGKILL")
    }
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
}

async function testWatchModeIgnoresNonMatchingFiles(): Promise<TestResult> {
  const messages: string[] = []
  const log = (msg: string) => messages.push(msg)

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), "factorio-test-watch-"))
  const dataDir = path.join(tempDir, "data")
  const modsDir = path.join(dataDir, "mods")
  const modDir = path.join(tempDir, "test-mod")

  let child: child_process.ChildProcess | undefined

  try {
    await symlinkLocalFactorioTest(modsDir)

    await fs.promises.mkdir(modDir, { recursive: true })
    const srcModDir = path.join(root, "integration-tests/fixtures/usage-test-mod")
    for (const file of ["info.json", "control.lua", "test1.lua", "lualib_bundle.lua"]) {
      await fs.promises.copyFile(path.join(srcModDir, file), path.join(modDir, file))
    }

    const args = [
      "run",
      "cli",
      "--workspace=cli",
      "--",
      "run",
      `--mod-path=${modDir}`,
      `--data-directory=${dataDir}`,
      "--watch",
      "--test-pattern",
      "Pass",
    ]

    const output = { value: "" }

    child = child_process.spawn("npm", args, {
      stdio: ["inherit", "pipe", "pipe"],
      cwd: root,
    })

    child.stdout?.on("data", (data) => {
      output.value += data.toString()
    })
    child.stderr?.on("data", (data) => {
      output.value += data.toString()
    })

    const firstRunCompleted = await waitForOutput(output, "Test run result:", 60000)
    if (!firstRunCompleted) {
      log("  FAIL: First test run did not complete within timeout")
      return { name: "Watch mode ignores non-matching files", passed: false, messages }
    }
    log("  PASS: First test run completed")

    output.value = ""

    await sleep(500)
    const tsFile = path.join(modDir, "test.ts")
    await fs.promises.writeFile(tsFile, "// test file")

    await sleep(1500)

    if (output.value.includes("File change detected")) {
      log("  FAIL: .ts file change triggered rerun (should be ignored with default patterns)")
      return { name: "Watch mode ignores non-matching files", passed: false, messages }
    }
    log("  PASS: .ts file change was correctly ignored")

    return { name: "Watch mode ignores non-matching files", passed: true, messages }
  } finally {
    if (child && !child.killed) {
      child.kill("SIGTERM")
      await sleep(100)
      if (!child.killed) child.kill("SIGKILL")
    }
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
}

async function main() {
  const tests = [testWatchModeRerunsOnFileChange, testWatchModeIgnoresNonMatchingFiles]

  console.log(`Running ${tests.length} watch mode tests...`)

  let passed = 0
  let failed = 0

  for (const test of tests) {
    const result = await test()
    console.log(`\n=== ${result.name} ===`)
    for (const msg of result.messages) {
      console.log(msg)
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

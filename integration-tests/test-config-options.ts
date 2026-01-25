import * as child_process from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { root, symlinkLocalFactorioTest } from "./test-utils.js"

interface TestCase {
  name: string
  modPath?: string
  args?: string[]
  configFile?: Record<string, unknown>
  expectedOutput?: string[]
  unexpectedOutput?: string[]
  expectedError?: string
  expectExitCode?: number
}

const defaultModPath = "../integration-tests/fixtures/usage-test-mod"

const testCases: TestCase[] = [
  {
    name: "CLI --test-pattern filters tests",
    args: ["--test-pattern", "Pass"],
    expectedOutput: ["PASS test1 > Pass", "CONFIG:test_pattern=(Pass)"],
    unexpectedOutput: ["PASS test1 > each 1", "PASS test1 > In world"],
  },
  {
    name: "CLI --game-speed option",
    args: ["--game-speed", "100"],
    expectedOutput: ["CONFIG:game_speed=100"],
  },
  {
    name: "Config file game_speed",
    configFile: { test: { game_speed: 200 } },
    expectedOutput: ["CONFIG:game_speed=200"],
  },
  {
    name: "CLI overrides config file",
    args: ["--game-speed", "300"],
    configFile: { test: { game_speed: 200 } },
    expectedOutput: ["CONFIG:game_speed=300"],
  },
  {
    name: "Config file default_timeout",
    configFile: { test: { default_timeout: 120 } },
    expectedOutput: ["CONFIG:default_timeout=120"],
  },
  {
    name: "Invalid config key throws error",
    configFile: { invalidKey: true },
    expectedError: "invalidKey",
    expectExitCode: 1,
  },
  {
    name: "Invalid test config key throws error",
    configFile: { test: { invalidTestKey: true } },
    expectedError: "invalidTestKey",
    expectExitCode: 1,
  },
  {
    name: "--config option loads custom config file",
    configFile: { test: { game_speed: 400 } },
    expectedOutput: ["CONFIG:game_speed=400"],
  },
  {
    name: ".only test with --forbid-only (default) fails",
    modPath: "../integration-tests/fixtures/only-test-mod",
    expectedOutput: ["only-test-mod: completed", "Error: .only tests are present"],
    expectExitCode: 1,
  },
  {
    name: ".only test with --no-forbid-only passes",
    modPath: "../integration-tests/fixtures/only-test-mod",
    args: ["--no-forbid-only"],
    expectedOutput: ["only-test-mod: completed", "Test run result: passed"],
    expectExitCode: 0,
  },
  {
    name: "Config file forbid_only: false allows .only tests",
    modPath: "../integration-tests/fixtures/only-test-mod",
    configFile: { forbid_only: false },
    expectedOutput: ["only-test-mod: completed", "Test run result: passed"],
    expectExitCode: 0,
  },
  {
    name: "No .only tests passes with --forbid-only",
    expectedOutput: ["Test run result:"],
    unexpectedOutput: ["Error: .only tests are present"],
  },
  {
    name: "--bail stops after first failure",
    args: ["--bail"],
    expectedOutput: ["FAIL test1 > each 2", "Bailed out after 1 failure(s)", "Test run result: failed"],
    unexpectedOutput: ["PASS test1 > In world", "PASS folder/test2 > Reload"],
    expectExitCode: 1,
  },
  {
    name: "--bail=2 stops after second failure (only one failure exists)",
    args: ["--bail=2"],
    expectedOutput: ["FAIL test1 > each 2", "PASS test1 > In world", "Test run result: failed"],
    unexpectedOutput: ["Bailed out after"],
    expectExitCode: 1,
  },
  {
    name: "--watch --graphics produces error",
    args: ["--watch", "--graphics"],
    expectedError: "--watch is only supported in headless mode",
    expectExitCode: 1,
  },
]

interface TestResult {
  name: string
  passed: boolean
  messages: string[]
}

async function runTest(tc: TestCase, index: number): Promise<TestResult> {
  const messages: string[] = []
  const log = (msg: string) => messages.push(msg)

  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `factorio-test-${index}-`))
  const dataDir = path.join(tempDir, "data")
  const modsDir = path.join(dataDir, "mods")
  const configFilePath = path.join(tempDir, "config.json")

  try {
    await symlinkLocalFactorioTest(modsDir)

    if (tc.configFile) {
      await fs.promises.writeFile(configFilePath, JSON.stringify(tc.configFile, null, 2))
    }

    const configArgs = tc.configFile ? ["--config", configFilePath] : []
    const modPath = tc.modPath ?? defaultModPath
    const args = [
      "run",
      "cli",
      "--workspace=cli",
      "--",
      "run",
      `--mod-path=${modPath}`,
      `--data-directory=${dataDir}`,
      ...configArgs,
      ...(tc.args ?? []),
    ]

    const passed = await new Promise<boolean>((resolve) => {
      const child = child_process.spawn("npm", args, {
        stdio: ["inherit", "pipe", "pipe"],
        cwd: root,
      })

      let stdout = ""
      let stderr = ""

      child.stdout.on("data", (data) => {
        stdout += data.toString()
      })
      child.stderr.on("data", (data) => {
        stderr += data.toString()
      })

      child.on("exit", (code) => {
        const output = stdout + stderr

        if (tc.expectedError) {
          if (output.includes(tc.expectedError)) {
            log(`  PASS: Found expected error "${tc.expectedError}"`)
            resolve(true)
          } else {
            log(`  FAIL: Expected error "${tc.expectedError}" not found`)
            log(`  Output: ${output.slice(0, 500)}`)
            resolve(false)
          }
          return
        }

        if (tc.expectExitCode !== undefined && code !== tc.expectExitCode) {
          log(`  FAIL: Expected exit code ${tc.expectExitCode}, got ${code}`)
          resolve(false)
          return
        }

        if (tc.expectedOutput) {
          let allFound = true
          for (const expected of tc.expectedOutput) {
            if (output.includes(expected)) {
              log(`  PASS: Found "${expected}"`)
            } else {
              log(`  FAIL: Expected "${expected}" not found`)
              allFound = false
            }
          }
          if (tc.unexpectedOutput) {
            for (const unexpected of tc.unexpectedOutput) {
              if (output.includes(unexpected)) {
                log(`  FAIL: Unexpected "${unexpected}" found`)
                allFound = false
              } else {
                log(`  PASS: Correctly missing "${unexpected}"`)
              }
            }
          }
          if (!allFound) {
            log(`  Output snippet: ${output.slice(0, 1000)}`)
          }
          resolve(allFound)
          return
        }

        resolve(code === 1)
      })
    })

    return { name: tc.name, passed, messages }
  } finally {
    await fs.promises.rm(tempDir, { recursive: true, force: true })
  }
}

async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await fn(items[index], index)
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker)
  await Promise.all(workers)
  return results
}

async function main() {
  const concurrency = Math.max(1, Math.floor(os.cpus().length / 2))
  console.log(`Running ${testCases.length} tests with concurrency ${concurrency}...`)

  const results = await runWithConcurrencyLimit(testCases, concurrency, runTest)

  let passed = 0
  let failed = 0

  for (const result of results) {
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

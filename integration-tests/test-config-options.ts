import * as child_process from "child_process"
import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, "..")
const customConfigPath = path.join(root, "scripts", "custom-test-config.json")

interface TestCase {
  name: string
  modPath?: string
  args?: string[]
  configFile?: Record<string, unknown>
  customConfigFile?: { path: string; content: Record<string, unknown> }
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
    args: ["--config", customConfigPath],
    customConfigFile: { path: customConfigPath, content: { test: { game_speed: 400 } } },
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
]

const configFilePath = path.join(root, "scripts", "test-config.json")

async function runTest(tc: TestCase): Promise<boolean> {
  console.log(`\n=== ${tc.name} ===`)

  if (tc.configFile) {
    fs.writeFileSync(configFilePath, JSON.stringify(tc.configFile, null, 2))
  } else if (fs.existsSync(configFilePath)) {
    fs.unlinkSync(configFilePath)
  }

  if (tc.customConfigFile) {
    fs.writeFileSync(tc.customConfigFile.path, JSON.stringify(tc.customConfigFile.content, null, 2))
  }

  const configArgs =
    tc.configFile || tc.customConfigFile ? ["--config", tc.customConfigFile?.path ?? configFilePath] : []
  const modPath = tc.modPath ?? defaultModPath
  const args = [
    "run",
    "cli",
    "--workspace=cli",
    "--",
    "run",
    `--mod-path=${modPath}`,
    ...configArgs,
    ...(tc.args ?? []),
  ]

  return new Promise((resolve) => {
    const child = child_process.spawn("npm", args, {
      stdio: ["inherit", "pipe", "pipe"],
      cwd: root,
      shell: true,
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
          console.log(`  PASS: Found expected error "${tc.expectedError}"`)
          resolve(true)
        } else {
          console.log(`  FAIL: Expected error "${tc.expectedError}" not found`)
          console.log(`  Output: ${output.slice(0, 500)}`)
          resolve(false)
        }
        return
      }

      if (tc.expectExitCode !== undefined && code !== tc.expectExitCode) {
        console.log(`  FAIL: Expected exit code ${tc.expectExitCode}, got ${code}`)
        resolve(false)
        return
      }

      if (tc.expectedOutput) {
        let allFound = true
        for (const expected of tc.expectedOutput) {
          if (output.includes(expected)) {
            console.log(`  PASS: Found "${expected}"`)
          } else {
            console.log(`  FAIL: Expected "${expected}" not found`)
            allFound = false
          }
        }
        if (tc.unexpectedOutput) {
          for (const unexpected of tc.unexpectedOutput) {
            if (output.includes(unexpected)) {
              console.log(`  FAIL: Unexpected "${unexpected}" found`)
              allFound = false
            } else {
              console.log(`  PASS: Correctly missing "${unexpected}"`)
            }
          }
        }
        if (!allFound) {
          console.log(`  Output snippet: ${output.slice(0, 1000)}`)
        }
        resolve(allFound)
        return
      }

      resolve(code === 1)
    })
  })
}

async function main() {
  let passed = 0
  let failed = 0

  for (const tc of testCases) {
    const result = await runTest(tc)
    if (result) {
      passed++
    } else {
      failed++
    }
  }

  if (fs.existsSync(configFilePath)) {
    fs.unlinkSync(configFilePath)
  }
  if (fs.existsSync(customConfigPath)) {
    fs.unlinkSync(customConfigPath)
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}

main()

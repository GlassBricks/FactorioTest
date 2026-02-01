import * as fs from "fs"
import * as path from "path"
import { runCli, runTestsDirectly, TestContext, TestDefinition } from "../test-utils.js"

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

const testCases: TestCase[] = [
  {
    name: "Default output shows PASS, FAIL, TODO but not SKIP",
    expectedOutput: ["PASS test1 > Pass", "FAIL test1 > each 2", "TODO test1 > TODO"],
    unexpectedOutput: ["SKIP test1 > Skip"],
    expectExitCode: 1,
  },
  {
    name: "--quiet hides all per-test output",
    args: ["--quiet"],
    expectedOutput: ["Tests: 1 failed, 2 errors, 1 todo, 2 skipped, 5 passed (9 total)"],
    unexpectedOutput: ["PASS test1 > Pass", "FAIL test1 > each 2", "TODO test1 > TODO", "SKIP test1 > Skip"],
    expectExitCode: 1,
  },
  {
    name: "--verbose shows all tests including SKIP",
    args: ["--verbose"],
    expectedOutput: ["PASS test1 > Pass", "FAIL test1 > each 2", "TODO test1 > TODO", "SKIP test1 > Skip"],
    expectExitCode: 1,
  },
  {
    name: "CLI --test-pattern filters tests",
    args: ["--test-pattern", "Pass"],
    expectedOutput: ["PASS test1 > Pass", "CONFIG:test_pattern=Pass"],
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
    expectedOutput: ["only-test-mod: completed", "Tests: 1 skipped, 1 passed (2 total)"],
    expectExitCode: 0,
  },
  {
    name: "Config file forbidOnly: false allows .only tests",
    modPath: "../integration-tests/fixtures/only-test-mod",
    configFile: { forbidOnly: false },
    expectedOutput: ["only-test-mod: completed", "Tests: 1 skipped, 1 passed (2 total)"],
    expectExitCode: 0,
  },
  {
    name: "No .only tests passes with --forbid-only",
    expectedOutput: ["Tests: 1 failed, 2 errors, 1 todo, 2 skipped, 5 passed (9 total)"],
    unexpectedOutput: ["Error: .only tests are present"],
  },
  {
    name: "Failure recap shows test and describe block errors separately",
    expectedOutput: [
      "Failures:",
      "FAIL test1 > each 2",
      "Describe block errors:",
      "ERROR test1 > fail in describe block",
      "ERROR test1 > Failing after_all hook",
      "Oh no",
    ],
    expectExitCode: 1,
  },
  {
    name: "--bail stops after first failure",
    args: ["--bail"],
    expectedOutput: [
      "FAIL test1 > each 2",
      "Bailed out after 1 failure(s)",
      "Failures:",
      "Errors:",
      "Tests: 1 failed, 1 todo, 1 skipped, 2 passed (5 total)",
    ],
    unexpectedOutput: ["PASS test1 > In world", "PASS folder/test2 > Reload"],
    expectExitCode: 1,
  },
  {
    name: "--bail=2 stops after second failure (only one failure exists)",
    args: ["--bail=2"],
    expectedOutput: [
      "FAIL test1 > each 2",
      "PASS test1 > In world",
      "Failures:",
      "Errors:",
      "Tests: 1 failed, 2 errors, 1 todo, 2 skipped, 5 passed (9 total)",
    ],
    unexpectedOutput: ["Bailed out after"],
    expectExitCode: 1,
  },
  {
    name: "Invalid config key throws error",
    configFile: { invalidKey: true },
    expectedError: "invalidKey",
    unexpectedOutput: ["CliError"],
    expectExitCode: 1,
  },
  {
    name: "Invalid test config key throws error",
    configFile: { test: { invalidTestKey: true } },
    expectedError: "invalidTestKey",
    unexpectedOutput: ["CliError"],
    expectExitCode: 1,
  },
]

function createTestFromCase(tc: TestCase): TestDefinition {
  return {
    name: tc.name,
    async run(ctx: TestContext): Promise<boolean> {
      const configFilePath = path.join(ctx.tempDir, "config.json")
      if (tc.configFile) {
        await fs.promises.writeFile(configFilePath, JSON.stringify(tc.configFile, null, 2))
      }

      const configArgs = tc.configFile ? ["--config", configFilePath] : []
      const extraArgs = [...configArgs, ...(tc.args ?? [])]

      const { stdout, stderr, code } = await runCli({
        modPath: tc.modPath,
        dataDir: ctx.dataDir,
        extraArgs,
      })

      const output = stdout + stderr

      if (tc.expectedError) {
        let passed = true
        if (output.includes(tc.expectedError)) {
          ctx.log(`PASS: Found expected error "${tc.expectedError}"`)
        } else {
          ctx.log(`FAIL: Expected error "${tc.expectedError}" not found`)
          passed = false
        }
        if (tc.unexpectedOutput) {
          for (const unexpected of tc.unexpectedOutput) {
            if (output.includes(unexpected)) {
              ctx.log(`FAIL: Unexpected "${unexpected}" found`)
              passed = false
            } else {
              ctx.log(`PASS: Correctly missing "${unexpected}"`)
            }
          }
        }
        if (!passed) {
          ctx.log(`Output: ${output.slice(0, 500)}`)
        }
        return passed
      }

      if (tc.expectExitCode !== undefined && code !== tc.expectExitCode) {
        ctx.log(`FAIL: Expected exit code ${tc.expectExitCode}, got ${code}`)
        return false
      }

      if (tc.expectedOutput) {
        let allFound = true
        for (const expected of tc.expectedOutput) {
          if (output.includes(expected)) {
            ctx.log(`PASS: Found "${expected}"`)
          } else {
            ctx.log(`FAIL: Expected "${expected}" not found`)
            allFound = false
          }
        }
        if (tc.unexpectedOutput) {
          for (const unexpected of tc.unexpectedOutput) {
            if (output.includes(unexpected)) {
              ctx.log(`FAIL: Unexpected "${unexpected}" found`)
              allFound = false
            } else {
              ctx.log(`PASS: Correctly missing "${unexpected}"`)
            }
          }
        }
        if (!allFound) {
          ctx.log(`Output snippet: ${output.slice(0, 1000)}`)
        }
        return allFound
      }

      return code === 1
    },
  }
}

export const tests: TestDefinition[] = testCases.map(createTestFromCase)

if (import.meta.url === `file://${process.argv[1]}`) {
  runTestsDirectly(tests)
}

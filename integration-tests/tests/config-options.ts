import * as fs from "fs"
import * as path from "path"
import { runCli, runTests, TestContext, TestDefinition } from "../test-utils.js"

interface TestCase {
  name: string
  modPath?: string
  args?: string[]
  configFile?: Record<string, unknown>
  expectedOutput: string[]
  unexpectedOutput?: string[]
  expectExitCode: number
}

const testCases: TestCase[] = [
  {
    name: "Test config from file and CLI reaches the mod",
    args: ["--game-speed", "300", "--test-pattern", "Pass"],
    configFile: { test: { game_speed: 200, default_timeout: 120 } },
    expectedOutput: [
      "CONFIG:game_speed=300",
      "CONFIG:default_timeout=120",
      "CONFIG:test_pattern=Pass",
      "PASS test1 > Pass",
    ],
    unexpectedOutput: ["PASS test1 > each 1", "PASS test1 > In world"],
    expectExitCode: 1,
  },
  {
    name: ".only test with --forbid-only (default) fails",
    modPath: "../integration-tests/fixtures/only-test-mod",
    expectedOutput: ["only-test-mod: completed", "Error: .only tests are present"],
    expectExitCode: 1,
  },
  {
    name: "--bail stops after first failure",
    args: ["--bail"],
    expectedOutput: [
      "FAIL test1 > each 2",
      "Bailed out after 1 failure(s)",
      "Tests: 1 failed, 1 todo, 1 skipped, 2 passed (5 total)",
    ],
    unexpectedOutput: ["PASS test1 > In world", "PASS folder/test2 > Reload"],
    expectExitCode: 1,
  },
]

function checkOutput(ctx: TestContext, output: string, tc: TestCase): boolean {
  const missing = tc.expectedOutput.filter((expected) => !output.includes(expected))
  const present = (tc.unexpectedOutput ?? []).filter((unexpected) => output.includes(unexpected))
  for (const expected of missing) ctx.log(`FAIL: Expected "${expected}" not found`)
  for (const unexpected of present) ctx.log(`FAIL: Unexpected "${unexpected}" found`)
  return missing.length === 0 && present.length === 0
}

function createTestFromCase(tc: TestCase): TestDefinition {
  return {
    name: tc.name,
    async run(ctx: TestContext): Promise<boolean> {
      const configFilePath = path.join(ctx.tempDir, "config.json")
      if (tc.configFile) {
        await fs.promises.writeFile(configFilePath, JSON.stringify(tc.configFile, null, 2))
      }
      const configArgs = tc.configFile ? ["--config", configFilePath] : []

      const { stdout, stderr, code } = await runCli({
        modPath: tc.modPath,
        dataDir: ctx.dataDir,
        extraArgs: [...configArgs, ...(tc.args ?? [])],
      })
      const output = stdout + stderr

      if (code !== tc.expectExitCode) {
        ctx.log(`FAIL: Expected exit code ${tc.expectExitCode}, got ${code}`)
        return false
      }
      const passed = checkOutput(ctx, output, tc)
      ctx.log(passed ? "PASS: Output matches" : `Output snippet: ${output.slice(0, 1000)}`)
      return passed
    },
  }
}

export const tests: TestDefinition[] = testCases.map(createTestFromCase)

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests(tests)
}

import * as fs from "fs"
import * as path from "path"
import { expect } from "vitest"
import { test } from "../test-fixture.js"
import { root, runCli, runCliWithTimeout } from "../test-utils.js"
import { writeModZip } from "../../cli/mods/test-helpers.js"

const { version: modVersion } = JSON.parse(fs.readFileSync(path.join(root, "mod", "info.json"), "utf-8")) as {
  version: string
}

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
    configFile: { gameSpeed: 200, defaultTimeout: 120 },
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

async function writeConfigFile(dir: string, config: Record<string, unknown> | undefined): Promise<string[]> {
  if (!config) return []
  const configFilePath = path.join(dir, "config.json")
  await fs.promises.writeFile(configFilePath, JSON.stringify(config, null, 2))
  return ["--config", configFilePath]
}

test.for(testCases.map((tc) => [tc.name, tc] as const))("%s", async ([, tc], { dirs }) => {
  const configArgs = await writeConfigFile(dirs.tempDir, tc.configFile)
  const { stdout, stderr, code } = await runCli({
    modPath: tc.modPath,
    dataDir: dirs.dataDir,
    extraArgs: [...configArgs, ...(tc.args ?? [])],
  })
  const output = stdout + stderr

  for (const expected of tc.expectedOutput) expect(output).toContain(expected)
  for (const unexpected of tc.unexpectedOutput ?? []) expect(output).not.toContain(unexpected)
  expect(code).toBe(tc.expectExitCode)
})

interface ModListEntry {
  name: string
  enabled: boolean
}

const dlcMods = ["space-age", "quality", "elevated-rails", "recycler"]

async function readDlcModStates(dataDir: string): Promise<Record<string, boolean | undefined>> {
  const modListPath = path.join(dataDir, "mods", "mod-list.json")
  const { mods } = JSON.parse(await fs.promises.readFile(modListPath, "utf-8")) as { mods: ModListEntry[] }
  return Object.fromEntries(dlcMods.map((name) => [name, mods.find((mod) => mod.name === name)?.enabled]))
}

function allDlcModsEnabled(enabled: boolean): Record<string, boolean> {
  return Object.fromEntries(dlcMods.map((name) => [name, enabled]))
}

test("DLC mods disabled by default", async ({ dirs }) => {
  await runCli({ dataDir: dirs.dataDir })

  expect(await readDlcModStates(dirs.dataDir)).toEqual(allDlcModsEnabled(false))
})

test("DLC mod enabled via --mods, with its dependencies", async ({ dirs }) => {
  const { stdout } = await runCli({ dataDir: dirs.dataDir, extraArgs: ["--mods", "space-age"] })

  expect(await readDlcModStates(dirs.dataDir)).toEqual(allDlcModsEnabled(true))
  expect(stdout).toContain("Usage test mod result: passed")
})

// Factorio rewrites mod-list.json on exit, keeping a pinned version only if it is not the highest installed one
test("enables exactly the resolved mods, pinned to the chosen versions", async ({ dirs }) => {
  const modsDir = path.join(dirs.dataDir, "mods")
  const dataLua = { "data.lua": "" }
  await writeModZip(modsDir, { name: "__ft-dep", version: "1.0.0" }, dataLua)
  await writeModZip(modsDir, { name: "__ft-dep", version: "1.1.0" }, dataLua)
  await writeModZip(modsDir, { name: "__ft-unused", version: "1.0.0" }, dataLua)

  const { stdout } = await runCli({
    dataDir: dirs.dataDir,
    extraArgs: ["--mods", "__ft-dep < 1.1", "space-age", "!quality"],
  })

  expect(stdout).toContain("Usage test mod result: passed")
  const { mods } = JSON.parse(await fs.promises.readFile(path.join(modsDir, "mod-list.json"), "utf-8")) as {
    mods: (ModListEntry & { version?: string })[]
  }
  expect(mods).toEqual(
    expect.arrayContaining([
      { name: "__ft-dep", enabled: true, version: "1.0.0" },
      { name: "__ft-unused", enabled: false },
      { name: "space-age", enabled: true },
      { name: "quality", enabled: false },
    ]),
  )
  const lock = JSON.parse(await fs.promises.readFile(path.join(dirs.tempDir, "factorio-test.lock.json"), "utf-8"))
  expect(lock).toEqual({ lockVersion: 1, mods: { "__ft-dep": "1.0.0", "factorio-test": modVersion } })
  const log = await fs.promises.readFile(path.join(dirs.dataDir, "factorio-current.log"), "utf-8")
  expect(log).toContain("Loading mod __ft-dep 1.0.0 (data.lua)")
  expect(log).toContain("Loading mod space-age ")
  expect(log).not.toMatch(/Loading mod (quality|__ft-unused) /)
})

test("--output-timeout kills stuck process", async ({ dirs }) => {
  const { stdout, stderr, code } = await runCliWithTimeout(
    {
      modPath: "../integration-tests/fixtures/infinite-loop-mod",
      dataDir: dirs.dataDir,
      extraArgs: ["--output-timeout", "3"],
    },
    30,
  )
  const output = stdout + stderr

  expect(output).toContain("no output received for 3 seconds")
  expect(output).toContain(path.join(dirs.dataDir, "factorio-current.log"))
  expect(code).not.toBe(0)
})

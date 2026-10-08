import * as fs from "fs"
import * as path from "path"
import { expect } from "vitest"
import { test } from "../test-fixture.js"
import { fixturePath, runCli } from "../test-utils.js"

interface ResultsFile {
  modName: string
  tests: { path: string; result: string }[]
  summary: { status: string }
}

async function readResults(dataDir: string): Promise<ResultsFile> {
  return JSON.parse(await fs.promises.readFile(path.join(dataDir, "test-results.json"), "utf-8")) as ResultsFile
}

test("Standalone scenario via --scenario-path", async ({ dirs }) => {
  const { stdout, code } = await runCli({
    modPath: null,
    dataDir: dirs.dataDir,
    extraArgs: ["--scenario-path", fixturePath("test-scenario")],
  })

  expect(stdout).toContain('Creating a game from scenario "test-scenario"')
  expect(stdout).toContain("Tests: 1 failed, 1 passed (2 total)")
  expect(code).toBe(1)

  const results = await readResults(dirs.dataDir)
  expect(results.modName).toBe("level")
  expect(results.summary.status).toBe("failed")
  expect(results.tests.map(({ path, result }) => [path, result])).toEqual([
    ["tests.scenario-test > Pass", "passed"],
    ["tests.scenario-test > Fail", "failed"],
  ])
})

test("Mod-shipped scenario via --mod-path and --scenario", async ({ dirs }) => {
  const { stdout, code } = await runCli({
    modPath: fixturePath("scenario-mod"),
    dataDir: dirs.dataDir,
    extraArgs: ["--scenario", "factorio-test-scenario-mod/s1"],
  })

  expect(stdout).toContain("PASS tests.s1-test > Level from mod")
  expect(stdout).toContain("Tests: 1 passed (1 total)")
  expect(code).toBe(0)
})

test("--scenario from another mod than --mod-path is an error", async ({ dirs }) => {
  const { stderr, code } = await runCli({
    dataDir: dirs.dataDir,
    extraArgs: ["--scenario", "factorio-test-scenario-mod/s1"],
  })

  expect(stderr).toContain(
    '--scenario factorio-test-scenario-mod/s1 is from mod "factorio-test-scenario-mod", but --mod-path is mod "__factorio-usage-test-mod".',
  )
  expect(code).toBe(1)
})

test("Mod tests in a new game from --start-scenario", async ({ dirs }) => {
  const { stdout } = await runCli({ dataDir: dirs.dataDir, extraArgs: ["--start-scenario", "base/freeplay"] })

  expect(stdout).toContain('Creating a game from scenario "base/freeplay"')
  expect(stdout).toContain("CONFIG:level_name=freeplay")
  expect(stdout).toContain("Usage test mod result: passed")
})

test("Scenario failing on_init fails the run before tests", async ({ dirs }) => {
  const { stdout, stderr, code } = await runCli({
    modPath: null,
    dataDir: dirs.dataDir,
    extraArgs: ["--scenario-path", fixturePath("error-scenario")],
  })

  expect(stderr).toContain('Creating a game from scenario "error-scenario" failed (exit code')
  expect(stderr).toContain("error-scenario on_init failed")
  expect(stdout).not.toContain("Running tests")
  expect(code).toBe(1)
})

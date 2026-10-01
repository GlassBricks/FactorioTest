import * as fs from "fs"
import * as path from "path"
import { expect } from "vitest"
import { test } from "../test-fixture.js"
import { runCli } from "../test-utils.js"

interface ResultsFile {
  tests: unknown[]
  summary: { status: string }
}

test("Usage test mod runs correctly", async ({ dirs }) => {
  const { stdout, code } = await runCli({ dataDir: dirs.dataDir })

  expect(stdout).toContain("Usage test mod result: passed")
  expect(stdout, "re-record cli transcript if mod output changed").toContain(
    "Tests: 1 failed, 2 errors, 1 todo, 2 skipped, 5 passed (9 total)",
  )
  expect(code).toBe(1)

  const resultsPath = path.join(dirs.dataDir, "test-results.json")
  const results = JSON.parse(await fs.promises.readFile(resultsPath, "utf-8")) as ResultsFile
  expect(results.tests).toHaveLength(11)
  expect(results.summary.status).toBe("failed")
})

test("Failed tests reordered first", async ({ dirs }) => {
  await runCli({ dataDir: dirs.dataDir })
  expect(fs.existsSync(path.join(dirs.dataDir, "test-results.json")), "test-results.json not created").toBe(true)

  const { stdout } = await runCli({ dataDir: dirs.dataDir, extraArgs: ["--reorder-failed-first"] })

  expect(stdout).toMatch(/FAIL test1 > each 2[\s\S]*PASS test1 > Pass/)
})

import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { checkScenarioExists, linkScenario } from "./link.js"

let tempDir: string
let dataDir: string
let scenarioDir: string

beforeEach(async () => {
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "factorio-test-link-"))
  dataDir = path.join(tempDir, "data")
  scenarioDir = path.join(tempDir, "src", "my-scenario")
  await fsp.mkdir(scenarioDir, { recursive: true })
})

afterEach(async () => {
  await fsp.rm(tempDir, { recursive: true, force: true })
})

const linkPath = () => path.join(dataDir, "scenarios", "my-scenario")

describe("linkScenario", () => {
  it("links the scenario folder into the scenarios dir, by its folder name", async () => {
    expect(await linkScenario(dataDir, scenarioDir + path.sep)).toBe("my-scenario")
    expect(await fsp.realpath(linkPath())).toBe(await fsp.realpath(scenarioDir))
  })

  it("replaces a symlink pointing elsewhere", async () => {
    await fsp.mkdir(path.dirname(linkPath()), { recursive: true })
    await fsp.symlink(tempDir, linkPath())
    await linkScenario(dataDir, scenarioDir)
    expect(await fsp.realpath(linkPath())).toBe(await fsp.realpath(scenarioDir))
  })

  it("rejects an existing path that is not a symlink", async () => {
    await fsp.mkdir(linkPath(), { recursive: true })
    await expect(linkScenario(dataDir, scenarioDir)).rejects.toThrow(
      `${linkPath()} already exists and is not a symlink. Remove it, or use --scenario my-scenario.`,
    )
  })
})

describe("checkScenarioExists", () => {
  it("accepts a scenario in the data dir", async () => {
    await linkScenario(dataDir, scenarioDir)
    await expect(checkScenarioExists(dataDir, "my-scenario")).resolves.toBeUndefined()
  })

  it("rejects a missing scenario", async () => {
    await expect(checkScenarioExists(dataDir, "missing")).rejects.toThrow(
      `Scenario missing not found in ${path.join(dataDir, "scenarios")}.`,
    )
  })
})

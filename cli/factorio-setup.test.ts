import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildAutoStartConfig, readDataPath, resolveWatchTarget } from "./factorio-setup.js"
import type { TestTarget } from "./run-plan.js"

describe("buildAutoStartConfig", () => {
  it.each([
    ["headless", undefined, { mod: "my-mod", headless: true }],
    ["graphics", [], { mod: "my-mod", headless: false }],
    ["headless", ["a > b"], { mod: "my-mod", headless: true, last_failed_tests: ["a > b"] }],
  ] as const)("mode=%s lastFailedTests=%j", (mode, lastFailedTests, expected) => {
    expect(buildAutoStartConfig("my-mod", mode, lastFailedTests && [...lastFailedTests])).toEqual(expected)
  })
})

describe("readDataPath", () => {
  it.each<[NodeJS.Platform, string]>([
    ["darwin", "__PATH__executable__/../data"],
    ["linux", "__PATH__executable__/../../data"],
    ["win32", "__PATH__executable__/../../data"],
  ])("%s => %s", (platform, expected) => {
    expect(readDataPath(platform)).toBe(expected)
  })
})

describe("resolveWatchTarget", () => {
  let tempDir: string
  let dataDir: string
  let modsDir: string

  beforeAll(async () => {
    tempDir = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), "factorio-test-watch-")))
    dataDir = path.join(tempDir, "data")
    modsDir = path.join(dataDir, "mods")
    await fsp.mkdir(path.join(tempDir, "src", "my-scenario"), { recursive: true })
    await fsp.mkdir(path.join(dataDir, "scenarios", "local"), { recursive: true })
    await fsp.mkdir(path.join(modsDir, "dir-mod"), { recursive: true })
    await fsp.writeFile(path.join(modsDir, "zip-mod_1.0.0.zip"), "")
    await fsp.symlink(path.join(tempDir, "src", "my-scenario"), path.join(dataDir, "scenarios", "linked"))
  })

  afterAll(async () => {
    await fsp.rm(tempDir, { recursive: true, force: true })
  })

  const scenario = (ref: string, extra: object = {}): TestTarget => ({ kind: "scenario", ref, ...extra })

  it.each<[string, TestTarget, (dirs: { tempDir: string; dataDir: string; modsDir: string }) => object]>([
    [
      "--mod-path",
      { kind: "mod", modPath: "/src/my-mod" },
      () => ({ type: "directory", path: path.resolve("/src/my-mod") }),
    ],
    [
      "--mod-name, directory",
      { kind: "mod", modName: "dir-mod" },
      (d) => ({ type: "directory", path: path.join(d.modsDir, "dir-mod") }),
    ],
    [
      "--mod-name, zip",
      { kind: "mod", modName: "zip-mod" },
      (d) => ({ type: "file", path: path.join(d.modsDir, "zip-mod_1.0.0.zip") }),
    ],
    [
      "--mod-path with --scenario",
      scenario("my-mod/s1", { providingModPath: "/src/my-mod" }),
      () => ({ type: "directory", path: path.resolve("/src/my-mod") }),
    ],
    [
      "--scenario-path",
      scenario("s", { scenarioPath: "/src/s" }),
      () => ({ type: "directory", path: path.resolve("/src/s") }),
    ],
    [
      "--scenario NAME",
      scenario("local"),
      (d) => ({ type: "directory", path: path.join(d.dataDir, "scenarios", "local") }),
    ],
    [
      "--scenario NAME, symlinked",
      scenario("linked"),
      (d) => ({ type: "directory", path: path.join(d.tempDir, "src", "my-scenario") }),
    ],
    [
      "--scenario MOD/NAME",
      scenario("dir-mod/s1"),
      (d) => ({ type: "directory", path: path.join(d.modsDir, "dir-mod") }),
    ],
  ])("%s", async (_, target, expected) => {
    const result = await resolveWatchTarget({ target, world: { kind: "bundled" } }, dataDir, modsDir)
    expect(result).toEqual(expected({ tempDir, dataDir, modsDir }))
  })

  it.each([
    ["missing", "Cannot watch --scenario missing"],
    ["zip-mod/s1", "Cannot watch --scenario zip-mod/s1"],
  ])("rejects --scenario %s", async (ref, message) => {
    await expect(
      resolveWatchTarget({ target: scenario(ref), world: { kind: "bundled" } }, dataDir, modsDir),
    ).rejects.toThrow(message)
  })
})

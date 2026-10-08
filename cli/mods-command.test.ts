import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { main } from "./main.js"
import { LOCK_FILE_NAME } from "./mods/lock.js"
import { FAKE_TOKEN, FAKE_USERNAME, FakePortal, writeModDir } from "./mods/test-helpers.js"

let tempDir: string
let fake: FakePortal
let stdout: string[]
let stderr: string[]

beforeEach(async () => {
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "factorio-test-mods-command-"))
  const factorioPath = path.join(tempDir, "factorio", "bin", "x64", "factorio")
  await fsp.mkdir(path.dirname(factorioPath), { recursive: true })
  await fsp.writeFile(factorioPath, '#!/bin/sh\necho "Version: 2.1.20 (build 1, linux64, headless)"\n', { mode: 0o755 })
  await writeModDir(path.join(tempDir, "my-mod"), { name: "my-mod", version: "1.0.0", dependencies: ["flib"] })

  fake = await new FakePortal().start()
  await fake.addRelease({ name: "factorio-test", version: "3.1.1" })
  await fake.addRelease({ name: "flib", version: "0.16.0" })

  vi.stubEnv("FACTORIO_TEST_MOD_PORTAL_URL", fake.url)
  vi.stubEnv("FACTORIO_USERNAME", FAKE_USERNAME)
  vi.stubEnv("FACTORIO_TOKEN", FAKE_TOKEN)
  vi.stubEnv("CI", "")
  stdout = []
  stderr = []
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void stdout.push(args.join(" ")))
  vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void stderr.push(args.join(" ")))
})

afterEach(async () => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  await fake.stop()
  await fsp.rm(tempDir, { recursive: true, force: true })
})

async function writeConfig(mods: string[] = []): Promise<string> {
  const configPath = path.join(tempDir, "factorio-test.json")
  const config = {
    modPath: "my-mod",
    dataDirectory: "data",
    factorioPath: "factorio/bin/x64/factorio",
    mods,
    gameSpeed: 10,
  }
  await fsp.writeFile(configPath, JSON.stringify(config))
  return configPath
}

async function mods(...args: string[]): Promise<number> {
  return main(["node", "factorio-test", "mods", ...args, "--config", await writeConfig()])
}

async function readLockFile(): Promise<Record<string, string>> {
  return (
    JSON.parse(await fsp.readFile(path.join(tempDir, LOCK_FILE_NAME), "utf8")) as { mods: Record<string, string> }
  ).mods
}

describe("mods install", () => {
  it("downloads mods and writes the lock, without enabling mods", async () => {
    expect(await mods("install")).toBe(0)
    expect(await readLockFile()).toEqual({ flib: "0.16.0" })
    const modsDir = path.join(tempDir, "data", "mods")
    expect((await fsp.readdir(modsDir)).sort()).toEqual(["factorio-test_3.1.1.zip", "flib_0.16.0.zip", "my-mod"])
    expect(stdout).toContain("Mods: factorio-test 3.1.1 (downloaded), flib 0.16.0 (downloaded)")
  })

  it("rejects positional arguments", async () => {
    expect(await mods("install", "flib")).toBe(1)
    expect(stderr.join("\n")).toContain('To add a mod, list it in "mods" in factorio-test.json.')
  })

  it("is frozen in CI", async () => {
    vi.stubEnv("CI", "true")
    expect(await mods("install")).toBe(1)
    expect(stderr.join("\n")).toContain(`No ${LOCK_FILE_NAME} found in ${tempDir}.`)
  })
})

describe("mods update", () => {
  beforeEach(async () => {
    expect(await mods("install")).toBe(0)
    await fake.addRelease({ name: "flib", version: "0.17.0" })
    await fake.addRelease({ name: "factorio-test", version: "3.2.0" })
    stdout.length = 0
  })

  it("updates all mods except the pinned factorio-test, ignoring frozen mode", async () => {
    vi.stubEnv("CI", "true")
    expect(await mods("update")).toBe(0)
    expect(await readLockFile()).toEqual({ flib: "0.17.0" })
    expect(stdout).toContain("Mods: factorio-test 3.1.1, flib 0.17.0 (downloaded)")
    expect(stdout.at(-1)).toBe("flib 0.16.0 → 0.17.0")
  })

  it("updates only the named mods", async () => {
    expect(await mods("update", "flib")).toBe(0)
    expect(await readLockFile()).toEqual({ flib: "0.17.0" })
  })

  it("rejects updating factorio-test", async () => {
    expect(await mods("update", "factorio-test")).toBe(1)
    expect(stderr.join("\n")).toContain("The factorio-test version is set by the CLI version.")
  })

  it("says when a config constraint holds a mod back", async () => {
    const config = await writeConfig(["flib < 0.17"])
    expect(await main(["node", "factorio-test", "mods", "update", "flib", "--config", config])).toBe(0)
    expect(stdout).toContain("flib 0.16.0: 0.17.0 is available, but held back by < 0.17 (from config mods)")
  })

  it("reports when nothing changed", async () => {
    await mods("update")
    stdout.length = 0
    expect(await mods("update")).toBe(0)
    expect(stdout).toContain("All mods up to date.")
  })

  it("rejects a mod not used by the test run", async () => {
    expect(await mods("update", "nope")).toBe(1)
    expect(stderr.join("\n")).toContain('"nope" is not used by this test run.')
  })
})

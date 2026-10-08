import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { majorMinor } from "./dependency.js"
import { enableMods, factorioTestVersion, installMods, linkModUnderTest, type ModSetupInput } from "./install.js"
import { LOCK_FILE_NAME } from "./lock.js"
import { ModPortal } from "./portal.js"
import { FAKE_TOKEN, FAKE_USERNAME, FakePortal, writeModDir, writeModZip } from "./test-helpers.js"

let tempDir: string
let modsDir: string
let fake: FakePortal
let output: string[]

const pinned = factorioTestVersion("2.1.20")

const credentialsEnv = { FACTORIO_USERNAME: FAKE_USERNAME, FACTORIO_TOKEN: FAKE_TOKEN }

beforeEach(async () => {
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "factorio-test-install-"))
  modsDir = path.join(tempDir, "data", "mods")
  await writeFakeFactorio("2.1.20")
  await writeModDir(path.join(tempDir, "my-mod"), { name: "my-mod", version: "1.0.0", dependencies: ["flib >= 0.16"] })

  fake = await new FakePortal().start()
  await fake.addRelease({ name: "factorio-test", version: pinned })
  await fake.addRelease({ name: "flib", version: "0.16.0" })
  await fake.addRelease({ name: "flib", version: "0.17.0", dependencies: ["helper"] })
  await fake.addRelease({ name: "helper", version: "1.0.0" })

  output = []
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void output.push(args.join(" ")))
})

async function writeFakeFactorio(version: string): Promise<void> {
  const factorioPath = path.join(tempDir, "factorio", "bin", "x64", "factorio")
  await fsp.mkdir(path.dirname(factorioPath), { recursive: true })
  await fsp.writeFile(factorioPath, `#!/bin/sh\necho "Version: ${version} (build 1, linux64, headless)"\n`, {
    mode: 0o755,
  })
}

afterEach(async () => {
  vi.restoreAllMocks()
  await fake.stop()
  await fsp.rm(tempDir, { recursive: true, force: true })
})

function input(overrides: Partial<ModSetupInput> = {}): ModSetupInput {
  return {
    modsDir,
    factorioPath: path.join(tempDir, "factorio", "bin", "x64", "factorio"),
    modPath: path.join(tempDir, "my-mod"),
    modsSource: "config mods",
    lockDir: tempDir,
    frozen: false,
    portal: new ModPortal({ baseUrl: fake.url, retryDelaysMs: [] }),
    env: credentialsEnv,
    homeDir: path.join(tempDir, "home"),
    ...overrides,
  }
}

async function readLockFile(): Promise<unknown> {
  return JSON.parse(await fsp.readFile(path.join(tempDir, LOCK_FILE_NAME), "utf8"))
}

describe("installMods", () => {
  it("downloads dependencies, writes the lock and prints the summary", async () => {
    await installMods(input())

    expect((await fsp.readdir(modsDir)).sort()).toEqual([
      `factorio-test_${pinned}.zip`,
      "flib_0.17.0.zip",
      "helper_1.0.0.zip",
      "my-mod",
    ])
    expect(await readLockFile()).toEqual({
      lockVersion: 1,
      mods: { flib: "0.17.0", helper: "1.0.0" },
    })
    expect(output).toContain(
      `Mods: factorio-test ${pinned} (downloaded), flib 0.17.0 (downloaded), helper 1.0.0 (downloaded)`,
    )
  })

  it("uses no network once everything is installed", async () => {
    await installMods(input())
    fake.requests.length = 0
    await installMods(input({ env: {} }))
    expect(fake.requests).toEqual([])
    expect(output).toContain(`Mods: factorio-test ${pinned}, flib 0.17.0, helper 1.0.0`)
  })

  it("keeps the locked version, even if a newer one is installed", async () => {
    await fsp.writeFile(
      path.join(tempDir, LOCK_FILE_NAME),
      JSON.stringify({ lockVersion: 1, mods: { flib: "0.16.0" } }),
    )
    await writeModZip(modsDir, { name: "flib", version: "0.17.0", dependencies: ["helper"] })
    const result = await installMods(input())
    expect(result.resolution.enabled.get("flib")?.version).toBe("0.16.0")
    expect(await fsp.readdir(modsDir)).toContain("flib_0.16.0.zip")
  })

  it("frozen: errors before downloading if the lock is out of date", async () => {
    await fsp.writeFile(
      path.join(tempDir, LOCK_FILE_NAME),
      JSON.stringify({ lockVersion: 1, mods: { flib: "0.16.0" } }),
    )
    await expect(installMods(input({ frozen: true, mods: ["flib >= 0.17"] }))).rejects.toThrow(
      `${LOCK_FILE_NAME} is out of date:\n  flib: 0.16.0 (lock) → 0.17.0 (resolved)\n  + helper 1.0.0`,
    )
    expect(fake.requests.filter((r) => r.startsWith("/download"))).toEqual([])
  })

  it("frozen: errors without a lock file", async () => {
    await expect(installMods(input({ frozen: true }))).rejects.toThrow(`No ${LOCK_FILE_NAME} found in ${tempDir}.`)
  })

  it("removes the lock file when there is nothing left to lock", async () => {
    await installMods(input())
    await writeModDir(path.join(tempDir, "my-mod"), { name: "my-mod", version: "1.0.0" })
    await installMods(input())
    await expect(fsp.stat(path.join(tempDir, LOCK_FILE_NAME))).rejects.toThrow()
    expect(output).toContain(`Removed ${path.join(tempDir, LOCK_FILE_NAME)}`)
  })

  it("without credentials, lists what needs downloading", async () => {
    await expect(installMods(input({ env: {} }))).rejects.toThrow(
      `These mods need to be downloaded from the Factorio mod portal:\n  factorio-test ${pinned}, flib 0.17.0, helper 1.0.0`,
    )
    await expect(fsp.stat(path.join(tempDir, LOCK_FILE_NAME))).rejects.toThrow()
  })

  it("reports rejected credentials", async () => {
    await expect(
      installMods(input({ env: { FACTORIO_USERNAME: FAKE_USERNAME, FACTORIO_TOKEN: "old" } })),
    ).rejects.toThrow(`The Factorio mod portal rejected the credentials for user "${FAKE_USERNAME}"`)
  })

  it("reports a mod that is not on the portal", async () => {
    await expect(installMods(input({ mods: ["flb"] }))).rejects.toThrow(
      'No mod named "flb" on the mod portal (required by config mods).',
    )
  })

  it("enableMods pins the chosen versions", async () => {
    await writeModZip(modsDir, { name: "unused", version: "1.0.0" })
    await enableMods(modsDir, await installMods(input({ mods: ["flib < 0.17"] })))
    const { mods } = JSON.parse(await fsp.readFile(path.join(modsDir, "mod-list.json"), "utf8")) as {
      mods: unknown[]
    }
    expect(mods).toEqual(
      expect.arrayContaining([
        { name: "flib", enabled: true, version: "0.16.0" },
        { name: "my-mod", enabled: true, version: "1.0.0" },
        { name: "unused", enabled: false },
        { name: "quality", enabled: false },
      ]),
    )
  })

  it("enableMods leaves out disabled mods", async () => {
    await enableMods(modsDir, await installMods(input()), ["factorio-test"])
    const { mods } = JSON.parse(await fsp.readFile(path.join(modsDir, "mod-list.json"), "utf8")) as {
      mods: unknown[]
    }
    expect(mods).toEqual(
      expect.arrayContaining([
        { name: "factorio-test", enabled: false },
        { name: "my-mod", enabled: true, version: "1.0.0" },
      ]),
    )
  })

  it("resolves only listed mods without a mod under test", async () => {
    const result = await installMods(input({ modPath: undefined, mods: ["helper"] }))
    expect(result.modToTest).toBeUndefined()
    expect([...result.resolution.enabled.keys()].sort()).toEqual(["base", "factorio-test", "helper"])
  })
})

describe("linkModUnderTest", () => {
  it("links the mod by its info.json name, replacing an existing symlink", async () => {
    await fsp.mkdir(modsDir, { recursive: true })
    await fsp.symlink(tempDir, path.join(modsDir, "my-mod"))
    expect(await linkModUnderTest(modsDir, path.join(tempDir, "my-mod"))).toBe("my-mod")
    expect(await fsp.realpath(path.join(modsDir, "my-mod"))).toBe(await fsp.realpath(path.join(tempDir, "my-mod")))
  })

  it("rejects an existing path that is not a symlink", async () => {
    await writeModDir(path.join(modsDir, "my-mod"), { name: "my-mod", version: "1.0.0" })
    await expect(linkModUnderTest(modsDir, path.join(tempDir, "my-mod"))).rejects.toThrow(
      "already exists and is not a symlink. Remove it, or use --mod-name my-mod.",
    )
  })
})

describe("factorio-test version", () => {
  beforeEach(async () => {
    await writeModDir(path.join(tempDir, "my-mod"), { name: "my-mod", version: "1.0.0" })
  })

  async function addFactorioTestReleases(): Promise<void> {
    // the pinned versions, and an unpinned one per Factorio version
    for (const [version, factorioVersion] of [
      [factorioTestVersion("2.0.0"), "2.0"],
      ["3.0.0", "2.0"],
      [pinned, "2.1"],
      ["3.1.0", "2.1"],
    ] as const) {
      await fake.addRelease({ name: "factorio-test", version, factorio_version: factorioVersion })
    }
  }

  it.each(["2.0.77", "2.1.20"])(
    "Factorio %s uses the pinned factorio-test, and needs no lock file",
    async (gameVersion) => {
      await writeFakeFactorio(gameVersion)
      await writeModDir(path.join(tempDir, "my-mod"), {
        name: "my-mod",
        version: "1.0.0",
        factorio_version: majorMinor(gameVersion),
      })
      await addFactorioTestReleases()

      const result = await installMods(input())

      expect(result.resolution.enabled.get("factorio-test")?.version).toBe(factorioTestVersion(gameVersion))
      await expect(fsp.stat(path.join(tempDir, LOCK_FILE_NAME))).rejects.toThrow()
    },
  )

  it("pins this repository's factorio-test version", async () => {
    const infoJsonPath = path.join(import.meta.dirname, "..", "..", "mod", "info.json")
    const info = JSON.parse(await fsp.readFile(infoJsonPath, "utf8")) as { version: string; factorio_version: string }
    expect(factorioTestVersion(`${info.factorio_version}.0`)).toBe(info.version)
  })

  it("uses a user-managed factorio-test at any version, with a warning", async () => {
    const warnings: string[] = []
    vi.spyOn(console, "warn").mockImplementation((...args: unknown[]) => void warnings.push(args.join(" ")))
    await writeModDir(path.join(modsDir, "factorio-test"), { name: "factorio-test", version: "3.1.5" })

    const result = await installMods(input())

    expect(result.resolution.enabled.get("factorio-test")?.version).toBe("3.1.5")
    expect(warnings).toEqual([`Using user-managed factorio-test 3.1.5; this CLI version uses ${pinned}.`])
  })

  it("a mods entry for factorio-test replaces the pinned version", async () => {
    await addFactorioTestReleases()
    const result = await installMods(input({ mods: ["factorio-test = 3.1.0"] }))
    expect(result.resolution.enabled.get("factorio-test")?.version).toBe("3.1.0")
  })
})

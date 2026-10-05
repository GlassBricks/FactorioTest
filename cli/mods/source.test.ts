import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import type { LockedMods } from "./lock.js"
import type { Candidate } from "./resolve.js"
import type { PortalRelease } from "./portal.js"
import { type CandidateSourceOptions, ModCandidateSource, scanModsDir } from "./source.js"
import { writeModDir, writeModZip } from "./test-helpers.js"

let tempDir: string
let modsDir: string

beforeEach(async () => {
  tempDir = await fsp.mkdtemp(path.join(os.tmpdir(), "factorio-test-source-"))
  modsDir = path.join(tempDir, "mods")
  await writeModZip(modsDir, { name: "flib", version: "0.16.0" })
  await writeModZip(modsDir, { name: "flib", version: "0.17.0", dependencies: ["base >= 2.1", "? other"] })
  await writeModZip(modsDir, { name: "my-lib", version: "0.2.0" })
  await writeModDir(path.join(modsDir, "my-lib"), { name: "my-lib", version: "0.3.0" })
  await writeModDir(path.join(tempDir, "linked-src"), { name: "linked", version: "1.0.0" })
  await fsp.symlink(path.join(tempDir, "linked-src"), path.join(modsDir, "linked"))
  await writeModDir(path.join(tempDir, "my-mod"), { name: "my-mod", version: "0.0.1" })
  await fsp.symlink(path.join(tempDir, "my-mod"), path.join(modsDir, "my-mod"))
  await writeModZip(modsDir, { name: "zipped-mod", version: "1.0.0" })
  await writeModZip(modsDir, { name: "zipped-mod", version: "1.1.0" })
  await fsp.writeFile(path.join(modsDir, "mod-list.json"), "{}")
  await fsp.mkdir(path.join(modsDir, "no-info-json"))
})

afterEach(async () => {
  await fsp.rm(tempDir, { recursive: true, force: true })
})

async function collect(source: ModCandidateSource, name: string): Promise<Partial<Candidate>[]> {
  const result: Partial<Candidate>[] = []
  for await (const { version, origin, factorioVersion } of source.candidates(name)) {
    result.push({ version, origin, factorioVersion })
  }
  return result
}

async function firstCandidate(source: ModCandidateSource, name: string): Promise<Candidate> {
  for await (const candidate of source.candidates(name)) return candidate
  throw new Error(`no candidate for ${name}`)
}

async function createSource(
  modToTest = "my-mod",
  locked?: LockedMods,
  portal?: CandidateSourceOptions["portal"],
): Promise<ModCandidateSource> {
  const installed = await scanModsDir(modsDir)
  return new ModCandidateSource({ modsDir, installed, modToTest, gameVersion: "2.1.20", locked, portal })
}

function release(version: string, factorioVersion = "2.1"): PortalRelease {
  return { version, downloadUrl: `/download/${version}`, sha1: "", factorioVersion, dependencies: ["base"] }
}

/** Portal stub with flib 0.15.0..0.18.0 (oldest first, as the portal lists them). */
function stubPortal() {
  const requested: string[] = []
  const releases: Record<string, PortalRelease[]> = {
    flib: [release("0.15.0"), release("0.16.0"), release("0.17.0"), release("0.18.0")],
  }
  return {
    requested,
    getReleases: async (name: string) => {
      requested.push(name)
      return releases[name]
    },
  }
}

describe("scanModsDir", () => {
  it("lists zips by file name, and directories and symlinks by info.json", async () => {
    const installed = await scanModsDir(modsDir)
    const summary = installed.map(({ name, version, kind }) => `${name} ${version} ${kind}`).sort()
    expect(summary).toEqual([
      "flib 0.16.0 zip",
      "flib 0.17.0 zip",
      "linked 1.0.0 user-managed",
      "my-lib 0.2.0 zip",
      "my-lib 0.3.0 user-managed",
      "my-mod 0.0.1 user-managed",
      "zipped-mod 1.0.0 zip",
      "zipped-mod 1.1.0 zip",
    ])
  })

  it("returns nothing for a missing mods dir", async () => {
    expect(await scanModsDir(path.join(tempDir, "missing"))).toEqual([])
  })
})

describe("ModCandidateSource", () => {
  it.each<[string, string, Partial<Candidate>[]]>([
    [
      "installed zips, highest first",
      "flib",
      [
        { version: "0.17.0", origin: "installed", factorioVersion: "2.1" },
        { version: "0.16.0", origin: "installed", factorioVersion: "2.1" },
      ],
    ],
    [
      "user-managed dir only, over zips",
      "my-lib",
      [{ version: "0.3.0", origin: "user-managed", factorioVersion: "2.1" }],
    ],
    ["symlink is user-managed", "linked", [{ version: "1.0.0", origin: "user-managed", factorioVersion: "2.1" }]],
    ["mod under test", "my-mod", [{ version: "0.0.1", origin: "mut", factorioVersion: "2.1" }]],
    ["builtin at the game version", "base", [{ version: "2.1.20", origin: "builtin", factorioVersion: "2.1" }]],
    ["not installed", "missing", []],
  ])("%s", async (_, name, expected) => {
    expect(await collect(await createSource(), name)).toEqual(expected)
  })

  it.each<[string, LockedMods, string, Partial<Candidate>[]]>([
    [
      "locked version first, even if a newer one is installed",
      { flib: "0.16.0" },
      "flib",
      [
        { version: "0.16.0", origin: "locked", installed: true },
        { version: "0.17.0", origin: "installed", installed: true },
      ],
    ],
    [
      "locked version not installed, without portal",
      { flib: "0.15.0" },
      "flib",
      [
        { version: "0.17.0", origin: "installed", installed: true },
        { version: "0.16.0", origin: "installed", installed: true },
      ],
    ],
    [
      "user-managed ignores the lock",
      { "my-lib": "0.2.0" },
      "my-lib",
      [{ version: "0.3.0", origin: "user-managed", installed: true }],
    ],
  ])("lock: %s", async (_, locked, name, expected) => {
    const result = []
    for await (const { version, origin, installed } of (await createSource("my-mod", locked)).candidates(name)) {
      result.push({ version, origin, installed })
    }
    expect(result).toEqual(expected)
  })

  it("mod under test given by name, as a zip: only the highest version", async () => {
    expect(await collect(await createSource("zipped-mod"), "zipped-mod")).toEqual([
      { version: "1.1.0", origin: "mut", factorioVersion: "2.1" },
    ])
  })

  it("reads dependencies from info.json in the zip", async () => {
    const candidate = await firstCandidate(await createSource(), "flib")
    expect(candidate.dependencies).toEqual([
      { kind: "required", name: "base", constraint: { op: ">=", version: "2.1" } },
      { kind: "optional", name: "other" },
    ])
  })

  it.each<[string, string[]]>([
    ["2.1.20", ["required base", "required elevated-rails", "required recycler", "recommended quality"]],
    ["2.0.77", ["required base", "required elevated-rails", "required quality"]],
  ])("builtin dependencies come from the Factorio %s snapshot", async (gameVersion, expected) => {
    const source = new ModCandidateSource({ modsDir, installed: [], modToTest: "my-mod", gameVersion })
    const candidate = await firstCandidate(source, "space-age")
    expect(candidate.dependencies.map(({ kind, name }) => `${kind} ${name}`)).toEqual(expected)
  })

  it("recycler is not builtin in Factorio 2.0", async () => {
    const source = new ModCandidateSource({ modsDir, installed: [], modToTest: "my-mod", gameVersion: "2.0.77" })
    expect(await collect(source, "recycler")).toEqual([])
  })

  describe("with portal", () => {
    async function collectWithPortal(locked: LockedMods | undefined, name: string) {
      const result = []
      for await (const { version, origin, installed } of (
        await createSource("my-mod", locked, stubPortal())
      ).candidates(name)) {
        result.push(`${version} ${origin} ${installed}`)
      }
      return result
    }

    it.each<[string, LockedMods | undefined, string, string[]]>([
      [
        "installed first, then portal releases not installed, highest first",
        undefined,
        "flib",
        ["0.17.0 installed true", "0.16.0 installed true", "0.18.0 portal false", "0.15.0 portal false"],
      ],
      [
        "locked version not installed comes from the portal",
        { flib: "0.15.0" },
        "flib",
        ["0.15.0 locked false", "0.17.0 installed true", "0.16.0 installed true", "0.18.0 portal false"],
      ],
      ["not on the portal nor installed", undefined, "missing", []],
    ])("%s", async (_, locked, name, expected) => {
      expect(await collectWithPortal(locked, name)).toEqual(expected)
    })

    it("errors if the locked version is not on the portal", async () => {
      await expect(collectWithPortal({ flib: "0.14.0" }, "flib")).rejects.toThrow(
        `"flib" 0.14.0 (locked) is not on the mod portal. If you provide this mod yourself (e.g. a local build), put it in ${modsDir}.`,
      )
    })

    it("queries the portal only after installed candidates", async () => {
      const portal = stubPortal()
      const source = await createSource("my-mod", undefined, portal)
      for await (const candidate of source.candidates("flib")) {
        expect(candidate.version).toBe("0.17.0")
        break
      }
      expect(portal.requested).toEqual([])
    })

    it("describes a missing mod", async () => {
      expect((await createSource("my-mod", undefined, stubPortal())).describeMissing("flb")).toBe(
        'No mod named "flb" on the mod portal',
      )
    })
  })
})

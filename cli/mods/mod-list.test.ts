import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { describe, expect, it } from "vitest"
import { buildModList, checkPinnedInstalled, type ModListEntry, writeModList } from "./mod-list.js"
import type { Candidate, CandidateOrigin } from "./resolve.js"
import type { InstalledMod } from "./source.js"

function candidate(name: string, version: string, origin: CandidateOrigin = "installed"): Candidate {
  return { name, version, origin, factorioVersion: "2.1", dependencies: [], installed: true }
}

function installedMod(name: string, version: string): InstalledMod {
  return { name, version, path: `/mods/${name}_${version}.zip`, kind: "zip" }
}

describe("buildModList", () => {
  it.each<[string, string[]]>([
    ["2.1.20", ["recycler", "elevated-rails", "quality"]],
    ["2.0.77", ["elevated-rails", "quality"]],
  ])("lists every installed and builtin mod of Factorio %s; pins enabled non-builtins", (gameVersion, disabled) => {
    const enabled = new Map(
      [
        candidate("base", gameVersion, "builtin"),
        candidate("space-age", gameVersion, "builtin"),
        candidate("flib", "0.16.0"),
        candidate("my-mod", "1.0.0", "mut"),
      ].map((c) => [c.name, c]),
    )
    const installed = [installedMod("flib", "0.16.0"), installedMod("flib", "0.17.0"), installedMod("unused", "1.0.0")]
    expect(buildModList(enabled, installed, gameVersion)).toEqual([
      { name: "base", enabled: true },
      ...disabled.map((name) => ({ name, enabled: false })),
      { name: "space-age", enabled: true },
      { name: "flib", enabled: true, version: "0.16.0" },
      { name: "unused", enabled: false },
      { name: "my-mod", enabled: true, version: "1.0.0" },
    ])
  })
})

describe("checkPinnedInstalled", () => {
  const installed = [installedMod("flib", "0.16.0")]

  it.each<[string, ModListEntry[], string | undefined]>([
    ["pinned version installed", [{ name: "flib", enabled: true, version: "0.16.0" }], undefined],
    ["unpinned builtin", [{ name: "base", enabled: true }], undefined],
    [
      "pinned version missing",
      [{ name: "flib", enabled: true, version: "0.17.0" }],
      "These mods should be enabled, but are not installed in /mods: flib 0.17.0",
    ],
  ])("%s", (_, entries, error) => {
    const check = () => checkPinnedInstalled(entries, installed, "/mods")
    if (error) expect(check).toThrow(error)
    else expect(check).not.toThrow()
  })
})

describe("writeModList", () => {
  it("writes mod-list.json", async () => {
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "factorio-test-mod-list-"))
    const entries = [{ name: "base", enabled: true }]
    await writeModList(dir, entries)
    expect(JSON.parse(await fsp.readFile(path.join(dir, "mod-list.json"), "utf8"))).toEqual({ mods: entries })
    await fsp.rm(dir, { recursive: true })
  })
})

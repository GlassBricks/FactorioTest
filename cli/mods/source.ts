import * as fsp from "fs/promises"
import * as path from "path"
import { z } from "zod"
import { CliError } from "../cli-error.js"
import { builtinMods, isBuiltinMod } from "./builtin.js"
import { compareVersions, majorMinor, parseDependencies, parseDependency } from "./dependency.js"
import type { LockedMods } from "./lock.js"
import { type ModPortal, type PortalRelease, PortalUnreachableError } from "./portal.js"
import type { Candidate, CandidateOrigin, CandidateSource } from "./resolve.js"
import { readZipInfoJson } from "./zip.js"

export interface InstalledMod {
  name: string
  version: string
  path: string
  /** Directories and symlinks are user-managed (used as-is); zips are managed by the CLI. */
  kind: "zip" | "user-managed"
}

const infoJsonSchema = z.object({
  name: z.string(),
  version: z.string(),
  factorio_version: z.string().default("0.12"),
  dependencies: z.array(z.string()).default(["base"]),
})
type InfoJson = z.output<typeof infoJsonSchema>

const ZIP_NAME = /^(.+)_(\d+\.\d+\.\d+)\.zip$/

async function readInfoJson(modPath: string, kind: InstalledMod["kind"]): Promise<InfoJson> {
  try {
    const raw: unknown =
      kind === "zip"
        ? await readZipInfoJson(modPath)
        : JSON.parse(await fsp.readFile(path.join(modPath, "info.json"), "utf8"))
    return infoJsonSchema.parse(raw)
  } catch (e) {
    throw new CliError(`Could not read info.json of ${modPath}`, { cause: e })
  }
}

async function scanEntry(modsDir: string, fileName: string): Promise<InstalledMod | undefined> {
  const modPath = path.join(modsDir, fileName)
  const stat = await fsp.stat(modPath).catch(() => undefined)
  if (stat?.isFile()) {
    const match = ZIP_NAME.exec(fileName)
    return match ? { name: match[1]!, version: match[2]!, path: modPath, kind: "zip" } : undefined
  }
  if (!stat?.isDirectory()) return undefined
  const info = await readInfoJson(modPath, "user-managed").catch(() => undefined)
  return info && { name: info.name, version: info.version, path: modPath, kind: "user-managed" }
}

/** Lists installed mods: zips by file name, directories and symlinks by their info.json. */
export async function scanModsDir(modsDir: string): Promise<InstalledMod[]> {
  const fileNames = await fsp.readdir(modsDir).catch(() => [])
  const mods = await Promise.all(fileNames.map((fileName) => scanEntry(modsDir, fileName)))
  return mods.filter((mod) => mod !== undefined)
}

export interface CandidateSourceOptions {
  modsDir: string
  installed: InstalledMod[]
  modToTest?: string
  gameVersion: string
  locked?: LockedMods
  /** Without a portal, only installed mods are candidates. */
  portal?: Pick<ModPortal, "getReleases">
  /** Mods to update: candidates come from the portal only. */
  update?: ReadonlySet<string> | "all"
}

function builtinCandidate(name: string, gameVersion: string): Candidate {
  return {
    name,
    version: gameVersion,
    factorioVersion: majorMinor(gameVersion),
    dependencies: builtinMods(gameVersion)[name]!.map((spec) => parseDependency(spec)!),
    origin: "builtin",
    installed: true,
  }
}

async function installedCandidate(mod: InstalledMod, origin: CandidateOrigin): Promise<Candidate> {
  const info = await readInfoJson(mod.path, mod.kind)
  return {
    name: mod.name,
    version: info.version,
    factorioVersion: info.factorio_version,
    dependencies: parseDependencies(info.dependencies, `${mod.name} ${info.version}`),
    origin,
    installed: true,
  }
}

function portalCandidate(name: string, release: PortalRelease, origin: CandidateOrigin): Candidate {
  return {
    name,
    version: release.version,
    factorioVersion: release.factorioVersion,
    dependencies: parseDependencies(release.dependencies, `${name} ${release.version}`),
    origin,
    installed: false,
    release,
  }
}

/** Candidates from builtin mods, the mod under test, the lock, the mods dir and the mod portal. */
export class ModCandidateSource implements CandidateSource {
  private readonly installedByName = new Map<string, InstalledMod[]>()

  constructor(private readonly options: CandidateSourceOptions) {
    for (const mod of options.installed) {
      const list = this.installedByName.get(mod.name) ?? []
      list.push(mod)
      this.installedByName.set(mod.name, list)
    }
    for (const list of this.installedByName.values()) list.sort((a, b) => compareVersions(b.version, a.version))
  }

  async *candidates(name: string): AsyncIterable<Candidate> {
    if (isBuiltinMod(name, this.options.gameVersion)) {
      yield builtinCandidate(name, this.options.gameVersion)
      return
    }
    const installed = this.installedByName.get(name) ?? []
    const isModToTest = name === this.options.modToTest
    const fixed = installed.find((mod) => mod.kind === "user-managed") ?? (isModToTest ? installed[0] : undefined)
    if (fixed) {
      yield await installedCandidate(fixed, isModToTest ? "mut" : "user-managed")
      return
    }
    yield* this.managedCandidates(name, installed)
  }

  /**
   * Locked version, then installed zips, then portal releases; each version once, highest first.
   * Mods being updated skip the first two.
   */
  private async *managedCandidates(name: string, installed: InstalledMod[]): AsyncIterable<Candidate> {
    const seen = new Set<string>()
    if (!this.isUpdating(name)) {
      const lockedVersion = this.options.locked?.[name]
      if (lockedVersion !== undefined) {
        const locked = await this.lockedCandidate(name, lockedVersion, installed)
        if (locked) yield locked
        seen.add(lockedVersion)
      }
      for (const mod of installed) {
        if (seen.has(mod.version)) continue
        seen.add(mod.version)
        yield await installedCandidate(mod, "installed")
      }
    }
    if (!this.options.portal) return
    const releases = (await this.getReleases(name)) ?? []
    const highestFirst = [...releases].sort((a, b) => compareVersions(b.version, a.version))
    for (const release of highestFirst) {
      if (seen.has(release.version)) continue
      const installedMod = installed.find((mod) => mod.version === release.version)
      yield installedMod
        ? await installedCandidate(installedMod, "installed")
        : portalCandidate(name, release, "portal")
    }
  }

  private isUpdating(name: string): boolean {
    const { update } = this.options
    return update === "all" || !!update?.has(name)
  }

  private async lockedCandidate(
    name: string,
    version: string,
    installed: InstalledMod[],
  ): Promise<Candidate | undefined> {
    const installedMod = installed.find((mod) => mod.version === version)
    if (installedMod) return installedCandidate(installedMod, "locked")
    if (!this.options.portal) return undefined
    const release = (await this.getReleases(name))?.find((r) => r.version === version)
    if (!release) {
      throw new CliError(
        `"${name}" ${version} (locked) is not on the mod portal. If you provide this mod yourself (e.g. a local build), put it in ${this.options.modsDir}.`,
      )
    }
    return portalCandidate(name, release, "locked")
  }

  private async getReleases(name: string): Promise<PortalRelease[] | undefined> {
    try {
      return await this.options.portal!.getReleases(name)
    } catch (e) {
      if (!(e instanceof PortalUnreachableError)) throw e
      throw new CliError(
        `${e.message}
It was needed to look up versions of "${name}", as no installed version can be used.
` + `Check your network connection, or put the mod in ${this.options.modsDir} yourself.`,
        { cause: e },
      )
    }
  }

  describeMissing(name: string): string {
    return this.options.portal
      ? `No mod named "${name}" on the mod portal`
      : `Mod "${name}" is not installed in ${this.options.modsDir}`
  }
}

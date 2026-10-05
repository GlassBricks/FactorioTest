import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { CliError } from "../cli-error.js"
import { findExecutableRealPath, getFactorioVersion } from "../factorio-process.js"
import { type Credentials, findCredentials, noCredentialsError, rejectedCredentialsError } from "./credentials.js"
import { type Dependency, majorMinor, parseListedMod, type VersionConstraint } from "./dependency.js"
import { checkFrozenLock, type LockedMods, lockFilePath, planLock, readLock, writeLockIfChanged } from "./lock.js"
import { buildModList, checkPinnedInstalled, writeModList } from "./mod-list.js"
import { createModPortal, CredentialsRejectedError, type ModPortal, PortalUnreachableError } from "./portal.js"
import {
  type Candidate,
  describeCandidate,
  type GameInfo,
  type Requirement,
  type Resolution,
  resolve,
} from "./resolve.js"
import { type InstalledMod, ModCandidateSource, scanModsDir } from "./source.js"

/** factorio-test versions this CLI works with: 3.0.x is for Factorio 2.0, 3.1.x+ for 2.1. */
export function factorioTestConstraints(gameVersion: string): VersionConstraint[] {
  if (majorMinor(gameVersion) === "2.0") {
    return [
      { op: ">=", version: "3.0.2" },
      { op: "<", version: "3.1" },
    ]
  }
  return [{ op: ">=", version: "3.1.1" }]
}

const CLI_SOURCE = "factorio-test-cli"

export interface ModSetupInput {
  modsDir: string
  factorioPath: string
  modPath?: string
  modName?: string
  /** Config `mods` / `--mods` entries. */
  mods?: string[]
  /** Where `mods` came from, for messages: `config mods` or `--mods`. */
  modsSource: string
  /** Directory of the lock file. */
  lockDir: string
  /** Never write the lock; error if it differs. */
  frozen: boolean
  /** `mods update`: mods to update, skipping their locked and installed versions. */
  update?: ReadonlySet<string> | "all"
  portal?: ModPortal
  env?: Record<string, string | undefined>
  homeDir?: string
}

export interface InstalledMods {
  modToTest: string
  game: GameInfo
  resolution: Resolution
  installed: InstalledMod[]
  previousLock?: LockedMods
  plannedLock: LockedMods
}

/** Symlinks `--mod-path` into the mods dir. Only an existing symlink is replaced. */
export async function linkModUnderTest(modsDir: string, modPath: string): Promise<string> {
  modPath = path.resolve(modPath)
  const infoJsonFile = path.join(modPath, "info.json")
  let infoJson: { name: unknown }
  try {
    infoJson = JSON.parse(await fsp.readFile(infoJsonFile, "utf8")) as { name: unknown }
  } catch (e) {
    throw new CliError(`Could not read info.json file from ${modPath}`, { cause: e })
  }
  const modName = infoJson.name
  if (typeof modName !== "string") {
    throw new CliError(`info.json file at ${infoJsonFile} does not contain a string property "name".`)
  }
  const linkPath = path.join(modsDir, modName)
  const stat = await fsp.lstat(linkPath).catch(() => undefined)
  if (stat && !stat.isSymbolicLink()) {
    throw new CliError(`${linkPath} already exists and is not a symlink. Remove it, or use --mod-name ${modName}.`)
  }
  if (stat) await fsp.rm(linkPath)
  await fsp.symlink(modPath, linkPath, "junction")
  return modName
}

/** The mod under test's dependencies follow from choosing it. */
function buildRequirements(
  modToTest: string,
  listed: Dependency[],
  modsSource: string,
  gameVersion: string,
): Requirement[] {
  const factorioTest = factorioTestConstraints(gameVersion).map(
    (constraint): Requirement => ({
      dependency: { kind: "required", name: "factorio-test", constraint },
      from: CLI_SOURCE,
    }),
  )
  return [
    { dependency: { kind: "required", name: "base" }, from: CLI_SOURCE },
    ...factorioTest,
    { dependency: { kind: "required", name: modToTest }, from: "mod under test" },
    ...listed.map((dependency) => ({ dependency, from: modsSource })),
  ]
}

async function readFileIfExists(filePath: string): Promise<string | undefined> {
  return fsp.readFile(filePath, "utf8").catch(() => undefined)
}

async function lookUpCredentials(
  input: ModSetupInput,
  env: Record<string, string | undefined>,
  downloads: Candidate[],
): Promise<Credentials> {
  const lookup = await findCredentials({
    env,
    platform: os.platform(),
    homeDir: input.homeDir ?? os.homedir(),
    executableRealPath: await findExecutableRealPath(input.factorioPath),
    readFile: readFileIfExists,
  })
  if ("found" in lookup) return lookup.found
  throw noCredentialsError(downloads.map(describeCandidate), input.modsDir, lookup.checked, env.CI || undefined)
}

/** Downloads sequentially; any failure is an error. */
async function downloadAll(
  portal: ModPortal,
  downloads: Candidate[],
  credentials: Credentials,
  modsDir: string,
): Promise<void> {
  for (const [index, candidate] of downloads.entries()) {
    console.log(`Downloading ${describeCandidate(candidate)}`)
    try {
      await portal.download(candidate.name, candidate.release!, credentials, modsDir)
    } catch (e) {
      if (e instanceof CredentialsRejectedError) throw rejectedCredentialsError(credentials)
      if (!(e instanceof PortalUnreachableError)) throw e
      const remaining = downloads.slice(index).map((c) => `  ${describeCandidate(c)} (${c.origin})`)
      throw new CliError(
        `Could not reach the Factorio mod portal, needed to download:\n${remaining.join("\n")}\n` +
          `Check your network connection, or put the mod in ${modsDir} yourself.\n(${e.message})`,
        { cause: e },
      )
    }
  }
}

/**
 * `mods install`: resolve, check the lock, download, write the lock, print the mods summary.
 * Does not change which mods are enabled.
 */
export async function installMods(input: ModSetupInput): Promise<InstalledMods> {
  const { modsDir, factorioPath, modPath, modName, mods = [], modsSource, lockDir, frozen, update } = input
  const env = input.env ?? process.env
  const portal = input.portal ?? createModPortal(env)
  const listed = mods.map((spec) => parseListedMod(spec, modsSource))
  await fsp.mkdir(modsDir, { recursive: true })
  const modToTest = modPath ? await linkModUnderTest(modsDir, modPath) : modName!
  const game: GameInfo = { version: await getFactorioVersion(factorioPath), executable: factorioPath }

  const installedBefore = await scanModsDir(modsDir)
  if (!installedBefore.some((mod) => mod.name === modToTest)) {
    throw new CliError(`Mod ${modToTest} not found in ${modsDir}.`)
  }
  const locked = await readLock(lockDir)
  const source = new ModCandidateSource({
    modsDir,
    installed: installedBefore,
    modToTest,
    gameVersion: game.version,
    locked,
    portal,
    update,
  })
  const resolution = await resolve(buildRequirements(modToTest, listed, modsSource, game.version), source, game)
  if (update instanceof Set) checkUpdatedModsUsed(update, resolution)

  const plannedLock = planLock(resolution.enabled.values())
  if (frozen) checkFrozenLock(lockDir, locked, plannedLock)

  const downloads = [...resolution.enabled.values()].filter(({ installed }) => !installed)
  if (downloads.length > 0) {
    const credentials = await lookUpCredentials(input, env, downloads)
    await downloadAll(portal, downloads, credentials, modsDir)
  }

  if (!frozen && (await writeLockIfChanged(lockDir, locked, plannedLock))) {
    console.log(`Updated ${lockFilePath(lockDir)}`)
  }
  console.log(formatModsSummary(resolution.enabled))
  const installed = downloads.length > 0 ? await scanModsDir(modsDir) : installedBefore
  return { modToTest, game, resolution, installed, previousLock: locked, plannedLock }
}

function checkUpdatedModsUsed(names: ReadonlySet<string>, { enabled }: Resolution): void {
  for (const name of names) {
    if (!enabled.has(name)) throw new CliError(`"${name}" is not used by this test run.`)
  }
}

/** Enables exactly the enabled set, pinned to the chosen versions. */
export async function enableMods(modsDir: string, { resolution, installed, game }: InstalledMods): Promise<void> {
  const entries = buildModList(resolution.enabled, installed, game.version)
  checkPinnedInstalled(entries, installed, modsDir)
  await writeModList(modsDir, entries)
}

function describeForSummary(candidate: Candidate): string {
  if (candidate.origin === "builtin") return candidate.name
  if (!candidate.installed) return `${describeCandidate(candidate)} (downloaded)`
  if (candidate.origin === "user-managed") return `${describeCandidate(candidate)} (user-managed)`
  return describeCandidate(candidate)
}

/** Mods summary line, without `base` and the mod under test. */
export function formatModsSummary(enabled: ReadonlyMap<string, Candidate>): string {
  const shown = [...enabled.values()].filter(({ name, origin }) => name !== "base" && origin !== "mut")
  return `Mods: ${shown.map(describeForSummary).join(", ")}`
}

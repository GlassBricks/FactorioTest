import * as fsp from "fs/promises"
import * as path from "path"
import { CliError } from "../cli-error.js"
import { builtinMods } from "./builtin.js"
import type { Candidate } from "./resolve.js"
import type { InstalledMod } from "./source.js"

export interface ModListEntry {
  name: string
  enabled: boolean
  version?: string
}

/**
 * Every installed and builtin mod, enabled iff in the enabled set; enabled non-builtin mods are pinned to
 * their chosen version.
 */
export function buildModList(
  enabled: ReadonlyMap<string, Candidate>,
  installed: readonly InstalledMod[],
  gameVersion: string,
): ModListEntry[] {
  const names = new Set([
    ...Object.keys(builtinMods(gameVersion)),
    ...installed.map((mod) => mod.name),
    ...enabled.keys(),
  ])
  return [...names].map((name) => {
    const candidate = enabled.get(name)
    if (!candidate) return { name, enabled: false }
    if (candidate.origin === "builtin") return { name, enabled: true }
    return { name, enabled: true, version: candidate.version }
  })
}

/** Factorio silently loads another version if a pinned one is missing. */
export function checkPinnedInstalled(
  entries: readonly ModListEntry[],
  installed: readonly InstalledMod[],
  modsDir: string,
): void {
  const missing = entries.filter(
    ({ version, name }) => version && !installed.some((mod) => mod.name === name && mod.version === version),
  )
  if (missing.length === 0) return
  const list = missing.map(({ name, version }) => `${name} ${version}`).join(", ")
  throw new CliError(`These mods should be enabled, but are not installed in ${modsDir}: ${list}`)
}

export async function writeModList(modsDir: string, entries: readonly ModListEntry[]): Promise<void> {
  await fsp.writeFile(path.join(modsDir, "mod-list.json"), JSON.stringify({ mods: entries }, null, 2) + "\n")
}

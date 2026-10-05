import * as fsp from "fs/promises"
import * as path from "path"
import { z } from "zod"
import { CliError } from "../cli-error.js"
import type { Candidate } from "./resolve.js"

export const LOCK_FILE_NAME = "factorio-test.lock.json"

/** Mod name -> locked version. */
export type LockedMods = Record<string, string>

const lockFileSchema = z.object({
  lockVersion: z.literal(1),
  mods: z.record(z.string()),
})

export function lockFilePath(dir: string): string {
  return path.join(dir, LOCK_FILE_NAME)
}

/** Reads the lock file; undefined if it doesn't exist. */
export async function readLock(dir: string): Promise<LockedMods | undefined> {
  const filePath = lockFilePath(dir)
  const content = await fsp.readFile(filePath, "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return undefined
    throw e
  })
  if (content === undefined) return undefined
  try {
    return lockFileSchema.parse(JSON.parse(content)).mods
  } catch (e) {
    throw new CliError(`Invalid lock file ${filePath}. Delete it to recreate it.`, { cause: e })
  }
}

/** Every enabled mod except the mod under test and builtins, sorted by name. */
export function planLock(enabled: Iterable<Candidate>): LockedMods {
  const locked = [...enabled]
    .filter(({ origin }) => origin !== "mut" && origin !== "builtin")
    .map(({ name, version }) => [name, version] as const)
    .sort(([a], [b]) => a.localeCompare(b))
  return Object.fromEntries(locked)
}

/** Lines describing how `planned` differs from `existing`. */
export function diffLock(existing: LockedMods, planned: LockedMods): string[] {
  const names = [...new Set([...Object.keys(existing), ...Object.keys(planned)])].sort()
  return names.flatMap((name) => {
    const before = existing[name]
    const after = planned[name]
    if (before === after) return []
    if (before === undefined) return [`+ ${name} ${after}`]
    if (after === undefined) return [`- ${name}`]
    return [`${name}: ${before} (lock) → ${after} (resolved)`]
  })
}

/** Frozen mode: the planned lock must equal the lock file. */
export function checkFrozenLock(dir: string, existing: LockedMods | undefined, planned: LockedMods): void {
  if (existing === undefined && Object.keys(planned).length > 0) {
    throw new CliError(`No ${LOCK_FILE_NAME} found in ${dir}. Run the tests locally once, then commit the lock file.`)
  }
  const diff = diffLock(existing ?? {}, planned)
  if (diff.length === 0) return
  throw new CliError(
    `${LOCK_FILE_NAME} is out of date:\n${diff.map((line) => `  ${line}`).join("\n")}\n` +
      `Run the tests (or "factorio-test mods install") locally, then commit the lock file.`,
  )
}

/** Writes the lock iff it changed. A missing lock file counts as empty: nothing to lock, no file. */
export async function writeLockIfChanged(
  dir: string,
  existing: LockedMods | undefined,
  planned: LockedMods,
): Promise<boolean> {
  if (diffLock(existing ?? {}, planned).length === 0) return false
  const content = JSON.stringify({ lockVersion: 1, mods: planned }, null, 2) + "\n"
  await fsp.writeFile(lockFilePath(dir), content)
  return true
}

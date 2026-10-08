import * as fsp from "fs/promises"
import * as path from "path"
import { z } from "zod"
import { CliError } from "../cli-error.js"
import type { Candidate } from "./resolve.js"

export const LOCK_FILE_NAME = "factorio-test.lock.json"

export const FACTORIO_TEST = "factorio-test"

/** Mod name -> locked version. */
export type LockedMods = Record<string, string>

const lockFileSchema = z.object({
  lockVersion: z.literal(1),
  mods: z.record(z.string()),
})

export function lockFilePath(dir: string): string {
  return path.join(dir, LOCK_FILE_NAME)
}

/** Reads the lock file; undefined if it doesn't exist or is empty. */
export async function readLock(dir: string): Promise<LockedMods | undefined> {
  const filePath = lockFilePath(dir)
  const content = await fsp.readFile(filePath, "utf8").catch((e: NodeJS.ErrnoException) => {
    if (e.code === "ENOENT") return undefined
    throw e
  })
  if (content === undefined) return undefined
  let mods: LockedMods
  try {
    mods = lockFileSchema.parse(JSON.parse(content)).mods
  } catch (e) {
    throw new CliError(`Invalid lock file ${filePath}. Delete it to recreate it.`, { cause: e })
  }
  return isEmpty(mods) ? undefined : mods
}

function isEmpty(mods: LockedMods): boolean {
  return Object.keys(mods).length === 0
}

function withoutFactorioTest(mods: LockedMods): LockedMods {
  return Object.fromEntries(Object.entries(mods).filter(([name]) => name !== FACTORIO_TEST))
}

/** Every enabled mod except the mod under test, builtins and factorio-test, sorted by name. */
export function planLock(enabled: Iterable<Candidate>): LockedMods {
  const locked = [...enabled]
    .filter(({ name, origin }) => origin !== "mut" && origin !== "builtin" && name !== FACTORIO_TEST)
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

/**
 * Frozen mode: the planned lock must equal the lock file.
 * factorio-test entries (written by older CLI versions) are ignored.
 */
export function checkFrozenLock(dir: string, lockFile: LockedMods | undefined, planned: LockedMods): void {
  const existing = lockFile && withoutFactorioTest(lockFile)
  if ((existing === undefined || isEmpty(existing)) && !isEmpty(planned)) {
    throw new CliError(`No ${LOCK_FILE_NAME} found in ${dir}. Run the tests locally once, then commit the lock file.`)
  }
  const diff = diffLock(existing ?? {}, planned)
  if (diff.length === 0) return
  throw new CliError(
    `${LOCK_FILE_NAME} is out of date:\n${diff.map((line) => `  ${line}`).join("\n")}\n` +
      `Run the tests (or "factorio-test mods install") locally, then commit the lock file.`,
  )
}

export type LockFileChange = "updated" | "removed"

/**
 * Writes the lock iff it changed. Nothing to lock means no file: an existing one is removed.
 */
export async function syncLockFile(
  dir: string,
  existing: LockedMods | undefined,
  planned: LockedMods,
): Promise<LockFileChange | undefined> {
  const filePath = lockFilePath(dir)
  if (isEmpty(planned)) return removeLockFile(filePath)
  if (diffLock(existing ?? {}, planned).length === 0) return undefined
  const content = JSON.stringify({ lockVersion: 1, mods: planned }, null, 2) + "\n"
  await fsp.writeFile(filePath, content)
  return "updated"
}

async function removeLockFile(filePath: string): Promise<"removed" | undefined> {
  try {
    await fsp.rm(filePath)
    return "removed"
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return undefined
    throw e
  }
}

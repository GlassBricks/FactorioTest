import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import {
  checkFrozenLock,
  diffLock,
  LOCK_FILE_NAME,
  type LockedMods,
  type LockFileChange,
  planLock,
  readLock,
  syncLockFile,
} from "./lock.js"
import type { Candidate, CandidateOrigin } from "./resolve.js"

function candidate(name: string, version: string, origin: CandidateOrigin): Candidate {
  return { name, version, origin, factorioVersion: "2.1", dependencies: [], installed: true }
}

describe("planLock", () => {
  it("contains every enabled mod except the mod under test, builtins and factorio-test, sorted", () => {
    const enabled = [
      candidate("base", "2.1.20", "builtin"),
      candidate("my-mod", "1.0.0", "mut"),
      candidate("flib", "0.16.2", "installed"),
      candidate("factorio-test", "3.1.1", "locked"),
      candidate("my-lib", "0.3.0", "user-managed"),
    ]
    expect(planLock(enabled)).toEqual({ flib: "0.16.2", "my-lib": "0.3.0" })
    expect(Object.keys(planLock(enabled))).toEqual(["flib", "my-lib"])
  })
})

describe("diffLock", () => {
  it.each<[LockedMods, LockedMods, string[]]>([
    [{ a: "1.0.0" }, { a: "1.0.0" }, []],
    [
      { flib: "0.16.2", "old-lib": "1.0.0" },
      { flib: "0.17.0", "space-age-extras": "1.0.0" },
      ["flib: 0.16.2 (lock) → 0.17.0 (resolved)", "- old-lib", "+ space-age-extras 1.0.0"],
    ],
  ])("%j -> %j", (existing, planned, expected) => {
    expect(diffLock(existing, planned)).toEqual(expected)
  })
})

describe("checkFrozenLock", () => {
  it("errors without a lock file", () => {
    expect(() => checkFrozenLock("/repo", undefined, { flib: "0.16.2" })).toThrow(
      `No ${LOCK_FILE_NAME} found in /repo. Run the tests locally once, then commit the lock file.`,
    )
  })

  it("errors with the difference", () => {
    expect(() => checkFrozenLock("/repo", { flib: "0.16.2" }, { flib: "0.17.0" })).toThrow(
      `${LOCK_FILE_NAME} is out of date:\n` +
        "  flib: 0.16.2 (lock) → 0.17.0 (resolved)\n" +
        'Run the tests (or "factorio-test mods install") locally, then commit the lock file.',
    )
  })

  it("passes without a lock file when there is nothing to lock", () => {
    expect(() => checkFrozenLock("/repo", undefined, {})).not.toThrow()
  })

  it("passes when equal", () => {
    expect(() => checkFrozenLock("/repo", { flib: "0.16.2" }, { flib: "0.16.2" })).not.toThrow()
  })

  it.each<[LockedMods, LockedMods]>([
    [{ "factorio-test": "3.1.1" }, {}],
    [{ "factorio-test": "3.1.1", flib: "0.16.2" }, { flib: "0.16.2" }],
  ])("ignores factorio-test from older lock files: %j -> %j", (existing, planned) => {
    expect(() => checkFrozenLock("/repo", existing, planned)).not.toThrow()
  })

  it("treats a lock file with only factorio-test as missing", () => {
    expect(() => checkFrozenLock("/repo", { "factorio-test": "3.1.1" }, { flib: "0.16.2" })).toThrow(
      `No ${LOCK_FILE_NAME} found in /repo.`,
    )
  })
})

describe("lock file", () => {
  let dir: string
  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "factorio-test-lock-"))
  })
  afterEach(async () => {
    await fsp.rm(dir, { recursive: true, force: true })
  })

  it("is undefined when missing", async () => {
    expect(await readLock(dir)).toBeUndefined()
  })

  const lockFile = (): string => path.join(dir, LOCK_FILE_NAME)
  const writeLockFile = (mods: LockedMods): Promise<void> =>
    fsp.writeFile(lockFile(), JSON.stringify({ lockVersion: 1, mods }))

  it("is undefined when empty", async () => {
    await writeLockFile({})
    expect(await readLock(dir)).toBeUndefined()
  })

  it("round trips, written only if changed", async () => {
    const mods = { flib: "0.16.2" }
    expect(await syncLockFile(dir, undefined, mods)).toBe("updated")
    expect(JSON.parse(await fsp.readFile(lockFile(), "utf8"))).toEqual({ lockVersion: 1, mods })
    expect(await readLock(dir)).toEqual(mods)
    expect(await syncLockFile(dir, mods, { ...mods })).toBeUndefined()
    expect(await syncLockFile(dir, mods, { flib: "0.17.0" })).toBe("updated")
    expect(await readLock(dir)).toEqual({ flib: "0.17.0" })
  })

  it("rewrites a lock file with factorio-test from an older CLI version", async () => {
    const existing = { "factorio-test": "3.1.1", flib: "0.16.2" }
    await writeLockFile(existing)
    expect(await syncLockFile(dir, existing, { flib: "0.16.2" })).toBe("updated")
    expect(await readLock(dir)).toEqual({ flib: "0.16.2" })
  })

  it.each<[string, LockedMods | undefined, LockFileChange | undefined]>([
    ["no file", undefined, undefined],
    ["a lock with dependencies", { flib: "0.16.2" }, "removed"],
    ["a lock with only factorio-test", { "factorio-test": "3.1.1" }, "removed"],
    ["an empty lock", {}, "removed"],
  ])("with nothing to lock, %s: no file afterwards", async (_, existing, expected) => {
    if (existing) await writeLockFile(existing)
    expect(await syncLockFile(dir, await readLock(dir), {})).toBe(expected)
    await expect(fsp.stat(lockFile())).rejects.toThrow()
  })

  it("rejects an invalid lock file", async () => {
    await fsp.writeFile(path.join(dir, LOCK_FILE_NAME), '{"mods": {}}')
    await expect(readLock(dir)).rejects.toThrow("Invalid lock file")
  })
})

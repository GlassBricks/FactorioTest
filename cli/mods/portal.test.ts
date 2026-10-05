import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { CredentialsRejectedError, ModPortal, PortalUnreachableError } from "./portal.js"
import { FAKE_TOKEN, FAKE_USERNAME, FakePortal } from "./test-helpers.js"
import { readZipInfoJson } from "./zip.js"

const credentials = { username: FAKE_USERNAME, token: FAKE_TOKEN }

let fake: FakePortal
let portal: ModPortal
let modsDir: string

beforeEach(async () => {
  fake = await new FakePortal().start()
  await fake.addRelease({ name: "flib", version: "0.16.0", dependencies: ["base >= 2.1"] })
  await fake.addRelease({ name: "flib", version: "0.17.0" })
  await fake.addRelease({ name: "bad-sha", version: "1.0.0" }, { sha1: "0".repeat(40) })
  portal = new ModPortal({ baseUrl: fake.url, retryDelaysMs: [0, 0] })
  modsDir = await fsp.mkdtemp(path.join(os.tmpdir(), "factorio-test-portal-"))
})

afterEach(async () => {
  await fake.stop()
  await fsp.rm(modsDir, { recursive: true, force: true })
})

async function releaseOf(name: string, version: string) {
  return (await portal.getReleases(name))!.find((r) => r.version === version)!
}

describe("getReleases", () => {
  it("lists releases with factorio version and dependencies", async () => {
    expect(await portal.getReleases("flib")).toEqual([
      expect.objectContaining({ version: "0.16.0", factorioVersion: "2.1", dependencies: ["base >= 2.1"] }),
      expect.objectContaining({ version: "0.17.0", factorioVersion: "2.1", dependencies: [] }),
    ])
  })

  it("is undefined for an unknown mod", async () => {
    expect(await portal.getReleases("flb")).toBeUndefined()
  })

  it("is cached per run", async () => {
    await portal.getReleases("flib")
    await portal.getReleases("flib")
    expect(fake.requests).toEqual(["/api/mods/flib/full"])
  })

  it.each([[[503]], [[429, 500]]])("retries transient failures %j", async (failures) => {
    fake.failures.push(...failures)
    expect(await portal.getReleases("flib")).toHaveLength(2)
  })

  it("gives up after the retries", async () => {
    fake.failures.push(503, 503, 503)
    await expect(portal.getReleases("flib")).rejects.toThrow(PortalUnreachableError)
  })

  it("reports an unreachable portal", async () => {
    const unreachable = new ModPortal({ baseUrl: "http://127.0.0.1:1", retryDelaysMs: [] })
    await expect(unreachable.getReleases("flib")).rejects.toThrow("Could not reach the Factorio mod portal")
  })
})

describe("download", () => {
  it("downloads the zip into the mods dir, following redirects", async () => {
    await portal.download("flib", await releaseOf("flib", "0.17.0"), credentials, modsDir)
    expect(await fsp.readdir(modsDir)).toEqual(["flib_0.17.0.zip"])
    expect(await readZipInfoJson(path.join(modsDir, "flib_0.17.0.zip"))).toMatchObject({ version: "0.17.0" })
  })

  it.each([
    ["403 for a wrong token", { ...credentials, token: "wrong" }],
    ["redirect to the login page without credentials", { username: "", token: "" }],
  ])("treats %s as rejected credentials", async (_, badCredentials) => {
    const release = await releaseOf("flib", "0.17.0")
    await expect(portal.download("flib", release, badCredentials, modsDir)).rejects.toThrow(CredentialsRejectedError)
    expect(await fsp.readdir(modsDir)).toEqual([])
  })

  it("rejects a checksum mismatch, leaving no file", async () => {
    await expect(portal.download("bad-sha", await releaseOf("bad-sha", "1.0.0"), credentials, modsDir)).rejects.toThrow(
      "does not match the mod portal's checksum",
    )
    expect(await fsp.readdir(modsDir)).toEqual([])
  })

  it("retries a transient download failure", async () => {
    const release = await releaseOf("flib", "0.17.0")
    fake.failures.push(502)
    await portal.download("flib", release, credentials, modsDir)
    expect(await fsp.readdir(modsDir)).toEqual(["flib_0.17.0.zip"])
  })

  it("never puts the token in error messages", async () => {
    const release = await releaseOf("flib", "0.17.0")
    fake.failures.push(503, 503, 503)
    const error = await portal.download("flib", release, credentials, modsDir).catch((e: Error) => e)
    expect(String(error)).not.toContain(FAKE_TOKEN)
  })
})

import { describe, expect, it } from "vitest"
import {
  type CredentialsInput,
  findCredentials,
  noCredentialsError,
  playerDataDirs,
  rejectedCredentialsError,
} from "./credentials.js"

const loggedIn = JSON.stringify({ "service-username": "u", "service-token": "secret" })
const loggedOut = JSON.stringify({ "service-username": "", "last-played": {} })

function input(files: Record<string, string>, overrides: Partial<CredentialsInput> = {}): CredentialsInput {
  return {
    env: {},
    platform: "linux",
    homeDir: "/home/u",
    executableRealPath: "/home/u/factorio/bin/x64/factorio",
    readFile: async (filePath) => files[filePath],
    ...overrides,
  }
}

describe("playerDataDirs", () => {
  it.each<[string, Partial<CredentialsInput>, string[]]>([
    ["linux", {}, ["/home/u/factorio", "/home/u/.factorio", "/home/u/.var/app/com.valvesoftware.Steam/.factorio"]],
    ["darwin", { platform: "darwin", executableRealPath: undefined }, ["/home/u/Library/Application Support/factorio"]],
    [
      "win32",
      {
        platform: "win32",
        env: { APPDATA: "C:\\Users\\u\\AppData\\Roaming" },
        executableRealPath: "C:\\Games\\Factorio\\bin\\x64\\factorio.exe",
      },
      ["C:\\Games\\Factorio", "C:\\Users\\u\\AppData\\Roaming\\Factorio"],
    ],
  ])("%s", (_, overrides, expected) => {
    expect(playerDataDirs(input({}, overrides))).toEqual(expected)
  })
})

describe("findCredentials", () => {
  it.each<[string, Record<string, string>, Record<string, string>, unknown]>([
    [
      "env vars first",
      { FACTORIO_USERNAME: "e", FACTORIO_TOKEN: "t" },
      { "/home/u/.factorio/player-data.json": loggedIn },
      { found: { username: "e", token: "t", source: { kind: "env" } } },
    ],
    [
      "empty env vars count as unset",
      { FACTORIO_USERNAME: "", FACTORIO_TOKEN: "" },
      { "/home/u/.factorio/player-data.json": loggedIn },
      { found: { username: "u", token: "secret", source: { kind: "player-data", dir: "/home/u/.factorio" } } },
    ],
    [
      "next to the executable first",
      {},
      { "/home/u/factorio/player-data.json": loggedIn, "/home/u/.factorio/player-data.json": loggedOut },
      { found: { username: "u", token: "secret", source: { kind: "player-data", dir: "/home/u/factorio" } } },
    ],
    [
      "nothing found",
      {},
      {
        "/home/u/factorio/player-data.json": loggedOut,
        "/home/u/.var/app/com.valvesoftware.Steam/.factorio/player-data.json": "{",
      },
      {
        checked: [
          { dir: "/home/u/factorio", status: "not logged in" },
          { dir: "/home/u/.factorio", status: "not found" },
          { dir: "/home/u/.var/app/com.valvesoftware.Steam/.factorio", status: "unreadable" },
        ],
      },
    ],
  ])("%s", async (_, env, files, expected) => {
    expect(await findCredentials(input(files, { env }))).toEqual(expected)
  })

  it.each([
    [{ FACTORIO_USERNAME: "u" }, "FACTORIO_USERNAME is set, but FACTORIO_TOKEN is not. Set both, or neither."],
    [{ FACTORIO_TOKEN: "t", FACTORIO_USERNAME: "" }, "FACTORIO_TOKEN is set, but FACTORIO_USERNAME is not."],
  ])("errors if only one env var is set: %j", async (env, message) => {
    await expect(findCredentials(input({}, { env }))).rejects.toThrow(message)
  })
})

describe("noCredentialsError", () => {
  const notLoggedIn = [
    { dir: "/home/u/factorio", status: "not logged in" as const },
    { dir: "/home/u/.factorio", status: "not found" as const },
  ]

  it("lists downloads, what was checked and fixes", () => {
    expect(noCredentialsError(["factorio-test 3.1.1", "flib 0.16.2"], "/data/mods", notLoggedIn, undefined).message)
      .toBe(`These mods need to be downloaded from the Factorio mod portal:
  factorio-test 3.1.1, flib 0.16.2
Downloading requires a Factorio account, but no credentials were found.
Checked: environment variables FACTORIO_USERNAME / FACTORIO_TOKEN (not set),
  player-data.json in /home/u/factorio (not logged in), /home/u/.factorio (not found)

To fix this, do one of the following:
  - Log in to your Factorio account in the game once. The CLI then finds the credentials
    automatically.
  - Set the environment variables FACTORIO_USERNAME and FACTORIO_TOKEN. Your token is shown on
    https://factorio.com/profile.
  - Download or install the mods yourself and put them in /data/mods.`)
  })

  it("suggests logging in only if a player-data.json was found", () => {
    const message = noCredentialsError(["a 1.0.0"], "/m", [{ dir: "/d", status: "not found" }], undefined).message
    expect(message).not.toContain("Log in")
  })

  it("gives CI fixes in CI", () => {
    const message = noCredentialsError(["a 1.0.0"], "/m", notLoggedIn, "true").message
    expect(message).toContain("CI detected (CI=true). To fix this, do one of the following:")
    expect(message).toContain("Note: secrets may be unavailable in some runs (e.g. pull requests from forks).")
    expect(message).not.toContain("Log in")
  })
})

describe("rejectedCredentialsError", () => {
  it.each([
    [
      { kind: "env" as const },
      "(from environment variables FACTORIO_USERNAME / FACTORIO_TOKEN)",
      "update FACTORIO_TOKEN",
    ],
    [
      { kind: "player-data" as const, dir: "/home/u/.factorio" },
      "(from player-data.json in /home/u/.factorio)",
      "log in to the game again",
    ],
  ])("names the source %j", (source, from, fix) => {
    const message = rejectedCredentialsError({ username: "u", token: "secret", source }).message
    expect(message).toContain('rejected the credentials for user "u"')
    expect(message).toContain(from)
    expect(message).toContain(fix)
    expect(message).toContain("mod portal API keys don't work for downloads")
    expect(message).not.toContain("secret")
  })
})

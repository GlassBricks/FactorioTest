import * as path from "path"
import { CliError } from "../cli-error.js"
import { cliVersion } from "../version.js"
import type { PortalCredentials } from "./portal.js"

export const CI_DOCS_URL = `https://github.com/GlassBricks/FactorioTest/blob/cli-v${cliVersion}/docs/CI.md`
const PROFILE_URL = "https://factorio.com/profile"

export type CredentialsSource = { kind: "env" } | { kind: "player-data"; dir: string }

export interface Credentials extends PortalCredentials {
  source: CredentialsSource
}

export type PlayerDataStatus = "not found" | "not logged in" | "unreadable"

export interface CheckedPlayerData {
  dir: string
  status: PlayerDataStatus
}

export type CredentialsLookup = { found: Credentials } | { checked: CheckedPlayerData[] }

export interface CredentialsInput {
  env: Record<string, string | undefined>
  platform: NodeJS.Platform
  homeDir: string
  /** Factorio executable, resolved to a real path (symlinks followed); undefined if not found. */
  executableRealPath?: string
  /** File contents, or undefined if it doesn't exist. */
  readFile(filePath: string): Promise<string | undefined>
}

/** Directories that may contain player-data.json, in order. */
export function playerDataDirs({ platform, homeDir, env, executableRealPath }: CredentialsInput): string[] {
  const pathApi = platform === "win32" ? path.win32 : path.posix
  const dirs: string[] = []
  if (executableRealPath) dirs.push(pathApi.resolve(pathApi.dirname(executableRealPath), "../.."))
  if (platform === "win32") {
    if (env.APPDATA) dirs.push(pathApi.join(env.APPDATA, "Factorio"))
  } else if (platform === "darwin") {
    dirs.push(pathApi.join(homeDir, "Library", "Application Support", "factorio"))
  } else {
    dirs.push(pathApi.join(homeDir, ".factorio"))
    dirs.push(pathApi.join(homeDir, ".var", "app", "com.valvesoftware.Steam", ".factorio"))
  }
  return [...new Set(dirs)]
}

function nonEmpty(value: string | undefined): string | undefined {
  return value === "" ? undefined : value
}

async function readPlayerData(input: CredentialsInput, dir: string): Promise<PortalCredentials | PlayerDataStatus> {
  const pathApi = input.platform === "win32" ? path.win32 : path.posix
  const content = await input.readFile(pathApi.join(dir, "player-data.json"))
  if (content === undefined) return "not found"
  let data: Record<string, unknown>
  try {
    data = JSON.parse(content) as Record<string, unknown>
  } catch {
    return "unreadable"
  }
  const username = data["service-username"]
  const token = data["service-token"]
  if (typeof username !== "string" || typeof token !== "string" || !username || !token) {
    return "not logged in"
  }
  return { username, token }
}

/** Credentials from env vars, else player-data.json. */
export async function findCredentials(input: CredentialsInput): Promise<CredentialsLookup> {
  const username = nonEmpty(input.env.FACTORIO_USERNAME)
  const token = nonEmpty(input.env.FACTORIO_TOKEN)
  if (username && token) return { found: { username, token, source: { kind: "env" } } }
  if (username || token) {
    const [set, unset] = username ? ["FACTORIO_USERNAME", "FACTORIO_TOKEN"] : ["FACTORIO_TOKEN", "FACTORIO_USERNAME"]
    throw new CliError(`${set} is set, but ${unset} is not. Set both, or neither.`)
  }

  const checked: CheckedPlayerData[] = []
  for (const dir of playerDataDirs(input)) {
    const result = await readPlayerData(input, dir)
    if (typeof result === "string") checked.push({ dir, status: result })
    else return { found: { ...result, source: { kind: "player-data", dir } } }
  }
  return { checked }
}

export function noCredentialsError(
  downloads: string[],
  modsDir: string,
  checked: CheckedPlayerData[],
  ci: string | undefined,
): CliError {
  const checkedDirs = checked.map(({ dir, status }) => `${dir} (${status})`).join(", ")
  const lines = [
    "These mods need to be downloaded from the Factorio mod portal:",
    `  ${downloads.join(", ")}`,
    "Downloading requires a Factorio account, but no credentials were found.",
    "Checked: environment variables FACTORIO_USERNAME / FACTORIO_TOKEN (not set),",
    `  player-data.json in ${checkedDirs}`,
    "",
  ]
  if (ci) {
    lines.push(
      `CI detected (CI=${ci}). To fix this, do one of the following:`,
      "  - Store FACTORIO_USERNAME and FACTORIO_TOKEN as secrets in your CI and pass them to this step",
      `    as environment variables. Your token is shown on ${PROFILE_URL}.`,
      `  - Provide the mods in ${modsDir} in an earlier step.`,
      "Note: secrets may be unavailable in some runs (e.g. pull requests from forks).",
      `See ${CI_DOCS_URL}.`,
    )
    return new CliError(lines.join("\n"))
  }
  lines.push("To fix this, do one of the following:")
  if (checked.some(({ status }) => status === "not logged in")) {
    lines.push(
      "  - Log in to your Factorio account in the game once. The CLI then finds the credentials",
      "    automatically.",
    )
  }
  lines.push(
    "  - Set the environment variables FACTORIO_USERNAME and FACTORIO_TOKEN. Your token is shown on",
    `    ${PROFILE_URL}.`,
    `  - Download or install the mods yourself and put them in ${modsDir}.`,
  )
  return new CliError(lines.join("\n"))
}

export function rejectedCredentialsError({ username, source }: Credentials): CliError {
  const [from, fix] =
    source.kind === "env"
      ? [
          "environment variables FACTORIO_USERNAME / FACTORIO_TOKEN",
          `To fix this, update FACTORIO_TOKEN from ${PROFILE_URL}.`,
        ]
      : [
          `player-data.json in ${source.dir}`,
          "To fix this, log in to the game again, or set FACTORIO_USERNAME and\n" +
            `FACTORIO_TOKEN (see ${PROFILE_URL}).`,
        ]
  return new CliError(
    `The Factorio mod portal rejected the credentials for user "${username}"\n(from ${from}).\n` +
      `The token may be outdated. ${fix}\n` +
      "Note: mod portal API keys don't work for downloads; use the account token.",
  )
}

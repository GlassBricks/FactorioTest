import { createHash } from "crypto"
import * as fs from "fs"
import * as fsp from "fs/promises"
import * as path from "path"
import { Readable } from "stream"
import { pipeline } from "stream/promises"
import type { ReadableStream } from "stream/web"
import { setTimeout as delay } from "timers/promises"
import { z } from "zod"
import { CliError } from "../cli-error.js"

export const DEFAULT_PORTAL_URL = "https://mods.factorio.com"

export interface PortalRelease {
  version: string
  downloadUrl: string
  sha1: string
  factorioVersion: string
  dependencies: string[]
}

export interface PortalCredentials {
  username: string
  token: string
}

const releasesSchema = z.object({
  releases: z.array(
    z.object({
      version: z.string(),
      download_url: z.string(),
      sha1: z.string(),
      info_json: z.object({
        factorio_version: z.string(),
        dependencies: z.array(z.string()).default(["base"]),
      }),
    }),
  ),
})

/** The portal could not be reached (network error, or still failing after retries). */
export class PortalUnreachableError extends CliError {}

/** The portal answered a download with 403, or redirected it to its login page. */
export class CredentialsRejectedError extends CliError {}

export interface ModPortalOptions {
  baseUrl?: string
  /** Delays before each retry of a transient failure. */
  retryDelaysMs?: number[]
}

const MAX_REDIRECTS = 5

function isTransient(status: number): boolean {
  return status === 429 || status >= 500
}

function describeFailure(failure: unknown): string {
  if (!(failure instanceof Error)) return String(failure)
  return failure.cause instanceof Error ? `${failure.message} (${failure.cause.message})` : failure.message
}

/** The real portal, unless overridden by FACTORIO_TEST_MOD_PORTAL_URL (for tests). */
export function createModPortal(env: Record<string, string | undefined> = process.env): ModPortal {
  return new ModPortal({ baseUrl: env.FACTORIO_TEST_MOD_PORTAL_URL || undefined })
}

export class ModPortal {
  readonly baseUrl: string
  private readonly retryDelaysMs: number[]
  private readonly releasesCache = new Map<string, Promise<PortalRelease[] | undefined>>()

  constructor({ baseUrl = DEFAULT_PORTAL_URL, retryDelaysMs = [1000, 3000, 10000] }: ModPortalOptions = {}) {
    this.baseUrl = baseUrl
    this.retryDelaysMs = retryDelaysMs
  }

  /** Releases, oldest first; undefined if there is no such mod. */
  getReleases(name: string): Promise<PortalRelease[] | undefined> {
    let releases = this.releasesCache.get(name)
    if (!releases) {
      releases = this.fetchReleases(name)
      this.releasesCache.set(name, releases)
    }
    return releases
  }

  private async fetchReleases(name: string): Promise<PortalRelease[] | undefined> {
    const response = await this.fetchWithRetry(new URL(`/api/mods/${encodeURIComponent(name)}/full`, this.baseUrl))
    if (response.status === 404) return undefined
    if (!response.ok) throw new CliError(`The mod portal returned ${response.status} for mod "${name}".`)
    const { releases } = releasesSchema.parse(await response.json())
    return releases.map((release) => ({
      version: release.version,
      downloadUrl: release.download_url,
      sha1: release.sha1,
      factorioVersion: release.info_json.factorio_version,
      dependencies: release.info_json.dependencies,
    }))
  }

  /** Downloads `<name>_<version>.zip` into the mods dir, verified against the portal's sha1. */
  async download(name: string, release: PortalRelease, credentials: PortalCredentials, modsDir: string): Promise<void> {
    const fileName = `${name}_${release.version}.zip`
    const tempPath = path.join(modsDir, `${fileName}.tmp`)
    try {
      const response = await this.fetchDownload(release, credentials)
      const sha1 = await writeHashed(response.body as ReadableStream<Uint8Array>, tempPath)
      if (sha1 !== release.sha1) {
        throw new CliError(`Downloaded ${fileName} does not match the mod portal's checksum. Try again.`)
      }
      await fsp.rename(tempPath, path.join(modsDir, fileName))
    } finally {
      await fsp.rm(tempPath, { force: true })
    }
  }

  private async fetchDownload(release: PortalRelease, { username, token }: PortalCredentials): Promise<Response> {
    let url = new URL(release.downloadUrl, this.baseUrl)
    url.searchParams.set("username", username)
    url.searchParams.set("token", token)
    for (let i = 0; i <= MAX_REDIRECTS; i++) {
      const response = await this.fetchWithRetry(url)
      const location = response.headers.get("location")
      if (response.status >= 300 && response.status < 400 && location) {
        url = new URL(location, url)
        if (url.pathname.startsWith("/login"))
          throw new CredentialsRejectedError("The mod portal rejected the credentials.")
        continue
      }
      if (response.status === 401 || response.status === 403) {
        throw new CredentialsRejectedError("The mod portal rejected the credentials.")
      }
      if (!response.ok || !response.body) {
        throw new CliError(`The mod portal returned ${response.status} for ${release.downloadUrl}.`)
      }
      return response
    }
    throw new CliError(`Too many redirects downloading ${release.downloadUrl}.`)
  }

  /** Retries network errors, 429 and 5xx with backoff. Never includes the URL (it may contain a token) in errors. */
  private async fetchWithRetry(url: URL): Promise<Response> {
    let lastFailure: unknown
    for (let attempt = 0; attempt <= this.retryDelaysMs.length; attempt++) {
      if (attempt > 0) await delay(this.retryDelaysMs[attempt - 1])
      try {
        const response = await fetch(url, { redirect: "manual" })
        if (!isTransient(response.status)) return response
        lastFailure = `HTTP ${response.status}`
        await response.body?.cancel()
      } catch (e) {
        lastFailure = e
      }
    }
    throw new PortalUnreachableError(`Could not reach the Factorio mod portal: ${describeFailure(lastFailure)}`)
  }
}

async function writeHashed(body: ReadableStream<Uint8Array>, filePath: string): Promise<string> {
  const hash = createHash("sha1")
  await pipeline(
    Readable.fromWeb(body),
    async function* (source: AsyncIterable<Buffer>) {
      for await (const chunk of source) {
        hash.update(chunk)
        yield chunk
      }
    },
    fs.createWriteStream(filePath),
  )
  return hash.digest("hex")
}

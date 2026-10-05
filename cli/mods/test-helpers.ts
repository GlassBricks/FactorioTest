import { createHash } from "crypto"
import * as fsp from "fs/promises"
import * as http from "http"
import type { AddressInfo } from "net"
import * as path from "path"
import { buffer } from "stream/consumers"
import * as yazl from "yazl"

export interface TestModInfo {
  name: string
  version: string
  factorio_version?: string
  dependencies?: string[]
}

function infoJson(info: TestModInfo): Record<string, unknown> {
  return { factorio_version: "2.1", dependencies: [], title: info.name, author: "test", ...info }
}

/** A mod zip, as downloaded from the mod portal: `<name>_<version>/info.json`, plus `files`. */
export function buildModZip(info: TestModInfo, files: Record<string, string> = {}): Promise<Buffer> {
  const folder = `${info.name}_${info.version}`
  const zip = new yazl.ZipFile()
  zip.addBuffer(Buffer.from(JSON.stringify(infoJson(info))), `${folder}/info.json`)
  for (const [file, content] of Object.entries(files)) zip.addBuffer(Buffer.from(content), `${folder}/${file}`)
  zip.end()
  return buffer(zip.outputStream)
}

/** Writes `<name>_<version>.zip` into the mods dir. */
export async function writeModZip(
  modsDir: string,
  info: TestModInfo,
  files: Record<string, string> = {},
): Promise<string> {
  const zipPath = path.join(modsDir, `${info.name}_${info.version}.zip`)
  await fsp.mkdir(modsDir, { recursive: true })
  await fsp.writeFile(zipPath, await buildModZip(info, files))
  return zipPath
}

/** Writes a mod directory (user-managed). */
export async function writeModDir(dir: string, info: TestModInfo): Promise<string> {
  await fsp.mkdir(dir, { recursive: true })
  await fsp.writeFile(path.join(dir, "info.json"), JSON.stringify(infoJson(info)))
  return dir
}

export const FAKE_USERNAME = "test-user"
export const FAKE_TOKEN = "test-token"

interface FakeRelease {
  info: Required<TestModInfo>
  zip: Buffer
  /** sha1 the portal reports; defaults to the real one. */
  sha1?: string
}

/**
 * Local stand-in for the mod portal API: `/api/mods/<name>/full`, and downloads that answer 403 to invalid credentials,
 * redirect to the login page without credentials, or redirect to a file host otherwise.
 */
export class FakePortal {
  readonly requests: string[] = []
  /** Statuses to answer the next requests with, before serving normally. */
  readonly failures: number[] = []
  private readonly releases = new Map<string, FakeRelease[]>()
  private server?: http.Server

  get url(): string {
    return `http://127.0.0.1:${(this.server!.address() as AddressInfo).port}`
  }

  async addRelease(info: TestModInfo, options: { sha1?: string } = {}): Promise<void> {
    const full = infoJson(info) as unknown as Required<TestModInfo>
    const list = this.releases.get(info.name) ?? []
    list.push({ info: full, zip: await buildModZip(info), ...options })
    this.releases.set(info.name, list)
  }

  async start(): Promise<this> {
    this.server = http.createServer((req, res) => this.handle(req, res))
    await new Promise<void>((resolve) => this.server!.listen(0, "127.0.0.1", resolve))
    return this
  }

  async stop(): Promise<void> {
    await new Promise((resolve) => this.server?.close(resolve))
  }

  private handle(req: http.IncomingMessage, res: http.ServerResponse): void {
    const url = new URL(req.url!, this.url)
    this.requests.push(url.pathname)
    const failure = this.failures.shift()
    if (failure) return void res.writeHead(failure).end()

    const [route, ...rest] = url.pathname.split("/").slice(1).map(decodeURIComponent)
    if (route === "api") return this.serveReleases(res, rest[1]!) // /api/mods/<name>/full
    if (route === "download") return this.redirectDownload(res, url, rest[0]!, rest[1]!)
    if (route === "files") return this.serveFile(res, rest[0]!, rest[1]!)
    res.writeHead(404).end()
  }

  private serveReleases(res: http.ServerResponse, name: string): void {
    const releases = this.releases.get(name)
    if (!releases) return void res.writeHead(404).end(JSON.stringify({ message: "Mod not found" }))
    const body = {
      name,
      releases: releases.map(({ info, zip, sha1 }) => ({
        version: info.version,
        download_url: `/download/${encodeURIComponent(name)}/${info.version}`,
        sha1: sha1 ?? createHash("sha1").update(zip).digest("hex"),
        info_json: { factorio_version: info.factorio_version, dependencies: info.dependencies },
      })),
    }
    res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(body))
  }

  private redirectDownload(res: http.ServerResponse, url: URL, name: string, version: string): void {
    if (!url.searchParams.get("username")) {
      return void res.writeHead(302, { location: `/login?next=${encodeURIComponent(url.pathname)}` }).end()
    }
    const authorized =
      url.searchParams.get("username") === FAKE_USERNAME && url.searchParams.get("token") === FAKE_TOKEN
    if (!authorized) return void res.writeHead(403).end()
    res.writeHead(302, { location: `/files/${name}/${version}` }).end()
  }

  private serveFile(res: http.ServerResponse, name: string, version: string): void {
    const release = this.releases.get(name)?.find(({ info }) => info.version === version)
    if (!release) return void res.writeHead(404).end()
    res.writeHead(200, { "content-type": "application/zip" }).end(release.zip)
  }
}

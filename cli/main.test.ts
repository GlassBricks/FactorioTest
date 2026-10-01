import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { main } from "./main.js"

describe("main", () => {
  let tempDir: string
  let stderr: string[]

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "factorio-test-main-"))
    stderr = []
    vi.spyOn(console, "error").mockImplementation((...args: unknown[]) => void stderr.push(args.join(" ")))
  })

  afterEach(() => {
    vi.restoreAllMocks()
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  function run(...args: string[]): Promise<number> {
    return main(["node", "factorio-test", "run", "--data-directory", path.join(tempDir, "data"), ...args])
  }

  function writeConfig(config: object): string {
    const configPath = path.join(tempDir, "config.json")
    fs.writeFileSync(configPath, JSON.stringify(config))
    return configPath
  }

  it.each([
    [
      "--no-auto-start without --graphics",
      ["--mod-path", "mod", "--no-auto-start"],
      "--no-auto-start requires --graphics",
    ],
    ["neither --mod-path nor --mod-name", [], "One of --mod-path or --mod-name must be specified"],
    ["both --mod-path and --mod-name", ["--mod-path", "a", "--mod-name", "b"], "Only one of --mod-path or --mod-name"],
  ])("reports %s as an error", async (_, args, message) => {
    expect(await run(...args)).toBe(1)
    expect(stderr.join("\n")).toContain(message)
  })

  it.each([
    ["top-level", { invalidKey: true }, "invalidKey"],
    ["test", { test: { invalidTestKey: true } }, "invalidTestKey"],
  ])("reports invalid %s config keys without a stack trace", async (_, config, key) => {
    expect(await run("--mod-path", "mod", "--config", writeConfig(config))).toBe(1)
    const output = stderr.join("\n")
    expect(output).toContain(key)
    expect(output).not.toContain("CliError")
  })
})

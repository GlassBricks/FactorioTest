import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { Command, type CommandUnknownOpts } from "@commander-js/extra-typings"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { main } from "./main.js"
import { registerModsCommand } from "./mods-command.js"
import { registerRunCommand } from "./run.js"

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
    ["no target", [], "One of --mod-path, --mod-name, --scenario-path or --scenario must be specified"],
    [
      "both --mod-path and --mod-name",
      ["--mod-path", "a", "--mod-name", "b"],
      "Specify one of --mod-path, --mod-name, --scenario-path or --scenario",
    ],
    ["--step without --graphics", ["--mod-path", "mod", "--step"], "Step mode requires --graphics"],
    [
      "config file step without --graphics",
      () => ["--mod-path", "mod", "--config", writeConfig({ step: true })],
      "Step mode requires --graphics",
    ],
    ["invalid numeric option", ["--mod-path", "mod", "--udp-port", "abc"], "--udp-port"],
  ])("reports %s as an error", async (_, args, message) => {
    expect(await run(...(typeof args === "function" ? args() : args))).toBe(1)
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

describe("help", () => {
  const targetFlags = ["--mod-path", "--mod-name", "--scenario-path", "--scenario"]

  /** Long flag and description of each option, in help order. */
  function helpOptions(...commandPath: string[]): [flag: string, description: string][] {
    const program = new Command()
    registerRunCommand(program, () => {})
    registerModsCommand(program)
    const command = commandPath.reduce<CommandUnknownOpts>(
      (parent, name) => parent.commands.find((child) => child.name() === name)!,
      program,
    )
    const optionLine = /^ {2}(?:-\w,? )?(--[\w-]+)(?: <[^>]+>| \[[^\]]+\])? +(\S.*)$/gm
    return [...command.helpInformation().matchAll(optionLine)].map((match) => [match[1]!, match[2]!])
  }

  it("run: lists the target options first, each required", () => {
    const options = helpOptions("run")
    expect(options.slice(0, 4).map(([flag]) => flag)).toEqual(targetFlags)
    for (const [, description] of options.slice(0, 4)) expect(description).toMatch(/^\[one required\]/)
    expect(options.filter(([, description]) => description.startsWith("[one required]"))).toHaveLength(4)
  })

  it("run: lists --start-scenario after --save", () => {
    const flags = helpOptions("run").map(([flag]) => flag)
    expect(flags[flags.indexOf("--save") + 1]).toBe("--start-scenario")
  })

  it.each(["install", "update"])("mods %s: mod options are optional, scenario options absent", (name) => {
    const options = helpOptions("mods", name)
    const flags = options.map(([flag]) => flag)
    expect(flags.slice(0, 2)).toEqual(["--mod-path", "--mod-name"])
    expect(flags).not.toContain("--scenario")
    expect(flags).not.toContain("--scenario-path")
    expect(flags).not.toContain("--start-scenario")
    expect(options.some(([, description]) => description.includes("[one required]"))).toBe(false)
  })
})

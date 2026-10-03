import { Command } from "@commander-js/extra-typings"
import { describe, expect, it } from "vitest"
import { parseCliOptions, registerAllCliOptions } from "./config/index.js"

function parseArgs(...args: string[]): Record<string, unknown> {
  const command = new Command().exitOverride()
  registerAllCliOptions(command)
  return command.parse(args, { from: "user" }).opts()
}

describe("registerAllCliOptions", () => {
  it.each<[string[], Record<string, unknown>]>([
    [["--game-speed", "100"], { gameSpeed: 100 }],
    [["--bail"], { bail: 1 }],
    [["--bail", "3"], { bail: 3 }],
    [["--no-forbid-only"], { forbidOnly: false }],
    [["--no-log-passed-tests"], { logPassedTests: false }],
    [["--no-output-file"], { outputFile: false }],
    [["--no-auto-start"], { autoStart: false }],
    [["--mods", "a", "b"], { mods: ["a", "b"] }],
  ])("parses %j", (args, expected) => {
    expect(parseArgs(...args)).toMatchObject(expected)
  })

  it("does not set values for omitted options, so file config is not overridden", () => {
    const opts = parseArgs()
    expect(opts.forbidOnly).toBeUndefined()
    expect(opts.udpPort).toBeUndefined()
  })
})

describe("parseCliOptions", () => {
  it("omits undefined values", () => {
    expect(parseCliOptions({ gameSpeed: 100, verbose: undefined }, [])).toEqual({ gameSpeed: 100 })
  })

  it.each([
    ["--udp-port", { udpPort: NaN }],
    ["--game-speed", { gameSpeed: 1.5 }],
    ["--output-timeout", { outputTimeout: -1 }],
  ])("rejects invalid %s", (flag, opts) => {
    expect(() => parseCliOptions(opts, [])).toThrow(flag)
  })

  it.each<[string, Record<string, unknown>, string[], string | string[] | undefined]>([
    ["no patterns", {}, [], undefined],
    ["single positional pattern", {}, ["pos"], "pos"],
    ["only --test-pattern", { testPattern: "cli" }, [], "cli"],
    ["multiple positional patterns", {}, ["foo", "bar"], ["foo", "bar"]],
    ["--test-pattern combined with positional patterns", { testPattern: "cli" }, ["pos"], ["cli", "pos"]],
  ])("testPattern from %s", (_, opts, patterns, expected) => {
    expect(parseCliOptions(opts, patterns).testPattern).toEqual(expected)
  })
})

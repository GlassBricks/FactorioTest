import { afterEach, assertType, beforeEach, describe, expect, it, vi } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { loadFileConfig, type ModConfig, resolveConfig, toModConfig } from "./config/index.js"

const testDir = path.join(import.meta.dirname, "__test_fixtures__")

beforeEach(() => {
  fs.mkdirSync(testDir, { recursive: true })
})

afterEach(() => {
  vi.restoreAllMocks()
  fs.rmSync(testDir, { recursive: true, force: true })
})

function writeConfig(config: Record<string, unknown>): string {
  const configPath = path.join(testDir, "factorio-test.json")
  fs.writeFileSync(configPath, JSON.stringify(config))
  return configPath
}

describe("loadFileConfig", () => {
  it("returns empty object when no config exists", () => {
    expect(loadFileConfig(path.join(testDir, "nonexistent.json"))).toEqual({})
  })

  it("loads flat camelCase config", () => {
    expect(loadFileConfig(writeConfig({ modPath: "./test", gameSpeed: 100 }))).toMatchObject({
      modPath: path.join(testDir, "test"),
      gameSpeed: 100,
    })
  })

  it.each(["modPath", "factorioPath", "dataDirectory", "save", "outputFile"])(
    "resolves %s relative to the config file",
    (key) => {
      expect(loadFileConfig(writeConfig({ [key]: "./some/path" }))).toMatchObject({
        [key]: path.join(testDir, "some/path"),
      })
    },
  )

  it("accepts outputFile: false", () => {
    expect(loadFileConfig(writeConfig({ outputFile: false })).outputFile).toBe(false)
  })

  it.each([
    ["unknown top-level key", { unknownKey: true }, /unknownKey/],
    ["unknown legacy test key", { test: { badNestedKey: true } }, /test/],
    ["type mismatch", { gameSpeed: "fast" }, /gameSpeed/],
    ["legacy type mismatch", { test: { game_speed: "fast" } }, /test\.game_speed/],
    ["CLI-only option", { graphics: true }, /graphics/],
  ])("rejects %s", (_, config, message) => {
    const configPath = writeConfig(config)
    expect(() => loadFileConfig(configPath)).toThrow(message)
    expect(() => loadFileConfig(configPath)).toThrow(configPath)
  })

  describe("legacy test key", () => {
    beforeEach(() => {
      vi.spyOn(console, "warn").mockImplementation(() => {})
    })

    it("maps snake_case test options to top-level camelCase, with a deprecation warning", () => {
      const config = loadFileConfig(writeConfig({ test: { game_speed: 100, tag_blacklist: ["slow"] } }))
      expect(config).toMatchObject({ gameSpeed: 100, tagBlacklist: ["slow"] })
      expect(config).not.toHaveProperty("test")
      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining("deprecated"))
    })

    it("rejects an option set both top-level and under test", () => {
      expect(() => loadFileConfig(writeConfig({ gameSpeed: 1, test: { game_speed: 2 } }))).toThrow(/gameSpeed/)
    })
  })
})

describe("ModConfig type compatibility", () => {
  it("all ModConfig keys exist in FactorioTest.Config with compatible types", () => {
    type ConfigSubset = Pick<FactorioTest.Config, keyof ModConfig>
    assertType<ConfigSubset>({} as Required<ModConfig>)
  })
})

describe("resolveConfig", () => {
  function resolve(
    fileConfig: Record<string, unknown>,
    cliOptions: Record<string, unknown> = {},
    patterns: string[] = [],
  ) {
    return resolveConfig({ cliOptions: { config: writeConfig(fileConfig), ...cliOptions }, patterns })
  }

  it("CLI options override file config", () => {
    const result = resolve(
      { verbose: true, forbidOnly: false, gameSpeed: 100 },
      { verbose: false, forbidOnly: true, gameSpeed: 200 },
    )
    expect(result).toMatchObject({ verbose: false, forbidOnly: true, gameSpeed: 200 })
  })

  it("file config fills in missing CLI values", () => {
    expect(resolve({ udpPort: 9999, outputTimeout: 30, logPassedTests: true })).toMatchObject({
      udpPort: 9999,
      outputTimeout: 30,
      logPassedTests: true,
    })
  })

  it("applies defaults when neither CLI nor file provides value", () => {
    expect(resolve({})).toMatchObject({
      autoStart: true,
      forbidOnly: true,
      udpPort: 14434,
      outputTimeout: 15,
      watchPatterns: ["info.json", "**/*.lua"],
      dataDirectory: path.join(testDir, "factorio-test-data-dir"),
    })
  })

  it("does not default mod-side options, leaving them to the mod", () => {
    const result = resolve({})
    expect(result.logPassedTests).toBeUndefined()
    expect(result.reorderFailedFirst).toBeUndefined()
  })

  it.each([
    ["CLI", {}, { outputFile: false }],
    ["config file", { outputFile: false }, {}],
  ])("outputFile: false from %s disables output", (_, fileConfig, cliOptions) => {
    expect(resolve(fileConfig, cliOptions).outputFile).toBeUndefined()
  })

  it("computes default outputFile from dataDirectory", () => {
    expect(resolve({}).outputFile).toMatch(/test-results\.json$/)
  })

  it.each<[string, Record<string, unknown>, string[], string | string[] | undefined]>([
    [
      "positional patterns combine with CLI option, overriding config file",
      { testPattern: "cli" },
      ["pos1", "pos2"],
      ["cli", "pos1", "pos2"],
    ],
    ["CLI option overrides config file", { testPattern: "cli" }, [], "cli"],
    ["config file used when no CLI option or positional patterns", {}, [], "config"],
  ])("testPattern: %s", (_, cliOptions, patterns, expected) => {
    expect(resolve({ testPattern: "config" }, cliOptions, patterns).testPattern).toEqual(expected)
  })
})

describe("toModConfig", () => {
  it("includes only defined mod options, in snake_case", () => {
    const config = resolveConfig({
      cliOptions: { config: writeConfig({ gameSpeed: 100, verbose: true }), tagBlacklist: ["slow"], bail: 2 },
      patterns: ["foo"],
    })
    expect(toModConfig(config)).toEqual({
      game_speed: 100,
      tag_blacklist: ["slow"],
      bail: 2,
      test_pattern: "foo",
    })
  })
})

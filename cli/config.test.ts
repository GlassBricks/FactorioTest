import { describe, it, expect, beforeEach, afterEach, assertType } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { loadFileConfig, resolveConfig, type TestRunnerConfig } from "./config/index.js"

const testDir = path.join(import.meta.dirname, "__test_fixtures__")

describe("loadConfig", () => {
  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it("returns empty object when no config exists", () => {
    expect(loadFileConfig(path.join(testDir, "nonexistent.json"))).toEqual({})
  })

  it("loads factorio-test.json with snake_case test config", () => {
    const configPath = path.join(testDir, "factorio-test.json")
    fs.writeFileSync(
      configPath,
      JSON.stringify({
        modPath: "./test",
        test: { game_speed: 100 },
      }),
    )
    expect(loadFileConfig(configPath)).toMatchObject({
      modPath: path.join(testDir, "test"),
      test: { game_speed: 100 },
    })
  })

  it("throws on invalid keys", () => {
    const configPath = path.join(testDir, "bad.json")
    fs.writeFileSync(configPath, JSON.stringify({ test: { invalid_key: true } }))
    expect(() => loadFileConfig(configPath)).toThrow()
  })

  it("error message includes file path for invalid top-level key", () => {
    const configPath = path.join(testDir, "bad-toplevel.json")
    fs.writeFileSync(configPath, JSON.stringify({ unknownKey: true }))
    expect(() => loadFileConfig(configPath)).toThrow(configPath)
  })

  it("error message includes field name for invalid top-level key", () => {
    const configPath = path.join(testDir, "bad-toplevel.json")
    fs.writeFileSync(configPath, JSON.stringify({ unknownKey: true }))
    expect(() => loadFileConfig(configPath)).toThrow(/unknownKey/)
  })

  it("error message includes field path for invalid nested key", () => {
    const configPath = path.join(testDir, "bad-nested.json")
    fs.writeFileSync(configPath, JSON.stringify({ test: { badNestedKey: true } }))
    expect(() => loadFileConfig(configPath)).toThrow(/test/)
  })

  it("error message includes field name for type mismatch", () => {
    const configPath = path.join(testDir, "bad-type.json")
    fs.writeFileSync(configPath, JSON.stringify({ test: { game_speed: "fast" } }))
    expect(() => loadFileConfig(configPath)).toThrow(/game_speed/)
  })
})

describe("TestRunnerConfig type compatibility", () => {
  it("all TestRunnerConfig keys exist in FactorioTest.Config with compatible types", () => {
    type ConfigSubset = Pick<FactorioTest.Config, keyof TestRunnerConfig>
    assertType<ConfigSubset>({} as Required<TestRunnerConfig>)
  })
})

describe("resolveConfig", () => {
  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  function writeConfig(config: Record<string, unknown>): string {
    const configPath = path.join(testDir, "factorio-test.json")
    fs.writeFileSync(configPath, JSON.stringify(config))
    return configPath
  }

  it("CLI options override file config", () => {
    const configPath = writeConfig({ verbose: true, forbidOnly: false })
    const result = resolveConfig({
      cliOptions: { config: configPath, verbose: false, forbidOnly: true },
      patterns: [],
    })
    expect(result.verbose).toBe(false)
    expect(result.forbidOnly).toBe(true)
  })

  it("applies defaults when neither CLI nor file provides value", () => {
    const configPath = writeConfig({})
    const result = resolveConfig({ cliOptions: { config: configPath }, patterns: [] })
    expect(result.forbidOnly).toBe(true)
    expect(result.udpPort).toBe(14434)
    expect(result.outputTimeout).toBe(15)
    expect(result.watchPatterns).toEqual(["info.json", "**/*.lua"])
  })

  it("outputFile: false disables output", () => {
    const configPath = writeConfig({ outputFile: "results.json" })
    const result = resolveConfig({
      cliOptions: { config: configPath, outputFile: false },
      patterns: [],
    })
    expect(result.outputFile).toBeUndefined()
  })

  it("computes default outputFile from dataDirectory", () => {
    const configPath = writeConfig({})
    const result = resolveConfig({ cliOptions: { config: configPath }, patterns: [] })
    expect(result.outputFile).toMatch(/test-results\.json$/)
  })

  it("file config fills in missing CLI values", () => {
    const configPath = writeConfig({ udpPort: 9999, outputTimeout: 30 })
    const result = resolveConfig({ cliOptions: { config: configPath }, patterns: [] })
    expect(result.udpPort).toBe(9999)
    expect(result.outputTimeout).toBe(30)
  })

  describe("test config merge", () => {
    it("positional patterns override CLI option and config file", () => {
      const configPath = writeConfig({ test: { test_pattern: "config" } })
      const result = resolveConfig({
        cliOptions: { config: configPath, testPattern: "cli" },
        patterns: ["pos1", "pos2"],
      })
      expect(result.testConfig.test_pattern).toBe("(pos1)|(pos2)")
    })

    it("CLI option overrides config file when no positional patterns", () => {
      const configPath = writeConfig({ test: { test_pattern: "config" } })
      const result = resolveConfig({
        cliOptions: { config: configPath, testPattern: "cli" },
        patterns: [],
      })
      expect(result.testConfig.test_pattern).toBe("cli")
    })

    it("uses config file when no CLI option or positional patterns", () => {
      const configPath = writeConfig({ test: { test_pattern: "config" } })
      const result = resolveConfig({ cliOptions: { config: configPath }, patterns: [] })
      expect(result.testConfig.test_pattern).toBe("config")
    })

    it("undefined when no patterns specified anywhere", () => {
      const configPath = writeConfig({})
      const result = resolveConfig({ cliOptions: { config: configPath }, patterns: [] })
      expect(result.testConfig.test_pattern).toBeUndefined()
    })

    it("CLI test options override file test config", () => {
      const configPath = writeConfig({ test: { game_speed: 100 } })
      const result = resolveConfig({
        cliOptions: { config: configPath, gameSpeed: 200 },
        patterns: [],
      })
      expect(result.testConfig.game_speed).toBe(200)
    })

    it("preserves file test config when CLI undefined", () => {
      const configPath = writeConfig({ test: { game_speed: 100, log_passed_tests: true } })
      const result = resolveConfig({ cliOptions: { config: configPath }, patterns: [] })
      expect(result.testConfig.game_speed).toBe(100)
      expect(result.testConfig.log_passed_tests).toBe(true)
    })
  })
})

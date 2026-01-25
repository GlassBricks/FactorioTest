import { describe, it, expect, beforeEach, afterEach, assertType } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { loadConfig, mergeTestConfig, buildTestConfig, type TestRunnerConfig } from "./config/index.js"

const testDir = path.join(import.meta.dirname, "__test_fixtures__")

describe("loadConfig", () => {
  beforeEach(() => {
    fs.mkdirSync(testDir, { recursive: true })
  })

  afterEach(() => {
    fs.rmSync(testDir, { recursive: true, force: true })
  })

  it("returns empty object when no config exists", () => {
    expect(loadConfig(path.join(testDir, "nonexistent.json"))).toEqual({})
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
    expect(loadConfig(configPath)).toMatchObject({
      modPath: path.join(testDir, "test"),
      test: { game_speed: 100 },
    })
  })

  it("throws on invalid keys", () => {
    const configPath = path.join(testDir, "bad.json")
    fs.writeFileSync(configPath, JSON.stringify({ test: { invalid_key: true } }))
    expect(() => loadConfig(configPath)).toThrow()
  })

  it("error message includes file path for invalid top-level key", () => {
    const configPath = path.join(testDir, "bad-toplevel.json")
    fs.writeFileSync(configPath, JSON.stringify({ unknownKey: true }))
    expect(() => loadConfig(configPath)).toThrow(configPath)
  })

  it("error message includes field name for invalid top-level key", () => {
    const configPath = path.join(testDir, "bad-toplevel.json")
    fs.writeFileSync(configPath, JSON.stringify({ unknownKey: true }))
    expect(() => loadConfig(configPath)).toThrow(/unknownKey/)
  })

  it("error message includes field path for invalid nested key", () => {
    const configPath = path.join(testDir, "bad-nested.json")
    fs.writeFileSync(configPath, JSON.stringify({ test: { badNestedKey: true } }))
    expect(() => loadConfig(configPath)).toThrow(/test/)
  })

  it("error message includes field name for type mismatch", () => {
    const configPath = path.join(testDir, "bad-type.json")
    fs.writeFileSync(configPath, JSON.stringify({ test: { game_speed: "fast" } }))
    expect(() => loadConfig(configPath)).toThrow(/game_speed/)
  })
})

describe("TestRunnerConfig type compatibility", () => {
  it("all TestRunnerConfig keys exist in FactorioTest.Config with compatible types", () => {
    type ConfigSubset = Pick<FactorioTest.Config, keyof TestRunnerConfig>
    assertType<ConfigSubset>({} as Required<TestRunnerConfig>)
  })
})

describe("mergeTestConfig", () => {
  it("CLI options override config file", () => {
    const result = mergeTestConfig({ game_speed: 100 }, { game_speed: 200 })
    expect(result.game_speed).toBe(200)
  })

  it("CLI test pattern overrides config file", () => {
    const result = mergeTestConfig({ test_pattern: "foo" }, { test_pattern: "bar" })
    expect(result.test_pattern).toBe("bar")
  })

  it("preserves config file values when CLI undefined", () => {
    const result = mergeTestConfig({ game_speed: 100, log_passed_tests: true }, {})
    expect(result.game_speed).toBe(100)
    expect(result.log_passed_tests).toBe(true)
  })
})

describe("buildTestConfig test pattern priority", () => {
  const baseOptions = { dataDirectory: "." }

  it("positional patterns override CLI option and config file", () => {
    const result = buildTestConfig({ test: { test_pattern: "config" } }, { ...baseOptions, testPattern: "cli" }, [
      "pos1",
      "pos2",
    ])
    expect(result.test_pattern).toBe("(pos1)|(pos2)")
  })

  it("CLI option overrides config file when no positional patterns", () => {
    const result = buildTestConfig({ test: { test_pattern: "config" } }, { ...baseOptions, testPattern: "cli" }, [])
    expect(result.test_pattern).toBe("cli")
  })

  it("uses config file when no CLI option or positional patterns", () => {
    const result = buildTestConfig({ test: { test_pattern: "config" } }, baseOptions, [])
    expect(result.test_pattern).toBe("config")
  })

  it("undefined when no patterns specified anywhere", () => {
    const result = buildTestConfig({}, baseOptions, [])
    expect(result.test_pattern).toBeUndefined()
  })
})

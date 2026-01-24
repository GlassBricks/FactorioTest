import { describe, it, expect, beforeEach, afterEach } from "vitest"
import * as fs from "fs"
import * as path from "path"
import { loadConfig, mergeTestConfig } from "./config.js"

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
    expect(loadConfig(configPath)).toEqual({
      modPath: "./test",
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

describe("mergeTestConfig", () => {
  it("CLI options override config file", () => {
    const result = mergeTestConfig({ game_speed: 100 }, { game_speed: 200 })
    expect(result.game_speed).toBe(200)
  })

  it("combines test patterns with OR", () => {
    const result = mergeTestConfig({ test_pattern: "foo" }, { test_pattern: "bar" })
    expect(result.test_pattern).toBe("(foo)|(bar)")
  })

  it("preserves config file values when CLI undefined", () => {
    const result = mergeTestConfig({ game_speed: 100, log_passed_tests: true }, {})
    expect(result.game_speed).toBe(100)
    expect(result.log_passed_tests).toBe(true)
  })
})

import { describe, it, expect } from "vitest"
import { testRunnerConfigSchema, cliConfigSchema, parseCliTestOptions } from "./schema.js"

describe("testRunnerConfigSchema", () => {
  it("parses valid config with snake_case keys", () => {
    const config = {
      test_pattern: "foo",
      game_speed: 100,
      log_passed_tests: true,
    }
    expect(testRunnerConfigSchema.parse(config)).toEqual(config)
  })

  it("rejects invalid types", () => {
    expect(() => testRunnerConfigSchema.parse({ game_speed: "fast" })).toThrow()
  })

  it("allows empty config", () => {
    expect(testRunnerConfigSchema.parse({})).toEqual({})
  })

  it("rejects unknown keys", () => {
    expect(() => testRunnerConfigSchema.parse({ unknown_key: true })).toThrow()
  })
})

describe("cliConfigSchema", () => {
  it("parses config file with snake_case test keys", () => {
    const config = {
      modPath: "./my-mod",
      test: { game_speed: 50, log_passed_tests: true },
    }
    expect(cliConfigSchema.parse(config)).toEqual(config)
  })

  it("rejects unknown keys in strict mode", () => {
    expect(() => cliConfigSchema.strict().parse({ unknownKey: true })).toThrow()
  })

  it("accepts forbid_only boolean", () => {
    const config = { forbid_only: false }
    expect(cliConfigSchema.parse(config)).toEqual(config)
  })

  it("defaults forbid_only to undefined", () => {
    expect(cliConfigSchema.parse({}).forbid_only).toBeUndefined()
  })
})

describe("parseCliTestOptions", () => {
  it("converts Commander camelCase output to snake_case", () => {
    const commanderOpts = {
      testPattern: "foo",
      gameSpeed: 100,
      logPassedTests: true,
    }
    expect(parseCliTestOptions(commanderOpts)).toEqual({
      test_pattern: "foo",
      game_speed: 100,
      log_passed_tests: true,
    })
  })

  it("omits undefined values", () => {
    expect(parseCliTestOptions({ gameSpeed: 100 })).toEqual({ game_speed: 100 })
  })

  it("returns empty object for empty input", () => {
    expect(parseCliTestOptions({})).toEqual({})
  })
})

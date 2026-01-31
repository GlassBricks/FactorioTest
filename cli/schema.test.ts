import { describe, it, expect } from "vitest"
import { testRunnerConfigSchema, fileConfigSchema, parseCliTestOptions } from "./config/index.js"

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

describe("fileConfigSchema", () => {
  it("parses config file with snake_case test keys", () => {
    const config = {
      modPath: "./my-mod",
      test: { game_speed: 50, log_passed_tests: true },
    }
    expect(fileConfigSchema.parse(config)).toEqual(config)
  })

  it("rejects unknown keys in strict mode", () => {
    expect(() => fileConfigSchema.strict().parse({ unknownKey: true })).toThrow()
  })

  it("accepts forbidOnly boolean", () => {
    const config = { forbidOnly: false }
    expect(fileConfigSchema.parse(config)).toEqual(config)
  })

  it("defaults forbidOnly to undefined", () => {
    expect(fileConfigSchema.parse({}).forbidOnly).toBeUndefined()
  })
})

describe("parseCliTestOptions", () => {
  it("converts Commander camelCase output to snake_case", () => {
    const commanderOpts = {
      testPattern: "foo",
      gameSpeed: 100,
      logPassedTests: true,
    }
    expect(parseCliTestOptions(commanderOpts, [])).toEqual({
      test_pattern: "foo",
      game_speed: 100,
      log_passed_tests: true,
    })
  })

  it("omits undefined values", () => {
    expect(parseCliTestOptions({ gameSpeed: 100 }, [])).toEqual({ game_speed: 100 })
  })

  it("returns empty object for empty input", () => {
    expect(parseCliTestOptions({}, [])).toEqual({})
  })

  it("passes through bail option", () => {
    expect(parseCliTestOptions({ bail: 1 }, [])).toEqual({ bail: 1 })
    expect(parseCliTestOptions({ bail: 3 }, [])).toEqual({ bail: 3 })
  })

  it("converts bail=true to bail=1 (commander behavior for --bail without value)", () => {
    expect(parseCliTestOptions({ bail: true }, [])).toEqual({ bail: 1 })
  })

  it("joins positional patterns with OR logic", () => {
    expect(parseCliTestOptions({}, ["foo", "bar"]).test_pattern).toBe("(foo)|(bar)")
  })

  it("positional patterns override CLI testPattern", () => {
    expect(parseCliTestOptions({ testPattern: "cli" }, ["pos"]).test_pattern).toBe("(pos)")
  })
})

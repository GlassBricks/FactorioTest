import { describe, it, expect } from "vitest"
import { matchesPattern } from "./file-watcher.js"

describe("matchesPattern", () => {
  const defaultPatterns = ["info.json", "**/*.lua"]

  it.each([
    ["info.json", defaultPatterns, true],
    ["control.lua", defaultPatterns, true],
    ["nested/file.lua", defaultPatterns, true],
    ["deeply/nested/module.lua", defaultPatterns, true],
    ["data.ts", defaultPatterns, false],
    ["settings.json", defaultPatterns, false],
    ["info.json.bak", defaultPatterns, false],
    ["some/info.json", defaultPatterns, false],
  ])("matchesPattern(%j, %j) => %j", (filename, patterns, expected) => {
    expect(matchesPattern(filename, patterns)).toBe(expected)
  })

  it("handles custom patterns", () => {
    expect(matchesPattern("src/main.ts", ["**/*.ts"])).toBe(true)
    expect(matchesPattern("main.ts", ["**/*.ts"])).toBe(true)
    expect(matchesPattern("main.js", ["**/*.ts"])).toBe(false)
  })

  it("handles single wildcard", () => {
    expect(matchesPattern("file.lua", ["*.lua"])).toBe(true)
    expect(matchesPattern("nested/file.lua", ["*.lua"])).toBe(false)
  })

  it("handles backslash paths (Windows)", () => {
    expect(matchesPattern("nested\\file.lua", defaultPatterns)).toBe(true)
  })
})

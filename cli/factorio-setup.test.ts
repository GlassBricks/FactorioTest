import { describe, it, expect } from "vitest"
import { buildAutoStartConfig, readDataPath } from "./factorio-setup.js"

describe("buildAutoStartConfig", () => {
  it.each([
    ["headless", undefined, { mod: "my-mod", headless: true }],
    ["graphics", [], { mod: "my-mod", headless: false }],
    ["headless", ["a > b"], { mod: "my-mod", headless: true, last_failed_tests: ["a > b"] }],
  ] as const)("mode=%s lastFailedTests=%j", (mode, lastFailedTests, expected) => {
    expect(buildAutoStartConfig("my-mod", mode, lastFailedTests && [...lastFailedTests])).toEqual(expected)
  })
})

describe("readDataPath", () => {
  it.each<[NodeJS.Platform, string]>([
    ["darwin", "__PATH__executable__/../data"],
    ["linux", "__PATH__executable__/../../data"],
    ["win32", "__PATH__executable__/../../data"],
  ])("%s => %s", (platform, expected) => {
    expect(readDataPath(platform)).toBe(expected)
  })
})

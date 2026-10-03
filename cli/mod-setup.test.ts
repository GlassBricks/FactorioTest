import { describe, it, expect } from "vitest"
import { buildAutoStartConfig, parseRequiredDependencies, readDataPath, type ModRequirement } from "./mod-setup.js"

describe("parseRequiredDependencies", () => {
  it.each<[string[], ModRequirement[]]>([
    [[], []],
    [["some-mod"], [{ name: "some-mod" }]],
    [["some-mod >= 1.0.0"], [{ name: "some-mod", minVersion: "1.0.0" }]],
    [["~ some-mod >= 1.0.0"], [{ name: "some-mod", minVersion: "1.0.0" }]],
    [["? optional-mod >= 1.0.0"], []],
    [["! incompatible-mod"], []],
    [["(?) hidden-optional >= 1.0.0"], []],
    [["base >= 1.1.0"], [{ name: "base", minVersion: "1.1.0" }]],
    [["quality >= 1.0.0"], [{ name: "quality", minVersion: "1.0.0" }]],
    [["  mod-name  >=  1.0.0  "], [{ name: "mod-name", minVersion: "1.0.0" }]],
    [["~  soft-mod"], [{ name: "soft-mod" }]],
    [
      [
        "base >= 1.1.0",
        "required-mod >= 2.0.0",
        "? optional-mod",
        "! incompatible-mod",
        "(?) hidden-optional",
        "~ soft-required >= 1.0.0",
        "another-required",
      ],
      [
        { name: "base", minVersion: "1.1.0" },
        { name: "required-mod", minVersion: "2.0.0" },
        { name: "soft-required", minVersion: "1.0.0" },
        { name: "another-required" },
      ],
    ],
  ])("parseRequiredDependencies(%j) => %j", (input, expected) => {
    expect(parseRequiredDependencies(input)).toEqual(expected)
  })
})

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

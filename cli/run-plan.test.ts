import { describe, expect, it } from "vitest"
import { planModSetup, resolveRunOutcome, validateRunConfig } from "./run-plan.js"

describe("validateRunConfig", () => {
  it.each([
    [{ modPath: "a", modName: "b" }, "Only one of --mod-path or --mod-name"],
    [{}, "One of --mod-path or --mod-name must be specified"],
    [{ modPath: "a", noAutoStart: true }, "--no-auto-start requires --graphics"],
  ] as const)("rejects %o", (config, message) => {
    expect(() => validateRunConfig(config)).toThrow(message)
  })

  it.each([{ modPath: "a" }, { modName: "b" }, { modPath: "a", noAutoStart: true, graphics: true }] as const)(
    "accepts %o",
    (config) => {
      expect(() => validateRunConfig(config)).not.toThrow()
    },
  )
})

describe("planModSetup", () => {
  it("disables all DLC mods by default and enables the mod under test", () => {
    const plan = planModSetup({ modToTest: "my-mod", modDependencies: [] })
    expect(plan).toEqual({
      toInstall: [],
      enableArgs: [
        "quality=false",
        "elevated-rails=false",
        "space-age=false",
        "recycler=false",
        "factorio-test=true",
        "my-mod=true",
      ],
    })
  })

  it.each([
    ["config mods", { configMods: ["space-age"] }, "space-age"],
    ["dependencies", { modDependencies: ["quality"] }, "quality"],
  ])("does not disable DLC mods named in %s", (_, input, dlcMod) => {
    const { enableArgs } = planModSetup({ modToTest: "my-mod", modDependencies: [], ...input })
    expect(enableArgs).not.toContain(`${dlcMod}=false`)
    expect(enableArgs).toContain(`${dlcMod}=true`)
  })

  it.each([
    [["space-age"], ["quality", "elevated-rails", "recycler"], []],
    [["quality"], ["recycler"], ["elevated-rails", "space-age"]],
    [["elevated-rails"], [], ["quality", "space-age", "recycler"]],
    [["space-age", "quality=false"], ["elevated-rails", "recycler"], []],
  ])("with --mods %j, enables DLC dependencies %j and disables %j", (configMods, enabled, disabled) => {
    const { enableArgs } = planModSetup({ modToTest: "my-mod", modDependencies: [], configMods })
    for (const mod of enabled) expect(enableArgs).toContain(`${mod}=true`)
    for (const mod of disabled) expect(enableArgs).toContain(`${mod}=false`)
  })

  it("enables DLC dependencies of mod dependencies", () => {
    const { enableArgs } = planModSetup({ modToTest: "my-mod", modDependencies: ["space-age"] })
    expect(enableArgs).toEqual(expect.arrayContaining(["quality=true", "elevated-rails=true", "recycler=true"]))
  })

  it("respects an explicitly disabled DLC dependency", () => {
    const { enableArgs } = planModSetup({
      modToTest: "my-mod",
      modDependencies: [],
      configMods: ["space-age", "quality=false"],
    })
    expect(enableArgs).toContain("quality=false")
    expect(enableArgs).not.toContain("quality=true")
  })

  it("passes explicit enable/disable specs through without installing them", () => {
    const plan = planModSetup({ modToTest: "my-mod", modDependencies: [], configMods: ["other=false"] })
    expect(plan.toInstall).toEqual([])
    expect(plan.enableArgs).toContain("other=false")
  })

  it("installs and enables versioned config mods", () => {
    const plan = planModSetup({ modToTest: "my-mod", modDependencies: ["dep"], configMods: ["lib >= 1.2.3"] })
    expect(plan.toInstall).toEqual([{ name: "lib", minVersion: "1.2.3" }])
    expect(plan.enableArgs).toEqual(expect.arrayContaining(["dep=true", "lib=true"]))
  })
})

describe("resolveRunOutcome", () => {
  it.each([
    [{ status: "passed", hasFocusedTests: false }, true, { exitCode: 0, status: "passed" }],
    [{ status: "failed", hasFocusedTests: false }, true, { exitCode: 1, status: "failed" }],
    [{ status: "todo", hasFocusedTests: false }, true, { exitCode: 1, status: "todo" }],
    [{ status: "cancelled", hasFocusedTests: false }, true, { exitCode: 0, status: "cancelled" }],
    [{ status: "bailed", hasFocusedTests: false }, true, { exitCode: 1, status: "failed", bailed: true }],
    [{ status: "passed", hasFocusedTests: true }, true, { exitCode: 1, forbiddenFocusedTests: true }],
    [{ status: "passed", hasFocusedTests: true }, false, { exitCode: 0, forbiddenFocusedTests: false }],
  ] as const)("%o with forbidOnly=%s", (result, forbidOnly, expected) => {
    expect(resolveRunOutcome(result, forbidOnly)).toMatchObject(expected)
  })
})

import { describe, expect, it } from "vitest"
import {
  checkProvidingMod,
  checkScenarioModEnabled,
  resolveRunOutcome,
  type RunPlan,
  targetId,
  validateRunConfig,
} from "./run-plan.js"

const oneOf = "Specify one of --mod-path, --mod-name, --scenario-path or --scenario"
const scenarioWorld = "can't be used when testing a scenario"

describe("validateRunConfig", () => {
  it.each([
    [{}, "One of --mod-path, --mod-name, --scenario-path or --scenario must be specified"],
    [{ modPath: "a", modName: "b" }, oneOf],
    [{ modName: "b", scenario: "m/s" }, oneOf],
    [{ modPath: "a", scenario: "s" }, oneOf],
    [{ modPath: "a", scenarioPath: "s" }, oneOf],
    [{ scenario: "s", scenarioPath: "s" }, oneOf],
    [{ modPath: "a", modName: "b", scenario: "m/s" }, oneOf],
    [{ scenario: "s", save: "x.zip" }, `--save ${scenarioWorld}`],
    [{ scenarioPath: "s", startScenario: "base/freeplay" }, `--start-scenario ${scenarioWorld}`],
    [{ modPath: "a", save: "x.zip", startScenario: "base/freeplay" }, "Only one of --save or --start-scenario"],
    [{ modPath: "a", autoStart: false }, "--no-auto-start requires --graphics"],
    [{ modPath: "a", step: true }, "Step mode requires --graphics"],
  ] as const)("rejects %o", (config, message) => {
    expect(() => validateRunConfig({ autoStart: true, ...config })).toThrow(message)
  })

  it.each([
    [{ modPath: "a" }, { target: { kind: "mod", modPath: "a" }, world: { kind: "bundled" } }],
    [{ modName: "b" }, { target: { kind: "mod", modName: "b" }, world: { kind: "bundled" } }],
    [{ modName: "b", save: "x.zip" }, { world: { kind: "save", path: "x.zip" } }],
    [{ modName: "b", startScenario: "base/freeplay" }, { world: { kind: "scenario", ref: "base/freeplay" } }],
    [
      { scenarioPath: "/dir/my-scenario/" },
      {
        target: { kind: "scenario", ref: "my-scenario", scenarioPath: "/dir/my-scenario/" },
        world: { kind: "scenario", ref: "my-scenario" },
      },
    ],
    [{ scenario: "s" }, { target: { kind: "scenario", ref: "s" }, world: { kind: "scenario", ref: "s" } }],
    [
      { modPath: "a", scenario: "m/s" },
      { target: { kind: "scenario", ref: "m/s", providingModPath: "a" }, world: { kind: "scenario", ref: "m/s" } },
    ],
    [{ modPath: "a", autoStart: false, graphics: true }, {}],
    [{ modPath: "a", graphics: true, step: true }, {}],
  ] as const)("accepts %o", (config, expected) => {
    expect(validateRunConfig({ autoStart: true, ...config })).toMatchObject(expected)
  })
})

describe("checkProvidingMod", () => {
  it("accepts the scenario's mod", () => {
    expect(() => checkProvidingMod("my-mod/s1", "my-mod")).not.toThrow()
  })

  it("rejects another mod", () => {
    expect(() => checkProvidingMod("my-mod/s1", "other-mod")).toThrow(
      '--scenario my-mod/s1 is from mod "my-mod", but --mod-path is mod "other-mod".',
    )
  })
})

describe("checkScenarioModEnabled", () => {
  const enabled = new Map([
    ["base", {}],
    ["my-mod", {}],
  ])
  const modTarget = { kind: "mod", modName: "my-mod" } as const

  it.each<[string, RunPlan]>([
    ["bundled world", { target: modTarget, world: { kind: "bundled" } }],
    ["start scenario from an enabled mod", { target: modTarget, world: { kind: "scenario", ref: "base/freeplay" } }],
    ["start scenario from the data dir", { target: modTarget, world: { kind: "scenario", ref: "s" } }],
    [
      "scenario from an enabled mod",
      { target: { kind: "scenario", ref: "my-mod/s1" }, world: { kind: "scenario", ref: "my-mod/s1" } },
    ],
  ])("accepts %s", (_, plan) => {
    expect(() => checkScenarioModEnabled(plan, enabled)).not.toThrow()
  })

  it.each<[RunPlan, string]>([
    [
      { target: { kind: "scenario", ref: "other/s1" }, world: { kind: "scenario", ref: "other/s1" } },
      '--scenario other/s1 needs mod "other". Add --mod-path, or list it in --mods.',
    ],
    [
      { target: modTarget, world: { kind: "scenario", ref: "other/s1" } },
      '--start-scenario other/s1 needs mod "other". List it in --mods.',
    ],
  ])("rejects %o", (plan, message) => {
    expect(() => checkScenarioModEnabled(plan, enabled)).toThrow(message)
  })
})

describe("targetId", () => {
  it.each([
    [{ kind: "mod", modName: "my-mod" }, "my-mod", "my-mod"],
    [{ kind: "scenario", ref: "s" }, undefined, "level"],
    [{ kind: "scenario", ref: "my-mod/s", providingModPath: "a" }, "my-mod", "level"],
  ] as const)("%o => %s", (target, modToTest, expected) => {
    expect(targetId(target, modToTest)).toBe(expected)
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

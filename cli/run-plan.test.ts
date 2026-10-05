import { describe, expect, it } from "vitest"
import { resolveRunOutcome, validateRunConfig } from "./run-plan.js"

describe("validateRunConfig", () => {
  it.each([
    [{ modPath: "a", modName: "b" }, "Only one of --mod-path or --mod-name"],
    [{}, "One of --mod-path or --mod-name must be specified"],
    [{ modPath: "a", autoStart: false }, "--no-auto-start requires --graphics"],
    [{ modPath: "a", step: true }, "Step mode requires --graphics"],
  ] as const)("rejects %o", (config, message) => {
    expect(() => validateRunConfig({ autoStart: true, ...config })).toThrow(message)
  })

  it.each([
    { modPath: "a" },
    { modName: "b" },
    { modPath: "a", autoStart: false, graphics: true },
    { modPath: "a", graphics: true, step: true },
  ] as const)("accepts %o", (config) => {
    expect(() => validateRunConfig({ autoStart: true, ...config })).not.toThrow()
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

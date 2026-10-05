import { describe, expect, it } from "vitest"
import {
  compareVersions,
  type Dependency,
  majorMinor,
  parseDependency,
  parseListedMod,
  satisfies,
  type VersionOp,
} from "./dependency.js"

describe("parseDependency", () => {
  it.each<[string, Dependency | undefined]>([
    ["flib", { kind: "required", name: "flib" }],
    ["flib >= 0.16.2", { kind: "required", name: "flib", constraint: { op: ">=", version: "0.16.2" } }],
    ["flib>=0.16", { kind: "required", name: "flib", constraint: { op: ">=", version: "0.16" } }],
    ["  flib  =  1.0.0  ", { kind: "required", name: "flib", constraint: { op: "=", version: "1.0.0" } }],
    ["~ soft", { kind: "unordered", name: "soft" }],
    ["+ quality >= 2.1.0", { kind: "recommended", name: "quality", constraint: { op: ">=", version: "2.1.0" } }],
    ["? opt < 2", { kind: "optional", name: "opt", constraint: { op: "<", version: "2" } }],
    ["? opt < 2.0", { kind: "optional", name: "opt", constraint: { op: "<", version: "2.0" } }],
    ["(?) hidden", { kind: "hidden-optional", name: "hidden" }],
    ["(?)hidden>1.0.0", { kind: "hidden-optional", name: "hidden", constraint: { op: ">", version: "1.0.0" } }],
    ["!quality", { kind: "incompatible", name: "quality" }],
    ["! bad-mod_2 <= 1.2.3", { kind: "incompatible", name: "bad-mod_2", constraint: { op: "<=", version: "1.2.3" } }],
    ["Mod With Spaces >= 1.0", { kind: "required", name: "Mod With Spaces", constraint: { op: ">=", version: "1.0" } }],
    ["", undefined],
    ["flib >= x", undefined],
    ["flib >=", undefined],
    ["flib => 1.0", undefined],
  ])("%j", (spec, expected) => {
    expect(parseDependency(spec)).toEqual(expected)
  })
})

describe("parseListedMod", () => {
  it.each<[string, Dependency]>([
    ["space-age", { kind: "required", name: "space-age" }],
    ["!quality", { kind: "incompatible", name: "quality" }],
    ["flib>=0.16", { kind: "required", name: "flib", constraint: { op: ">=", version: "0.16" } }],
  ])("accepts %j", (spec, expected) => {
    expect(parseListedMod(spec, "config mods")).toEqual(expected)
  })

  it.each([
    ["flib >= x", 'Invalid entry "flib >= x" in mods (factorio-test.json): expected [!] name [op version].'],
    ["? flib", 'Invalid entry "? flib" in mods'],
    ["(?) flib", 'Invalid entry "(?) flib" in mods'],
    ["~ flib", 'Invalid entry "~ flib" in mods'],
    ["+ flib", 'Invalid entry "+ flib" in mods'],
    ["quality=false", '"name=true|false" is no longer supported'],
    ["quality=true", 'Use "!name" to leave out a recommended dependency.'],
  ])("rejects %j", (spec, message) => {
    expect(() => parseListedMod(spec, "factorio-test.json")).toThrow(message)
  })
})

describe("versions", () => {
  it.each([
    ["1.0.0", "1.0.0", 0],
    ["1.0", "1.0.0", 0],
    ["1.10.0", "1.9.0", 1],
    ["0.16.2", "0.17.0", -1],
    ["2.0.0", "1.99.99", 1],
  ])("compareVersions(%s, %s) has sign %i", (a, b, sign) => {
    expect(Math.sign(compareVersions(a, b))).toBe(sign)
  })

  it.each<[string, VersionOp, string, boolean]>([
    ["1.0.0", "<", "1.0.1", true],
    ["1.0.1", "<", "1.0.1", false],
    ["1.0.1", "<=", "1.0.1", true],
    ["1.0.0", "=", "1.0", true],
    ["1.0.1", "=", "1.0", false],
    ["2.1.20", ">=", "2.1.0", true],
    ["2.0.0", ">", "2.0", false],
  ])("%s %s %s: %s", (version, op, target, expected) => {
    expect(satisfies(version, { op, version: target })).toBe(expected)
  })

  it("majorMinor", () => {
    expect(majorMinor("2.1.20")).toBe("2.1")
  })
})

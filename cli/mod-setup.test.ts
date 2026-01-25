import { describe, it, expect } from "vitest"
import { parseRequiredDependencies } from "./mod-setup.js"

describe("parseRequiredDependencies", () => {
  it.each([
    [[], []],
    [["some-mod"], ["some-mod"]],
    [["some-mod >= 1.0.0"], ["some-mod"]],
    [["~ some-mod >= 1.0.0"], ["some-mod"]],
    [["? optional-mod >= 1.0.0"], []],
    [["! incompatible-mod"], []],
    [["(?) hidden-optional >= 1.0.0"], []],
    [["base >= 1.1.0"], []],
    [["  mod-name  >=  1.0.0  "], ["mod-name"]],
    [["~  soft-mod"], ["soft-mod"]],
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
      ["required-mod", "soft-required", "another-required"],
    ],
  ])("parseRequiredDependencies(%j) => %j", (input, expected) => {
    expect(parseRequiredDependencies(input)).toEqual(expected)
  })
})

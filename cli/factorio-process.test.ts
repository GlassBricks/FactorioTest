import { describe, it, expect } from "vitest"
import { parseResultMessage } from "./factorio-process.js"

describe("parseResultMessage", () => {
  it.each([
    ["passed", { status: "passed", hasFocusedTests: false }],
    ["failed", { status: "failed", hasFocusedTests: false }],
    ["todo", { status: "todo", hasFocusedTests: false }],
    ["loadError", { status: "loadError", hasFocusedTests: false }],
    ["passed:focused", { status: "passed", hasFocusedTests: true }],
    ["failed:focused", { status: "failed", hasFocusedTests: true }],
    ["todo:focused", { status: "todo", hasFocusedTests: true }],
  ] as const)("parses %s", (input, expected) => {
    expect(parseResultMessage(input)).toEqual(expected)
  })
})

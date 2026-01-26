import { describe, it, expect } from "vitest"
import { FactorioOutputHandler, parseEvent } from "./factorio-output-parser.js"

describe("parseEvent", () => {
  it("parses valid testStarted event", () => {
    const line = 'FACTORIO-TEST-EVENT:{"type":"testStarted","test":{"path":"root > mytest"}}'
    const result = parseEvent(line)
    expect(result).toEqual({
      type: "testStarted",
      test: { path: "root > mytest" },
    })
  })

  it("parses valid testPassed event with duration", () => {
    const line = 'FACTORIO-TEST-EVENT:{"type":"testPassed","test":{"path":"root > test","duration":"1.23 ms"}}'
    const result = parseEvent(line)
    expect(result).toEqual({
      type: "testPassed",
      test: { path: "root > test", duration: "1.23 ms" },
    })
  })

  it("parses testFailed event with errors", () => {
    const line = 'FACTORIO-TEST-EVENT:{"type":"testFailed","test":{"path":"test"},"errors":["error1","error2"]}'
    const result = parseEvent(line)
    expect(result).toEqual({
      type: "testFailed",
      test: { path: "test" },
      errors: ["error1", "error2"],
    })
  })

  it("returns undefined for non-event lines", () => {
    expect(parseEvent("some random log line")).toBeUndefined()
    expect(parseEvent("FACTORIO-TEST-MESSAGE-START")).toBeUndefined()
    expect(parseEvent("")).toBeUndefined()
  })

  it("returns undefined for malformed JSON", () => {
    expect(parseEvent("FACTORIO-TEST-EVENT:{not valid json}")).toBeUndefined()
    expect(parseEvent("FACTORIO-TEST-EVENT:")).toBeUndefined()
  })
})

describe("FactorioOutputHandler", () => {
  it("getResultMessage returns undefined before result received", () => {
    const handler = new FactorioOutputHandler()
    expect(handler.getResultMessage()).toBeUndefined()
  })

  it("getResultMessage returns result after receiving FACTORIO-TEST-RESULT", () => {
    const handler = new FactorioOutputHandler()
    handler.handleLine("FACTORIO-TEST-RESULT:passed")
    expect(handler.getResultMessage()).toBe("passed")
  })

  it("emits result event with message", () => {
    const handler = new FactorioOutputHandler()
    const results: string[] = []
    handler.on("result", (msg) => results.push(msg))
    handler.handleLine("FACTORIO-TEST-RESULT:failed:focused")
    expect(results).toEqual(["failed:focused"])
    expect(handler.getResultMessage()).toBe("failed:focused")
  })
})

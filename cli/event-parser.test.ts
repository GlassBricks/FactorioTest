import { describe, it, expect } from "vitest"
import { parseEvent } from "./event-parser.js"

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

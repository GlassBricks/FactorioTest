import { TestRunnerEvent } from "../types/events.js"

const EVENT_PREFIX = "FACTORIO-TEST-EVENT:"

export function parseEvent(line: string): TestRunnerEvent | undefined {
  if (!line.startsWith(EVENT_PREFIX)) {
    return undefined
  }
  try {
    return JSON.parse(line.slice(EVENT_PREFIX.length)) as TestRunnerEvent
  } catch {
    return undefined
  }
}

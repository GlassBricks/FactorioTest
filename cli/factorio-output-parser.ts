import { EventEmitter } from "events"
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

interface FactorioOutputEvents {
  event: [TestRunnerEvent]
  log: [string]
  message: [string]
  result: [string]
}

export class FactorioOutputHandler extends EventEmitter<FactorioOutputEvents> {
  private inMessage = false
  private resultMessage: string | undefined

  getResultMessage(): string | undefined {
    return this.resultMessage
  }

  handleLine(line: string): void {
    if (line.startsWith("FACTORIO-TEST-RESULT:")) {
      this.resultMessage = line.slice("FACTORIO-TEST-RESULT:".length)
      this.emit("result", this.resultMessage)
      return
    }

    if (line === "FACTORIO-TEST-MESSAGE-START") {
      this.inMessage = true
      return
    }
    if (line === "FACTORIO-TEST-MESSAGE-END") {
      this.inMessage = false
      return
    }

    const event = parseEvent(line)
    if (event) {
      this.emit("event", event)
      return
    }

    if (this.inMessage) {
      this.emit("message", line)
    } else {
      this.emit("log", line)
    }
  }
}

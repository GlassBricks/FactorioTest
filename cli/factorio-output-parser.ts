import { EventEmitter } from "events"
import { TestRunnerEvent } from "../types/events.js"

/**
 * The stdout wire protocol. Mirrored by mod/constants.d.ts.
 */
export const enum Protocol {
  Event = "FACTORIO-TEST-EVENT:",
  Result = "FACTORIO-TEST-RESULT:",
  MessageStart = "FACTORIO-TEST-MESSAGE-START",
  MessageEnd = "FACTORIO-TEST-MESSAGE-END",
}

/** Sub-protocol within a result message. */
export const BAILED_PREFIX = "bailed:"
export const FOCUSED_SUFFIX = ":focused"

export function parseEvent(line: string): TestRunnerEvent | undefined {
  if (!line.startsWith(Protocol.Event)) {
    return undefined
  }
  try {
    return JSON.parse(line.slice(Protocol.Event.length)) as TestRunnerEvent
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
    if (line.startsWith(Protocol.Result)) {
      this.resultMessage = line.slice(Protocol.Result.length)
      this.emit("result", this.resultMessage)
      return
    }

    if (line === Protocol.MessageStart) {
      this.inMessage = true
      return
    }
    if (line === Protocol.MessageEnd) {
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

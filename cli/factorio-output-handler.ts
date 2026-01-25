import { EventEmitter } from "events"
import { parseEvent } from "./event-parser.js"
import { TestRunnerEvent } from "../types/events.js"

interface FactorioOutputEvents {
  event: [TestRunnerEvent]
  log: [string]
  message: [string]
  result: [string]
}

export class FactorioOutputHandler extends EventEmitter<FactorioOutputEvents> {
  private inMessage = false

  handleLine(line: string): void {
    if (line.startsWith("FACTORIO-TEST-RESULT:")) {
      this.emit("result", line.slice("FACTORIO-TEST-RESULT:".length))
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

import { EventEmitter } from "events"
import { Readable } from "stream"

export default class BufferReadLine extends EventEmitter {
  private buf: string

  constructor(instream: Readable) {
    super()
    this.buf = ""
    instream.on("close", () => {
      if (this.buf.length > 0) this.emit("line", this.buf)
      this.emit("close")
    })
    instream.on("end", () => {
      if (this.buf.length > 0) this.emit("line", this.buf)
      this.emit("end")
    })
    instream.on("data", (chunk: Buffer) => {
      this.buf += chunk.toString()
      while (this.buf.length > 0) {
        const index = this.buf.indexOf("\n")
        if (index !== -1) {
          this.emit("line", this.buf.slice(0, index))
          this.buf = this.buf.slice(index + 1)
        }
      }
    })
  }
   on(event: "line", listener: (line: string) => void): this {
    return super.on(event, listener)
   }
}

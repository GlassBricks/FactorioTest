// Usage test mod result: passed

import * as child_process from "child_process"
import { fileURLToPath } from "url"
import * as path from "path"
import { EventEmitter } from "events"
import { Readable } from "stream"

export default class BufferLineSplitter extends EventEmitter {
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

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, "..")

const child = child_process.spawn(
  "npx",
  [
    "ts-node",
    "--esm",
    "cli/cli.ts",
    "run",
    "--mod-path",
    "./usage-test-mod",
    ...process.argv.slice(2)
  ],
  {
    stdio: ["inherit", "pipe", "inherit"],
    cwd: root,
  },
)
let passed = false
new BufferLineSplitter(child.stdout)?.on("line", (data) => {
  const str = data.toString()
  if (str.includes("Usage test mod result: passed")) {
    passed = true
  }
  console.log(str)
})

const promise = new Promise<void>((resolve, reject) => {
  child.on("exit", (code) => {
    if (code === 1) {
      resolve()
    } else {
      reject(new Error(`Command did not exit with code 1`))
    }
  })
})

await promise

console.log("Test passed:", passed)

process.exit(passed ? 0 : 1)

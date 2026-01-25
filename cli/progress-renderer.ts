import chalk from "chalk"
import logUpdate from "log-update"
import { TestRunnerEvent } from "../types/events.js"
import { CapturedTest } from "./test-run-collector.js"

export class ProgressRenderer {
  private readonly isTTY: boolean
  private active = false
  private total = 0
  private ran = 0
  private passed = 0
  private failed = 0
  private skipped = 0
  private todo = 0
  private currentTest?: string

  constructor(isTTY = process.stdout.isTTY ?? false) {
    this.isTTY = isTTY
  }

  handleEvent(event: TestRunnerEvent): void {
    if (event.type === "testRunStarted") {
      this.total = event.total
    } else if (event.type === "testStarted") {
      this.currentTest = event.test.path
      this.render()
    }
  }

  handleTestFinished(test: CapturedTest): void {
    this.currentTest = undefined
    this.ran++
    if (test.result === "passed") this.passed++
    else if (test.result === "failed") this.failed++
    else if (test.result === "skipped") this.skipped++
    else if (test.result === "todo") this.todo++
  }

  withPermanentOutput(callback: () => void): void {
    if (!this.isTTY || !this.active) {
      callback()
      return
    }
    logUpdate.clear()
    callback()
    this.render()
  }

  finish(): void {
    if (this.active) logUpdate.clear()
  }

  private render(): void {
    if (!this.isTTY) return
    this.active = true

    const percent = this.total > 0 ? Math.floor((this.ran / this.total) * 100) : 0
    const barWidth = 20
    const filled = Math.floor((percent / 100) * barWidth)
    const bar = "█".repeat(filled) + "░".repeat(barWidth - filled)

    const counts = [
      chalk.green(`✓${this.passed}`),
      this.failed > 0 ? chalk.red(`✗${this.failed}`) : null,
      this.skipped > 0 ? chalk.yellow(`○${this.skipped}`) : null,
      this.todo > 0 ? chalk.magenta(`◌${this.todo}`) : null,
    ]
      .filter(Boolean)
      .join(" ")

    const progress = `[${bar}] ${percent}%  ${this.ran}/${this.total}  ${counts}`
    const current = this.currentTest ? `Running: ${this.currentTest}` : ""

    logUpdate(progress + "\n" + current)
  }
}

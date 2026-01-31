import chalk from "chalk"
import logUpdate from "log-update"
import { TestRunnerEvent, TestRunSummary } from "../types/events.js"
import type { CapturedTest, TestRunData } from "./test-results.js"

export type { CapturedTest, TestRunData }

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
    if (test.result === "passed") {
      this.ran++
      this.passed++
    } else if (test.result === "failed") {
      this.ran++
      this.failed++
    } else if (test.result === "skipped") {
      this.skipped++
    } else if (test.result === "todo") {
      this.todo++
    }
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
    const filled = Math.min(barWidth, Math.floor((percent / 100) * barWidth))
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
    const current = this.currentTest ? `Running: ${this.currentTest}` : " "

    logUpdate(progress + "\n" + current)
  }
}

function formatDuration(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(2)}s`
  }
  return `${ms.toFixed(1)}ms`
}

export interface FormatterOptions {
  verbose?: boolean
  quiet?: boolean
  showPassedLogs?: boolean
}

export class OutputFormatter {
  constructor(private options: FormatterOptions) {}

  formatTestResult(test: CapturedTest): void {
    if (this.options.quiet) return

    const showLogs = test.result === "failed" || this.options.showPassedLogs

    if (showLogs && test.logs.length > 0) {
      for (const log of test.logs) {
        console.log("    " + log)
      }
    }

    const prefix = this.getPrefix(test.result)
    const duration = test.durationMs !== undefined ? ` (${formatDuration(test.durationMs)})` : ""
    console.log(`${prefix} ${test.path}${duration}`)

    if (test.result === "failed") {
      for (const error of test.errors) {
        console.log("    " + error)
      }
    }
  }

  formatSummary(data: TestRunData): void {
    if (!data.summary) return

    if (!this.options.quiet) {
      this.printRecapSection(data.tests, "failed", "Failures:")
      this.printRecapSection(data.tests, "todo", "Todo:")
    }
    this.printCountsLine(data.summary)
  }

  private printRecapSection(tests: CapturedTest[], result: CapturedTest["result"], header: string): void {
    const matching = tests.filter((t) => t.result === result)
    if (matching.length === 0) return

    console.log()
    console.log(header)
    console.log()
    for (const test of matching) {
      this.formatTestResult(test)
    }
  }

  private printCountsLine(summary: TestRunSummary): void {
    const segments: string[] = []
    if (summary.failed > 0) segments.push(chalk.red(`${summary.failed} failed`))
    if (summary.todo > 0) segments.push(chalk.magenta(`${summary.todo} todo`))
    if (summary.skipped > 0) segments.push(chalk.yellow(`${summary.skipped} skipped`))
    segments.push(chalk.green(`${summary.passed} passed`))

    const total = summary.passed + summary.failed + summary.skipped + summary.todo
    console.log(`Tests: ${segments.join(", ")} (${total} total)`)
  }

  private getPrefix(result: CapturedTest["result"]): string {
    switch (result) {
      case "passed":
        return chalk.green("PASS")
      case "failed":
        return chalk.red("FAIL")
      case "skipped":
        return chalk.yellow("SKIP")
      case "todo":
        return chalk.magenta("TODO")
    }
  }
}

export interface OutputPrinterOptions {
  verbose?: boolean
  quiet?: boolean
}

export class OutputPrinter {
  private formatter: OutputFormatter
  private isMessageFirstLine = true

  constructor(private options: OutputPrinterOptions) {
    this.formatter = new OutputFormatter({
      verbose: options.verbose,
      quiet: options.quiet,
      showPassedLogs: options.verbose,
    })
  }

  printTestResult(test: CapturedTest): void {
    if (this.options.quiet) return
    if (test.result === "skipped" && !this.options.verbose) return
    this.formatter.formatTestResult(test)
  }

  printMessage(line: string): void {
    if (this.options.quiet) return
    if (this.isMessageFirstLine) {
      console.log(line.slice(line.indexOf(": ") + 2))
      this.isMessageFirstLine = false
    } else {
      console.log("    " + line)
    }
  }

  resetMessage(): void {
    this.isMessageFirstLine = true
  }

  printVerbose(line: string): void {
    if (this.options.verbose) {
      console.log(line)
    }
  }
}

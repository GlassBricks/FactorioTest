import chalk from "chalk"
import { CapturedTest, TestRunData } from "./test-run-collector.js"

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
    const { status } = data.summary
    const color = status === "passed" ? chalk.greenBright : status === "todo" ? chalk.yellowBright : chalk.redBright
    console.log("Test run result:", color(status))
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

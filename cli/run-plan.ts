import { CliError } from "./cli-error.js"
import type { ResolvedConfig } from "./config/index.js"
import type { FactorioTestResult } from "./factorio-process.js"

export function validateModSource(config: Pick<ResolvedConfig, "modPath" | "modName">): void {
  if (config.modPath !== undefined && config.modName !== undefined) {
    throw new CliError("Only one of --mod-path or --mod-name can be specified.")
  }
  if (config.modPath === undefined && config.modName === undefined) {
    throw new CliError("One of --mod-path or --mod-name must be specified.")
  }
}

export function validateRunConfig(
  config: Pick<ResolvedConfig, "modPath" | "modName" | "autoStart" | "graphics" | "step">,
): void {
  validateModSource(config)
  if (!config.autoStart && !config.graphics) {
    throw new CliError("--no-auto-start requires --graphics.")
  }
  if (config.step && !config.graphics) {
    throw new CliError("Step mode requires --graphics: there is no in-game GUI to continue from otherwise.")
  }
}

export interface RunOutcome {
  exitCode: 0 | 1
  status: string
  bailed: boolean
  forbiddenFocusedTests: boolean
}

export function resolveRunOutcome(
  result: Pick<FactorioTestResult, "status" | "hasFocusedTests">,
  forbidOnly: boolean,
): RunOutcome {
  if (result.status === "cancelled") {
    return { exitCode: 0, status: "cancelled", bailed: false, forbiddenFocusedTests: false }
  }
  const bailed = result.status === "bailed"
  const status = bailed ? "failed" : result.status
  const forbiddenFocusedTests = result.hasFocusedTests && forbidOnly
  const exitCode = status === "passed" && !forbiddenFocusedTests ? 0 : 1
  return { exitCode, status, bailed, forbiddenFocusedTests }
}

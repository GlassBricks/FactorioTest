import { CliError } from "./cli-error.js"
import type { ResolvedConfig } from "./config/index.js"
import type { FactorioTestResult } from "./factorio-process.js"
import { DLC_MODS, type ModRequirement, parseModRequirement, parseModSpecName } from "./mod-setup.js"

export function validateRunConfig(
  config: Pick<ResolvedConfig, "modPath" | "modName" | "noAutoStart" | "graphics">,
): void {
  if (config.modPath !== undefined && config.modName !== undefined) {
    throw new CliError("Only one of --mod-path or --mod-name can be specified.")
  }
  if (config.modPath === undefined && config.modName === undefined) {
    throw new CliError("One of --mod-path or --mod-name must be specified.")
  }
  if (config.noAutoStart && !config.graphics) {
    throw new CliError("--no-auto-start requires --graphics.")
  }
}

const MOD_STATE_SPEC = /^\S+=(?:true|false)$/

export interface ModSetupInput {
  modToTest: string
  modDependencies: string[]
  configMods?: string[]
}

export interface ModSetupPlan {
  toInstall: ModRequirement[]
  enableArgs: string[]
}

export function planModSetup({ modToTest, modDependencies, configMods = [] }: ModSetupInput): ModSetupPlan {
  const toInstall = configMods
    .filter((m) => !MOD_STATE_SPEC.test(m))
    .map(parseModRequirement)
    .filter((r) => r !== undefined)

  const configuredMods = new Set([modToTest, ...modDependencies, ...configMods.map(parseModSpecName)])
  const enableArgs = [
    ...DLC_MODS.filter((m) => !configuredMods.has(m)).map((m) => `${m}=false`),
    "factorio-test=true",
    `${modToTest}=true`,
    ...modDependencies.map((m) => `${m}=true`),
    ...configMods.map((m) => (MOD_STATE_SPEC.test(m) ? m : `${m.split(/\s/)[0]}=true`)),
  ]

  return { toInstall, enableArgs }
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

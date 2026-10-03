import { CliError } from "./cli-error.js"
import type { ResolvedConfig } from "./config/index.js"
import type { FactorioTestResult } from "./factorio-process.js"
import {
  DLC_MODS,
  type ModRequirement,
  parseModRequirement,
  parseModSpecName,
  withDlcDependencies,
} from "./mod-setup.js"

export function validateRunConfig(
  config: Pick<ResolvedConfig, "modPath" | "modName" | "autoStart" | "graphics" | "step">,
): void {
  if (config.modPath !== undefined && config.modName !== undefined) {
    throw new CliError("Only one of --mod-path or --mod-name can be specified.")
  }
  if (config.modPath === undefined && config.modName === undefined) {
    throw new CliError("One of --mod-path or --mod-name must be specified.")
  }
  if (!config.autoStart && !config.graphics) {
    throw new CliError("--no-auto-start requires --graphics.")
  }
  if (config.step && !config.graphics) {
    throw new CliError("Step mode requires --graphics: there is no in-game GUI to continue from otherwise.")
  }
}

const MOD_STATE_SPEC = /^\S+=(?:true|false)$/
const MOD_DISABLED_SPEC = /^\S+=false$/

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

  const explicitMods = new Set([modToTest, ...modDependencies, ...configMods.map(parseModSpecName)])
  const requiredMods = withDlcDependencies([
    modToTest,
    ...modDependencies,
    ...configMods.filter((m) => !MOD_DISABLED_SPEC.test(m)).map(parseModSpecName),
  ])
  const enableArgs = [
    ...DLC_MODS.filter((m) => !explicitMods.has(m)).map((m) => `${m}=${requiredMods.has(m)}`),
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

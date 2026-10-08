import * as path from "path"
import { CliError } from "./cli-error.js"
import type { ResolvedConfig } from "./config/index.js"
import type { FactorioTestResult } from "./factorio-process.js"

export type TestTarget =
  | { kind: "mod"; modPath?: string; modName?: string }
  | { kind: "scenario"; ref: string; scenarioPath?: string; providingModPath?: string }

export type World = { kind: "bundled" } | { kind: "save"; path: string } | { kind: "scenario"; ref: string }

export interface RunPlan {
  target: TestTarget
  world: World
}

type TargetConfig = Pick<ResolvedConfig, "modPath" | "modName" | "scenarioPath" | "scenario">
type PlanConfig = TargetConfig & Pick<ResolvedConfig, "save" | "startScenario">

/** The mod a `MOD/NAME` scenario ref is from; undefined for a scenario in the data dir. */
export function scenarioRefMod(ref: string): string | undefined {
  const slash = ref.indexOf("/")
  return slash === -1 ? undefined : ref.slice(0, slash)
}

function resolveTarget({ modPath, modName, scenarioPath, scenario }: TargetConfig): TestTarget {
  const given = [modPath, modName, scenarioPath, scenario].filter((value) => value !== undefined).length
  if (given === 0) {
    throw new CliError("One of --mod-path, --mod-name, --scenario-path or --scenario must be specified.")
  }
  const providesScenarioMod =
    given === 2 && modPath !== undefined && scenario !== undefined && !!scenarioRefMod(scenario)
  if (given > 1 && !providesScenarioMod) {
    throw new CliError(
      "Specify one of --mod-path, --mod-name, --scenario-path or --scenario (exception: --mod-path with --scenario <that mod>/<name>).",
    )
  }
  if (scenario !== undefined) return { kind: "scenario", ref: scenario, providingModPath: modPath }
  if (scenarioPath !== undefined) return { kind: "scenario", ref: path.basename(scenarioPath), scenarioPath }
  return { kind: "mod", modPath, modName }
}

function resolveWorld(target: TestTarget, { save, startScenario }: PlanConfig): World {
  if (target.kind === "scenario") {
    const flag = save !== undefined ? "--save" : startScenario !== undefined ? "--start-scenario" : undefined
    if (flag) {
      throw new CliError(`${flag} can't be used when testing a scenario: tests start in a new game from the scenario.`)
    }
    return { kind: "scenario", ref: target.ref }
  }
  if (save !== undefined && startScenario !== undefined) {
    throw new CliError("Only one of --save or --start-scenario can be specified.")
  }
  if (save !== undefined) return { kind: "save", path: save }
  if (startScenario !== undefined) return { kind: "scenario", ref: startScenario }
  return { kind: "bundled" }
}

export function resolveRunPlan(config: PlanConfig): RunPlan {
  const target = resolveTarget(config)
  return { target, world: resolveWorld(target, config) }
}

/** TGT-2: the `--mod-path` mod must be the one `--scenario <MOD>/<NAME>` is from. */
export function checkProvidingMod(ref: string, providedModName: string): void {
  const refMod = scenarioRefMod(ref)
  if (refMod === providedModName) return
  throw new CliError(`--scenario ${ref} is from mod "${refMod}", but --mod-path is mod "${providedModName}".`)
}

/**
 * TGT-4, WORLD-1: a mod's scenario needs that mod enabled; Factorio would load the scenario with the mod
 * disabled, failing later.
 */
export function checkScenarioModEnabled({ target, world }: RunPlan, enabled: ReadonlyMap<string, unknown>): void {
  if (world.kind !== "scenario") return
  const mod = scenarioRefMod(world.ref)
  if (mod === undefined || enabled.has(mod)) return
  const [flag, fix] =
    target.kind === "scenario"
      ? ["--scenario", "Add --mod-path, or list it in --mods."]
      : ["--start-scenario", "List it in --mods."]
  throw new CliError(`${flag} ${world.ref} needs mod "${mod}". ${fix}`)
}

/** The id the mod side knows the test target by (DES-6): the mod name, or "level" for a scenario. */
export function targetId(target: TestTarget, modToTest: string | undefined): string {
  if (target.kind === "scenario") return "level"
  if (modToTest === undefined) throw new Error("A mod target has a mod to test")
  return modToTest
}

export function validateRunConfig(
  config: PlanConfig & Pick<ResolvedConfig, "autoStart" | "graphics" | "step">,
): RunPlan {
  const plan = resolveRunPlan(config)
  if (!config.autoStart && !config.graphics) {
    throw new CliError("--no-auto-start requires --graphics.")
  }
  if (config.step && !config.graphics) {
    throw new CliError("Step mode requires --graphics: there is no in-game GUI to continue from otherwise.")
  }
  return plan
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

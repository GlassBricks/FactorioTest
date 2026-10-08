import type { Command } from "@commander-js/extra-typings"
import chalk from "chalk"
import * as dgram from "dgram"
import { CliError } from "./cli-error.js"
import { registerAllCliOptions, resolveConfig, type ResolvedConfig, toModConfig } from "./config/index.js"
import {
  buildLaunchSteps,
  FactorioTestResult,
  getHeadlessSavePath,
  type LaunchSteps,
  runFactorioTestsGraphics,
  runFactorioTestsHeadless,
  runScenario2Map,
} from "./factorio-process.js"
import {
  ensureConfigIni,
  ensureModSettingsDat,
  resetAutorunSettings,
  resolveWatchTarget,
  type RunMode,
  setModToTestSetting,
  setSettingsForAutorun,
  setTestConfigSetting,
} from "./factorio-setup.js"
import { watchDirectory, watchFile } from "./file-watcher.js"
import { modSetupInput } from "./mods-command.js"
import { checkScenarioExists, linkScenario } from "./link.js"
import { enableMods, type InstalledMods, installMods, readModName } from "./mods/install.js"
import { FACTORIO_TEST } from "./mods/lock.js"
import { setVerbose } from "./process-utils.js"
import { createRerunLoop } from "./rerun-loop.js"
import {
  checkProvidingMod,
  checkScenarioModEnabled,
  resolveRunOutcome,
  type RunOutcome,
  type RunPlan,
  scenarioRefMod,
  targetId,
  type TestTarget,
  validateRunConfig,
} from "./run-plan.js"
import { OutputFormatter } from "./test-output.js"
import { readPreviousFailedTests, writeResultsFile } from "./test-results.js"

export function registerRunCommand(program: Command, onExitCode: (exitCode: number) => void): void {
  const runCommand = program
    .command("run")
    .summary("Runs tests with Factorio test.")
    .description(
      `Runs tests for the specified mod or scenario with Factorio test. Exits with code 0 only if all tests pass.
One of --mod-path, --mod-name, --scenario-path or --scenario is required.

JSON configuration:
  Instead of using command-line arguments, you can configure the test runner using a JSON file.
  By default, the CLI will look for a factorio-test.json file or a "factorio-test" key in
  package.json. You can specify a custom file using the --config option.
  Keys are the camelCase form of the long option names. CLI arguments override file config.
  Test execution options also override the in-mod (Lua) config.
    {
      "modPath": "./my-mod",
      "bail": 1,
      "gameSpeed": 100,
      "tagBlacklist": ["slow"]
    }

Test filter patterns:
  Filter patterns use Lua pattern syntax (not regex). Special characters like -
  must be escaped with %:
    factorio-test run -p ./my-mod "foo > my%-test"
  Multiple filters (including --test-pattern) run tests matching any of them.
  When using variadic options (--mods, --factorio-args, etc.) with filter
  patterns, use -- to separate them:
    factorio-test run -p ./my-mod --mods quality space-age -- "inventory"

Examples:
  factorio-test run -p ./my-mod                                Run all tests
  factorio-test run -p ./my-mod -v                             Run with verbose output
  factorio-test run -p ./my-mod -gw                            Run with graphics in watch mode
  factorio-test run -p ./my-mod -g --step                      Walk the run step by step, in a window
  factorio-test run -p ./my-mod -b                             Bail on first failure
  factorio-test run -p ./my-mod "inventory"                    Run tests matching "inventory"
  factorio-test run --scenario-path ./my-scenario              Test a scenario
  factorio-test run -p ./my-mod --start-scenario base/freeplay Run mod tests in a new freeplay game
`,
    )
    .argument("[filter...]", "Lua patterns to filter tests (OR logic)")

  registerAllCliOptions(runCommand)

  runCommand.action(async (patterns, options) =>
    onExitCode(await runTests(patterns, options as Record<string, unknown>)),
  )
}

interface TestRunContext {
  config: ResolvedConfig
  plan: RunPlan
  factorioPath: string
  dataDir: string
  modsDir: string
  installedMods: InstalledMods
  /** The mod name, or "level" for a scenario (DES-6). */
  testId: string
  mode: RunMode
  launch: LaunchSteps
}

async function setupTestRun(patterns: string[], cliOptions: Record<string, unknown>): Promise<TestRunContext> {
  const config = resolveConfig({ cliOptions, patterns })

  setVerbose(!!config.verbose)
  const plan = validateRunConfig(config)

  const modSetup = modSetupInput(config, cliOptions)
  const { factorioPath, modsDir } = modSetup
  const dataDir = config.dataDirectory
  await prepareScenarioTarget(plan.target, dataDir)
  const installedMods = await installMods(modSetup)
  checkScenarioModEnabled(plan, installedMods.resolution.enabled)
  await enableMods(modsDir, installedMods)
  await ensureConfigIni(dataDir)

  const mode = config.graphics ? "graphics" : "headless"
  const launch = buildLaunchSteps(plan, mode, {
    dataDir,
    bundledSave: getHeadlessSavePath(installedMods.game.version),
    factorioArgs: config.factorioArgs ?? [],
    testArgs: config.watch && config.graphics ? [`--enable-lua-udp=${config.udpPort}`] : [],
  })
  const testId = targetId(plan.target, installedMods.modToTest)

  return { config, plan, factorioPath, dataDir, modsDir, installedMods, testId, mode, launch }
}

/** Links or checks the scenario under test (TGT-2, TGT-5, TGT-6). */
async function prepareScenarioTarget(target: TestTarget, dataDir: string): Promise<void> {
  if (target.kind !== "scenario") return
  if (target.scenarioPath !== undefined) {
    await linkScenario(dataDir, target.scenarioPath)
  } else if (target.providingModPath !== undefined) {
    checkProvidingMod(target.ref, await readModName(target.providingModPath))
  } else if (scenarioRefMod(target.ref) === undefined) {
    await checkScenarioExists(dataDir, target.ref)
  }
}

/** DES-2: the save is created without factorio-test, which is enabled again for the test launch. */
async function createScenarioSave(ctx: TestRunContext): Promise<void> {
  const { factorioPath, modsDir, installedMods, launch, config } = ctx
  if (!launch.scenario2map) return
  await enableMods(modsDir, installedMods, [FACTORIO_TEST])
  try {
    await runScenario2Map(factorioPath, launch.scenario2map, config.verbose)
  } finally {
    await enableMods(modsDir, installedMods)
  }
}

interface ExecuteOptions {
  signal?: AbortSignal
  skipResetAutorun?: boolean
  resolveOnResult?: boolean
}

async function executeTestRun(ctx: TestRunContext, execOptions?: ExecuteOptions): Promise<RunOutcome> {
  const { config, factorioPath, dataDir, modsDir, testId, mode, launch } = ctx
  const { signal, skipResetAutorun, resolveOnResult } = execOptions ?? {}

  await createScenarioSave(ctx)

  const lastFailedTests =
    config.reorderFailedFirst && config.outputFile ? await readPreviousFailedTests(config.outputFile) : []

  await setSettingsForAutorun(factorioPath, dataDir, modsDir, testId, mode, {
    verbose: config.verbose,
    lastFailedTests,
  })
  await setTestConfigSetting(modsDir, toModConfig(config))

  let result: FactorioTestResult
  try {
    result =
      mode === "headless"
        ? await runFactorioTestsHeadless(factorioPath, dataDir, launch.test.args, {
            verbose: config.verbose,
            quiet: config.quiet,
            signal,
            outputTimeout: config.outputTimeout,
          })
        : await runFactorioTestsGraphics(factorioPath, dataDir, launch.test.args, {
            verbose: config.verbose,
            quiet: config.quiet,
            resolveOnResult,
          })
  } finally {
    if (!skipResetAutorun) {
      await resetAutorunSettings(modsDir, config.verbose)
    }
  }

  const outcome = resolveRunOutcome(result, config.forbidOnly)
  if (outcome.status === "cancelled") return outcome

  if (config.outputFile && result.data) {
    await writeResultsFile(config.outputFile, testId, result.data)
    if (config.verbose) console.log(`Results written to ${config.outputFile}`)
  }

  if (outcome.bailed) {
    console.log(chalk.yellow(`Bailed out after ${config.bail} failure(s)`))
  }
  if (result.data) {
    new OutputFormatter({ quiet: config.quiet }).formatSummary(result.data)
  }
  if (outcome.forbiddenFocusedTests) {
    console.log(chalk.redBright("Error: .only tests are present but --forbid-only is enabled"))
  }

  return outcome
}

async function runGraphicsWatchMode(ctx: TestRunContext): Promise<never> {
  const target = await resolveWatchTarget(ctx.plan, ctx.dataDir, ctx.modsDir)
  console.log(chalk.gray(`Watching ${target.path} for patterns: ${ctx.config.watchPatterns.join(", ")}`))

  await executeTestRun(ctx, { skipResetAutorun: true, resolveOnResult: true })

  const udpClient = dgram.createSocket("udp4")
  const onFileChange = () => {
    console.log(chalk.cyan("File change detected, triggering rerun..."))
    udpClient.send("rerun", ctx.config.udpPort, "127.0.0.1")
  }

  const watcher =
    target.type === "directory"
      ? watchDirectory(target.path, onFileChange, { patterns: ctx.config.watchPatterns })
      : watchFile(target.path, onFileChange)

  process.on("SIGINT", () => {
    watcher.close()
    udpClient.close()
    process.exit(0)
  })

  return new Promise(() => {})
}

async function runHeadlessWatchMode(ctx: TestRunContext): Promise<never> {
  const target = await resolveWatchTarget(ctx.plan, ctx.dataDir, ctx.modsDir)

  const loop = createRerunLoop(async (signal) => {
    console.log("\n" + "─".repeat(60))
    try {
      await executeTestRun(ctx, { signal })
    } catch (e) {
      if (!(e instanceof CliError)) throw e
      console.error(chalk.red(e.message))
    }
  })

  await loop.trigger()

  const onFileChange = () => {
    console.log(chalk.cyan("File change detected, rerunning tests..."))
    void loop.trigger()
  }

  const watcher =
    target.type === "directory"
      ? watchDirectory(target.path, onFileChange, { patterns: ctx.config.watchPatterns })
      : watchFile(target.path, onFileChange)

  process.on("SIGINT", () => {
    watcher.close()
    process.exit(0)
  })

  return new Promise(() => {})
}

async function launchWithoutAutoStart(ctx: TestRunContext): Promise<void> {
  const { config, factorioPath, dataDir, modsDir, testId, launch } = ctx

  await createScenarioSave(ctx)
  await ensureModSettingsDat(factorioPath, dataDir, modsDir, config.verbose)
  await setModToTestSetting(modsDir, testId)
  await setTestConfigSetting(modsDir, toModConfig(config))

  await runFactorioTestsGraphics(factorioPath, dataDir, launch.test.args, {
    verbose: config.verbose,
    quiet: config.quiet,
  })
}

async function runTests(patterns: string[], cliOptions: Record<string, unknown>): Promise<number> {
  const ctx = await setupTestRun(patterns, cliOptions)

  if (!ctx.config.autoStart) {
    await launchWithoutAutoStart(ctx)
    return 0
  }
  if (ctx.config.watch && ctx.config.graphics) return runGraphicsWatchMode(ctx)
  if (ctx.config.watch) return runHeadlessWatchMode(ctx)

  const outcome = await executeTestRun(ctx)
  return outcome.exitCode
}

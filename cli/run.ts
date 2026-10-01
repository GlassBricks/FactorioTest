import type { Command } from "@commander-js/extra-typings"
import chalk from "chalk"
import * as dgram from "dgram"
import * as fsp from "fs/promises"
import * as path from "path"
import { CliError } from "./cli-error.js"
import { registerAllCliOptions, resolveConfig, type ResolvedConfig } from "./config/index.js"
import {
  autoDetectFactorioPath,
  FactorioTestResult,
  getHeadlessSavePath,
  runFactorioTestsGraphics,
  runFactorioTestsHeadless,
} from "./factorio-process.js"
import { watchDirectory, watchFile } from "./file-watcher.js"
import {
  adjustEnabledMods,
  configureModToTest,
  ensureConfigIni,
  ensureModSettingsDat,
  installFactorioTest,
  installModDependencies,
  installMods,
  resetAutorunSettings,
  resolveModWatchTarget,
  type RunMode,
  setModToTestSetting,
  setSettingsForAutorun,
  setTestConfigSetting,
} from "./mod-setup.js"
import { setVerbose } from "./process-utils.js"
import { createRerunLoop } from "./rerun-loop.js"
import { planModSetup, resolveRunOutcome, type RunOutcome, validateRunConfig } from "./run-plan.js"
import { OutputFormatter } from "./test-output.js"
import { readPreviousFailedTests, writeResultsFile } from "./test-results.js"

export function registerRunCommand(program: Command, onExitCode: (exitCode: number) => void): void {
  const runCommand = program
    .command("run")
    .summary("Runs tests with Factorio test.")
    .description(
      `Runs tests for the specified mod with Factorio test. Exits with code 0 only if all tests pass.
One of --mod-path or --mod-name is required.

JSON configuration:
  Instead of using command-line arguments, you can configure the test runner using a JSON file.
  By default, the CLI will look for a factorio-test.json file or a "factorio-test" key in
  package.json. You can specify a custom file using the --config option.
  CLI arguments override file config.
  Test execution options (options that can also be specified in the mod itself) go under the
  "test" key using snake_case, overriding in-mod config.
    {
      "modPath": "./my-mod",
      "test": { "bail": 1, "game_speed": 100, "tag_blacklist": ["slow"] }
    }

Test filter patterns:
  Filter patterns use Lua pattern syntax (not regex). Special characters like -
  must be escaped with %:
    factorio-test run -p ./my-mod "foo > my%-test"
  When using variadic options (--mods, --factorio-args, etc.) with filter
  patterns, use -- to separate them:
    factorio-test run -p ./my-mod --mods quality space-age -- "inventory"

Examples:
  factorio-test run -p ./my-mod             Run all tests
  factorio-test run -p ./my-mod -v          Run with verbose output
  factorio-test run -p ./my-mod -gw         Run with graphics in watch mode
  factorio-test run -p ./my-mod -b          Bail on first failure
  factorio-test run -p ./my-mod "inventory" Run tests matching "inventory"
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
  factorioPath: string
  dataDir: string
  modsDir: string
  modToTest: string
  mode: RunMode
  savePath: string
  factorioArgs: string[]
}

async function setupTestRun(patterns: string[], cliOptions: Record<string, unknown>): Promise<TestRunContext> {
  const config = resolveConfig({ cliOptions, patterns })

  setVerbose(!!config.verbose)
  validateRunConfig(config)

  const factorioPath = config.factorioPath ?? autoDetectFactorioPath()
  const dataDir = config.dataDirectory
  const modsDir = path.join(dataDir, "mods")
  await fsp.mkdir(modsDir, { recursive: true })

  const modToTest = await configureModToTest(modsDir, config.modPath, config.modName, config.verbose)
  const modDependencies = config.modPath ? await installModDependencies(modsDir, path.resolve(config.modPath)) : []
  await installFactorioTest(modsDir)

  const { toInstall, enableArgs } = planModSetup({ modToTest, modDependencies, configMods: config.mods })
  if (toInstall.length > 0) {
    await installMods(modsDir, toInstall)
  }

  if (config.verbose) console.log("Adjusting mods")
  await adjustEnabledMods(modsDir, enableArgs)
  await ensureConfigIni(dataDir)

  const mode = config.graphics ? "graphics" : "headless"
  const savePath = getHeadlessSavePath(config.save)

  const factorioArgs = [...(config.factorioArgs ?? [])]
  if (config.watch && config.graphics) {
    factorioArgs.push(`--enable-lua-udp=${config.udpPort}`)
  }

  return { config, factorioPath, dataDir, modsDir, modToTest, mode, savePath, factorioArgs }
}

interface ExecuteOptions {
  signal?: AbortSignal
  skipResetAutorun?: boolean
  resolveOnResult?: boolean
}

async function executeTestRun(ctx: TestRunContext, execOptions?: ExecuteOptions): Promise<RunOutcome> {
  const { config, factorioPath, dataDir, modsDir, modToTest, mode, savePath, factorioArgs } = ctx
  const { signal, skipResetAutorun, resolveOnResult } = execOptions ?? {}

  const reorderEnabled = config.testConfig.reorder_failed_first ?? false
  const lastFailedTests = reorderEnabled && config.outputFile ? await readPreviousFailedTests(config.outputFile) : []

  await setSettingsForAutorun(factorioPath, dataDir, modsDir, modToTest, mode, {
    verbose: config.verbose,
    lastFailedTests,
  })
  await setTestConfigSetting(modsDir, config.testConfig)

  let result: FactorioTestResult
  try {
    result =
      mode === "headless"
        ? await runFactorioTestsHeadless(factorioPath, dataDir, savePath, factorioArgs, {
            verbose: config.verbose,
            quiet: config.quiet,
            signal,
            outputTimeout: config.outputTimeout,
          })
        : await runFactorioTestsGraphics(factorioPath, dataDir, savePath, factorioArgs, {
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
    await writeResultsFile(config.outputFile, modToTest, result.data)
    if (config.verbose) console.log(`Results written to ${config.outputFile}`)
  }

  if (outcome.bailed) {
    console.log(chalk.yellow(`Bailed out after ${config.testConfig.bail} failure(s)`))
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
  const target = await resolveModWatchTarget(ctx.modsDir, ctx.config.modPath, ctx.config.modName)
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
  const target = await resolveModWatchTarget(ctx.modsDir, ctx.config.modPath, ctx.config.modName)

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
  const { config, factorioPath, dataDir, modsDir, modToTest, savePath, factorioArgs } = ctx

  await ensureModSettingsDat(factorioPath, dataDir, modsDir, config.verbose)
  await setModToTestSetting(modsDir, modToTest)
  await setTestConfigSetting(modsDir, config.testConfig)

  await runFactorioTestsGraphics(factorioPath, dataDir, savePath, factorioArgs, {
    verbose: config.verbose,
    quiet: config.quiet,
  })
}

async function runTests(patterns: string[], cliOptions: Record<string, unknown>): Promise<number> {
  const ctx = await setupTestRun(patterns, cliOptions)

  if (ctx.config.noAutoStart) {
    await launchWithoutAutoStart(ctx)
    return 0
  }
  if (ctx.config.watch && ctx.config.graphics) return runGraphicsWatchMode(ctx)
  if (ctx.config.watch) return runHeadlessWatchMode(ctx)

  const outcome = await executeTestRun(ctx)
  return outcome.exitCode
}

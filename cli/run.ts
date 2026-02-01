import type { Command } from "@commander-js/extra-typings"
import chalk from "chalk"
import { program } from "commander"
import * as dgram from "dgram"
import * as fsp from "fs/promises"
import * as path from "path"
import { CliError } from "./cli-error.js"
import { registerAllCliOptions, resolveConfig, type ResolvedConfig } from "./config/index.js"
import { autoDetectFactorioPath } from "./factorio-process.js"
import {
  FactorioTestResult,
  getHeadlessSavePath,
  runFactorioTestsGraphics,
  runFactorioTestsHeadless,
} from "./factorio-process.js"
import { watchDirectory, watchFile } from "./file-watcher.js"
import {
  configureModToTest,
  ensureConfigIni,
  ensureModSettingsDat,
  installFactorioTest,
  installModDependencies,
  installMods,
  parseModRequirement,
  resetAutorunSettings,
  resolveModWatchTarget,
  setSettingsForAutorun,
} from "./mod-setup.js"
import { runScript, setVerbose } from "./process-utils.js"
import { OutputFormatter } from "./test-output.js"
import { readPreviousFailedTests, writeResultsFile } from "./test-results.js"

const thisCommand = (program as unknown as Command)
  .command("run")
  .summary("Runs tests with Factorio test.")
  .description(
    `Runs tests for the specified mod with Factorio test. Exits with code 0 only if all tests pass.

One of --mod-path or --mod-name is required.
Test execution options (--test-pattern, --tag-*, --bail, etc.) override in-mod config.

When using variadic options (--mods, --factorio-args, etc.) with filter patterns,
use -- to separate them:
  factorio-test run -p ./my-mod --mods quality space-age -- "inventory"

Patterns use Lua pattern syntax (not regex). Special characters like - must be
escaped with %:
  factorio-test run -p ./my-mod "my%-test"  Match "my-test" (escape the dash)

Examples:
  factorio-test run -p ./my-mod             Run all tests
  factorio-test run -p ./my-mod -v          Run with verbose output
  factorio-test run -p ./my-mod -gw         Run with graphics in watch mode
  factorio-test run -p ./my-mod -b          Bail on first failure
  factorio-test run -p ./my-mod "inventory" Run tests matching "inventory"
`,
  )
  .argument("[filter...]", "Lua patterns to filter tests (OR logic)")

registerAllCliOptions(thisCommand)

thisCommand.action((patterns, options) => runTests(patterns, options as Record<string, unknown>))

interface TestRunResult {
  exitCode: number
  status: string
}

interface TestRunContext {
  config: ResolvedConfig
  factorioPath: string
  dataDir: string
  modsDir: string
  modToTest: string
  mode: "headless" | "graphics"
  savePath: string
  factorioArgs: string[]
}

async function setupTestRun(patterns: string[], cliOptions: Record<string, unknown>): Promise<TestRunContext> {
  const config = resolveConfig({ cliOptions, patterns })

  setVerbose(!!config.verbose)

  if (config.modPath !== undefined && config.modName !== undefined) {
    throw new CliError("Only one of --mod-path or --mod-name can be specified.")
  }
  if (config.modPath === undefined && config.modName === undefined) {
    throw new CliError("One of --mod-path or --mod-name must be specified.")
  }
  if (config.noAutoStart && !config.graphics) {
    throw new CliError("--no-auto-start requires --graphics.")
  }

  const factorioPath = config.factorioPath ?? autoDetectFactorioPath()
  const dataDir = config.dataDirectory
  const modsDir = path.join(dataDir, "mods")
  await fsp.mkdir(modsDir, { recursive: true })

  const modToTest = await configureModToTest(modsDir, config.modPath, config.modName, config.verbose)
  const modDependencies = config.modPath ? await installModDependencies(modsDir, path.resolve(config.modPath)) : []
  await installFactorioTest(modsDir)

  const configModRequirements =
    config.mods
      ?.filter((m) => !m.match(/^\S+=(?:true|false)$/))
      .map(parseModRequirement)
      .filter((r) => r != null) ?? []
  if (configModRequirements.length > 0) {
    await installMods(modsDir, configModRequirements)
  }

  const enableModsOptions = [
    "factorio-test=true",
    `${modToTest}=true`,
    ...modDependencies.map((m) => `${m}=true`),
    ...(config.mods?.map((m) => (m.match(/^\S+=(?:true|false)$/) ? m : `${m.split(/\s/)[0]}=true`)) ?? []),
  ]

  if (config.verbose) console.log("Adjusting mods")
  await runScript("fmtk", "mods", "adjust", "--modsPath", modsDir, "--disableExtra", ...enableModsOptions)
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

async function executeTestRun(ctx: TestRunContext, execOptions?: ExecuteOptions): Promise<TestRunResult> {
  const { config, factorioPath, dataDir, modsDir, modToTest, mode, savePath, factorioArgs } = ctx
  const { signal, skipResetAutorun, resolveOnResult } = execOptions ?? {}

  const reorderEnabled = config.testConfig.reorder_failed_first ?? true
  const lastFailedTests = reorderEnabled && config.outputFile ? await readPreviousFailedTests(config.outputFile) : []

  await setSettingsForAutorun(factorioPath, dataDir, modsDir, modToTest, mode, {
    verbose: config.verbose,
    lastFailedTests,
  })

  if (Object.keys(config.testConfig).length > 0) {
    await runScript(
      "fmtk",
      "settings",
      "set",
      "runtime-global",
      "factorio-test-config",
      JSON.stringify(config.testConfig),
      "--modsPath",
      modsDir,
    )
  }

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
      await runScript("fmtk", "settings", "set", "runtime-global", "factorio-test-config", "{}", "--modsPath", modsDir)
    }
  }

  if (result.status === "cancelled") {
    return { exitCode: 0, status: "cancelled" }
  }

  if (config.outputFile && result.data) {
    await writeResultsFile(config.outputFile, modToTest, result.data)
    if (config.verbose) console.log(`Results written to ${config.outputFile}`)
  }

  let resultStatus = result.status
  if (resultStatus === "bailed") {
    console.log(chalk.yellow(`Bailed out after ${config.testConfig.bail} failure(s)`))
    resultStatus = "failed"
  }
  if (result.data) {
    const formatter = new OutputFormatter({ quiet: config.quiet })
    formatter.formatSummary(result.data)
  }

  if (result.hasFocusedTests && config.forbidOnly) {
    console.log(chalk.redBright("Error: .only tests are present but --forbid-only is enabled"))
    return { exitCode: 1, status: resultStatus }
  }

  return { exitCode: resultStatus === "passed" ? 0 : 1, status: resultStatus }
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

  let abortController: AbortController | undefined

  const runOnce = async () => {
    abortController?.abort()
    abortController = new AbortController()
    console.log("\n" + "─".repeat(60))
    try {
      await executeTestRun(ctx, { signal: abortController.signal })
    } catch (e) {
      if (e instanceof CliError) {
        console.error(chalk.red(e.message))
      } else {
        throw e
      }
    } finally {
      abortController = undefined
    }
  }

  await runOnce()

  const onFileChange = () => {
    console.log(chalk.cyan("File change detected, rerunning tests..."))
    runOnce()
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

  await runScript(
    "fmtk",
    "settings",
    "set",
    "runtime-global",
    "factorio-test-mod-to-test",
    modToTest,
    "--modsPath",
    modsDir,
  )

  if (Object.keys(config.testConfig).length > 0) {
    await runScript(
      "fmtk",
      "settings",
      "set",
      "runtime-global",
      "factorio-test-config",
      JSON.stringify(config.testConfig),
      "--modsPath",
      modsDir,
    )
  }

  await runFactorioTestsGraphics(factorioPath, dataDir, savePath, factorioArgs, {
    verbose: config.verbose,
    quiet: config.quiet,
  })
}

async function runTests(patterns: string[], cliOptions: Record<string, unknown>): Promise<void> {
  const ctx = await setupTestRun(patterns, cliOptions)

  if (ctx.config.noAutoStart) {
    await launchWithoutAutoStart(ctx)
  } else if (ctx.config.watch && ctx.config.graphics) {
    await runGraphicsWatchMode(ctx)
  } else if (ctx.config.watch) {
    await runHeadlessWatchMode(ctx)
  } else {
    const result = await executeTestRun(ctx)
    process.exit(result.exitCode)
  }
}

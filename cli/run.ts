import type { Command } from "@commander-js/extra-typings"
import chalk from "chalk"
import { program } from "commander"
import * as dgram from "dgram"
import * as fsp from "fs/promises"
import * as path from "path"
import { CliError } from "./cli-error.js"
import {
  buildTestConfig,
  loadConfig,
  mergeCliConfig,
  registerAllCliOptions,
  type CliConfig,
  type RunOptions,
  type TestRunnerConfig,
} from "./config/index.js"
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
  installFactorioTest,
  installModDependencies,
  installMods,
  resetAutorunSettings,
  resolveModWatchTarget,
  setSettingsForAutorun,
} from "./mod-setup.js"
import { runScript, setVerbose } from "./process-utils.js"
import { getDefaultOutputPath, readPreviousFailedTests, writeResultsFile } from "./test-results.js"

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

Examples:
  factorio-test run -p ./my-mod             Run all tests
  factorio-test run -p ./my-mod -v          Run with verbose output
  factorio-test run -p ./my-mod -gw         Run with graphics in watch mode
  factorio-test run -p ./my-mod -b          Bail on first failure
  factorio-test run -p ./my-mod "inventory" Run tests matching "inventory"
`,
  )
  .argument("[filter...]", "Test patterns to filter (OR logic)")

registerAllCliOptions(thisCommand)

thisCommand.action((patterns, options) => runTests(patterns, options as RunOptions))

interface TestRunResult {
  exitCode: number
  status: string
}

interface TestRunContext {
  factorioPath: string
  dataDir: string
  modsDir: string
  modToTest: string
  mode: "headless" | "graphics"
  savePath: string
  outputPath: string | undefined
  factorioArgs: string[]
  testConfig: TestRunnerConfig
  options: RunOptions
  fileConfig: CliConfig
  udpPort: number | undefined
}

async function setupTestRun(patterns: string[], options: RunOptions): Promise<TestRunContext> {
  const fileConfig = loadConfig(options.config)
  mergeCliConfig(fileConfig, options)

  setVerbose(!!options.verbose)

  if (options.modPath !== undefined && options.modName !== undefined) {
    throw new CliError("Only one of --mod-path or --mod-name can be specified.")
  }
  if (options.modPath === undefined && options.modName === undefined) {
    throw new CliError("One of --mod-path or --mod-name must be specified.")
  }

  const factorioPath = options.factorioPath ?? autoDetectFactorioPath()
  const dataDir = path.resolve(options.dataDirectory)
  const modsDir = path.join(dataDir, "mods")
  await fsp.mkdir(modsDir, { recursive: true })

  const modToTest = await configureModToTest(modsDir, options.modPath, options.modName, options.verbose)
  const modDependencies = options.modPath ? await installModDependencies(modsDir, path.resolve(options.modPath)) : []
  await installFactorioTest(modsDir)

  const configMods = options.mods?.filter((m) => !m.includes("=")) ?? []
  if (configMods.length > 0) {
    await installMods(modsDir, configMods)
  }

  const enableModsOptions = [
    "factorio-test=true",
    `${modToTest}=true`,
    ...modDependencies.map((m) => `${m}=true`),
    ...(options.mods?.map((m) => (m.includes("=") ? m : `${m}=true`)) ?? []),
  ]

  if (options.verbose) console.log("Adjusting mods")
  await runScript("fmtk", "mods", "adjust", "--modsPath", modsDir, "--disableExtra", ...enableModsOptions)
  await ensureConfigIni(dataDir)

  const mode = options.graphics ? "graphics" : "headless"
  const savePath = getHeadlessSavePath(options.save ?? fileConfig.save)

  const outputPath =
    options.outputFile === false
      ? undefined
      : (options.outputFile ?? fileConfig.outputFile ?? getDefaultOutputPath(dataDir))

  const testConfig = buildTestConfig(fileConfig, options, patterns)

  const udpPort = options.watch && options.graphics ? (options.udpPort ?? fileConfig.udpPort ?? 14434) : undefined
  const factorioArgs = [...(options.factorioArgs ?? [])]
  if (udpPort !== undefined) {
    factorioArgs.push(`--enable-lua-udp=${udpPort}`)
  }

  return {
    factorioPath,
    dataDir,
    modsDir,
    modToTest,
    mode,
    savePath,
    outputPath,
    factorioArgs,
    testConfig,
    options,
    fileConfig,
    udpPort,
  }
}

interface ExecuteOptions {
  signal?: AbortSignal
  skipResetAutorun?: boolean
  resolveOnResult?: boolean
}

async function executeTestRun(ctx: TestRunContext, execOptions?: ExecuteOptions): Promise<TestRunResult> {
  const { factorioPath, dataDir, modsDir, modToTest, mode, savePath, outputPath, factorioArgs, testConfig, options } =
    ctx
  const { signal, skipResetAutorun, resolveOnResult } = execOptions ?? {}

  const reorderEnabled = options.reorderFailedFirst ?? ctx.fileConfig.test?.reorder_failed_first ?? true
  const lastFailedTests = reorderEnabled && outputPath ? await readPreviousFailedTests(outputPath) : []

  await setSettingsForAutorun(factorioPath, dataDir, modsDir, modToTest, mode, {
    verbose: options.verbose,
    lastFailedTests,
  })

  if (Object.keys(testConfig).length > 0) {
    await runScript(
      "fmtk",
      "settings",
      "set",
      "runtime-global",
      "factorio-test-config",
      JSON.stringify(testConfig),
      "--modsPath",
      modsDir,
    )
  }

  let result: FactorioTestResult
  try {
    result =
      mode === "headless"
        ? await runFactorioTestsHeadless(factorioPath, dataDir, savePath, factorioArgs, {
            verbose: options.verbose,
            quiet: options.quiet,
            signal,
          })
        : await runFactorioTestsGraphics(factorioPath, dataDir, savePath, factorioArgs, {
            verbose: options.verbose,
            quiet: options.quiet,
            resolveOnResult,
          })
  } finally {
    if (!skipResetAutorun) {
      await resetAutorunSettings(modsDir, options.verbose)
      await runScript("fmtk", "settings", "set", "runtime-global", "factorio-test-config", "{}", "--modsPath", modsDir)
    }
  }

  if (result.status === "cancelled") {
    return { exitCode: 0, status: "cancelled" }
  }

  if (outputPath && result.data) {
    await writeResultsFile(outputPath, modToTest, result.data)
    if (options.verbose) console.log(`Results written to ${outputPath}`)
  }

  let resultStatus = result.status
  if (resultStatus === "bailed") {
    console.log(chalk.yellow(`Bailed out after ${testConfig.bail} failure(s)`))
    resultStatus = "failed"
  }
  const color =
    resultStatus == "passed" ? chalk.greenBright : resultStatus == "todo" ? chalk.yellowBright : chalk.redBright
  console.log("Test run result:", color(resultStatus))

  const forbidOnly = options.forbidOnly ?? ctx.fileConfig.forbidOnly ?? true
  if (result.hasFocusedTests && forbidOnly) {
    console.log(chalk.redBright("Error: .only tests are present but --forbid-only is enabled"))
    return { exitCode: 1, status: resultStatus }
  }

  return { exitCode: resultStatus === "passed" ? 0 : 1, status: resultStatus }
}

const DEFAULT_WATCH_PATTERNS = ["info.json", "**/*.lua"]

async function runGraphicsWatchMode(ctx: TestRunContext): Promise<never> {
  const watchPatterns = ctx.options.watchPatterns ?? ctx.fileConfig.watchPatterns ?? DEFAULT_WATCH_PATTERNS
  const target = await resolveModWatchTarget(ctx.modsDir, ctx.options.modPath, ctx.options.modName)
  console.log(chalk.gray(`Watching ${target.path} for patterns: ${watchPatterns.join(", ")}`))

  await executeTestRun(ctx, { skipResetAutorun: true, resolveOnResult: true })

  const udpClient = dgram.createSocket("udp4")
  const onFileChange = () => {
    console.log(chalk.cyan("File change detected, triggering rerun..."))
    udpClient.send("rerun", ctx.udpPort!, "127.0.0.1")
  }

  const watcher =
    target.type === "directory"
      ? watchDirectory(target.path, onFileChange, { patterns: watchPatterns })
      : watchFile(target.path, onFileChange)

  process.on("SIGINT", () => {
    watcher.close()
    udpClient.close()
    process.exit(0)
  })

  return new Promise(() => {})
}

async function runHeadlessWatchMode(ctx: TestRunContext): Promise<never> {
  const watchPatterns = ctx.options.watchPatterns ?? ctx.fileConfig.watchPatterns ?? DEFAULT_WATCH_PATTERNS
  const target = await resolveModWatchTarget(ctx.modsDir, ctx.options.modPath, ctx.options.modName)

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
      ? watchDirectory(target.path, onFileChange, { patterns: watchPatterns })
      : watchFile(target.path, onFileChange)

  process.on("SIGINT", () => {
    watcher.close()
    process.exit(0)
  })

  return new Promise(() => {})
}

async function runTests(patterns: string[], options: RunOptions): Promise<void> {
  const ctx = await setupTestRun(patterns, options)

  if (options.watch && options.graphics) {
    await runGraphicsWatchMode(ctx)
  } else if (options.watch) {
    await runHeadlessWatchMode(ctx)
  } else {
    const result = await executeTestRun(ctx)
    process.exit(result.exitCode)
  }
}

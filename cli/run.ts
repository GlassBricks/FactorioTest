import { program } from "commander"
import * as fsp from "fs/promises"
import * as path from "path"
import chalk from "chalk"
import type { Command } from "@commander-js/extra-typings"
import { loadConfig, mergeTestConfig } from "./config.js"
import { registerTestRunnerOptions, registerCliOnlyOptions, parseCliTestOptions } from "./schema.js"
import { setVerbose, runScript } from "./process-utils.js"
import { autoDetectFactorioPath } from "./factorio-detect.js"
import {
  configureModToTest,
  installFactorioTest,
  installModDependencies,
  ensureConfigIni,
  setSettingsForAutorun,
  resetAutorunSettings,
} from "./mod-setup.js"
import { writeResultsFile, readPreviousFailedTests, getDefaultOutputPath } from "./results-writer.js"
import {
  getHeadlessSavePath,
  runFactorioTestsHeadless,
  runFactorioTestsGraphics,
  FactorioTestResult,
} from "./factorio-process.js"

const thisCommand = (program as unknown as Command)
  .command("run")
  .summary("Runs tests with Factorio test.")
  .description("Runs tests for the specified mod with Factorio test. Exits with code 0 only if all tests pass.\n")
  .argument("[filter...]", "Test patterns to filter (OR logic)")
  .option(
    "--mod-path <path>",
    "Path to the mod folder (containing info.json). Either this or --mod-name must be specified.",
  )
  .option(
    "--mod-name <name>",
    "Name of the mod to test. The mod must already be in the data directory. Either this or --mod-path must be specified.",
  )
  .option(
    "--factorio-path <path>",
    "The path to the factorio binary. If not specified, attempts to auto-detect the path.",
  )
  .option(
    "-d --data-directory <path>",
    "Factorio user data directory for the testing instance.",
    "./factorio-test-data-dir",
  )
  .option("--graphics", "Run with graphics (interactive mode). Default: headless.")
  .option("--save <path>", "Path to save file")
  .option(
    "--mods <mods...>",
    'Additional mods to enable. Example: "--mods mod1 mod2=1.2.3". All other mods are disabled by default.',
  )
  .option("--factorio-args <args...>", "Additional arguments to pass to the Factorio process.")
  .option("--show-output", "Print test output to stdout.", true)
  .option("-q --quiet", "Suppress per-test output, show only final result.")
  .option("-v --verbose", "Enables more logging, and pipes the Factorio process output to stdout.")
  .option("--config <path>", "Path to config file")
  .option("--output-file <path>", "Path to write test results JSON file")
  .option("--no-output-file", "Disable writing test results file")

registerTestRunnerOptions(thisCommand)
registerCliOnlyOptions(thisCommand)

thisCommand.action((patterns, options) => {
  runTests(patterns, options)
})

async function runTests(
  patterns: string[],
  options: {
    config?: string
    modPath?: string
    factorioPath?: string
    modName?: string
    dataDirectory: string
    graphics?: true
    save?: string
    quiet?: true
    verbose?: true
    showOutput?: boolean
    mods?: string[]
    factorioArgs?: string[]
    testPattern?: string
    tagWhitelist?: string[]
    tagBlacklist?: string[]
    defaultTimeout?: number
    gameSpeed?: number
    logPassedTests?: boolean
    logSkippedTests?: boolean
    reorderFailedFirst?: boolean
    forbidOnly?: boolean
    outputFile?: string | false
  },
) {
  const fileConfig = loadConfig(options.config)

  options.modPath ??= fileConfig.modPath
  options.modName ??= fileConfig.modName
  options.factorioPath ??= fileConfig.factorioPath
  options.dataDirectory ??= fileConfig.dataDirectory ?? "./factorio-test-data-dir"
  options.mods ??= fileConfig.mods
  options.factorioArgs ??= fileConfig.factorioArgs
  options.verbose ??= fileConfig.verbose as true | undefined
  options.quiet ??= fileConfig.quiet as true | undefined
  options.showOutput ??= options.quiet ? false : (fileConfig.showOutput ?? true)

  setVerbose(!!options.verbose)

  if (options.modPath !== undefined && options.modName !== undefined) {
    throw new Error("Only one of --mod-path or --mod-name can be specified.")
  }
  if (options.modPath === undefined && options.modName === undefined) {
    throw new Error("One of --mod-path or --mod-name must be specified.")
  }

  const factorioPath = options.factorioPath ?? autoDetectFactorioPath()
  const dataDir = path.resolve(options.dataDirectory)
  const modsDir = path.join(dataDir, "mods")
  await fsp.mkdir(modsDir, { recursive: true })

  const modToTest = await configureModToTest(modsDir, options.modPath, options.modName, options.verbose)
  const modDependencies = options.modPath
    ? await installModDependencies(modsDir, path.resolve(options.modPath), options.verbose)
    : []
  await installFactorioTest(modsDir)

  const enableModsOptions = [
    "factorio-test=true",
    `${modToTest}=true`,
    ...modDependencies.map((m) => `${m}=true`),
    ...(options.mods?.map((m) => (m.includes("=") ? m : `${m}=true`)) ?? []),
  ]

  if (options.verbose) console.log("Adjusting mods")
  await runScript("fmtk mods adjust", "--modsPath", modsDir, "--disableExtra", ...enableModsOptions)
  await ensureConfigIni(dataDir)

  const mode = options.graphics ? "graphics" : "headless"
  const savePath = getHeadlessSavePath(options.save ?? fileConfig.save)

  const outputPath =
    options.outputFile === false
      ? undefined
      : (options.outputFile ?? fileConfig.outputFile ?? getDefaultOutputPath(dataDir))
  const reorderEnabled = options.reorderFailedFirst ?? fileConfig.test?.reorder_failed_first ?? true
  const lastFailedTests = reorderEnabled && outputPath ? await readPreviousFailedTests(outputPath) : []

  await setSettingsForAutorun(factorioPath, dataDir, modsDir, modToTest, mode, {
    verbose: options.verbose,
    lastFailedTests,
  })

  const cliTestOptions = parseCliTestOptions(options)
  const allPatterns = [fileConfig.test?.test_pattern, cliTestOptions.test_pattern, ...patterns].filter(
    Boolean,
  ) as string[]
  const combinedPattern = allPatterns.length > 0 ? allPatterns.map((p) => `(${p})`).join("|") : undefined

  const testConfig = mergeTestConfig(fileConfig.test, {
    ...cliTestOptions,
    test_pattern: combinedPattern,
  })

  if (Object.keys(testConfig).length > 0) {
    await runScript(
      "fmtk settings set runtime-global factorio-test-config",
      `'${JSON.stringify(testConfig)}'`,
      "--modsPath",
      modsDir,
    )
  }

  const factorioArgs = options.factorioArgs ?? []

  let result: FactorioTestResult
  try {
    result =
      mode === "headless"
        ? await runFactorioTestsHeadless(factorioPath, dataDir, savePath, factorioArgs, {
            verbose: options.verbose,
            showOutput: options.showOutput,
          })
        : await runFactorioTestsGraphics(factorioPath, dataDir, savePath, factorioArgs, {
            verbose: options.verbose,
            showOutput: options.showOutput,
          })
  } finally {
    await resetAutorunSettings(modsDir, options.verbose)
    await runScript("fmtk settings set runtime-global factorio-test-config", "{}", "--modsPath", modsDir)
  }

  if (outputPath && result.data) {
    await writeResultsFile(outputPath, modToTest, result.data)
    if (options.verbose) console.log(`Results written to ${outputPath}`)
  }

  const resultStatus = result.status
  const color =
    resultStatus == "passed" ? chalk.greenBright : resultStatus == "todo" ? chalk.yellowBright : chalk.redBright
  console.log("Test run result:", color(resultStatus))

  const forbidOnly = options.forbidOnly ?? fileConfig.forbid_only ?? true
  if (result.hasFocusedTests && forbidOnly) {
    console.log(chalk.redBright("Error: .only tests are present but --forbid-only is enabled"))
    process.exit(1)
  }

  process.exit(resultStatus === "passed" ? 0 : 1)
}

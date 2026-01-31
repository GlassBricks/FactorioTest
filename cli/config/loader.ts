import * as fs from "fs"
import * as path from "path"
import { ZodError } from "zod"
import { CliError } from "../cli-error.js"
import { cliConfigSchema, DEFAULT_DATA_DIRECTORY, type CliConfig, type CliOnlyOptions } from "./cli-config.js"
import { parseCliTestOptions, TestRunnerConfig } from "./test-config.js"

type SnakeToCamel<S extends string> = S extends `${infer T}_${infer U}` ? `${T}${Capitalize<SnakeToCamel<U>>}` : S

type CamelCaseTestConfig = {
  [K in keyof TestRunnerConfig as SnakeToCamel<K & string>]?: TestRunnerConfig[K]
}

export type RunOptions = CliOnlyOptions &
  Omit<CliConfig, "test" | "outputFile"> &
  CamelCaseTestConfig & {
    outputFile?: string | false
    dataDirectory: string
  }

function formatZodError(error: ZodError, filePath: string): string {
  const issues = error.issues.map((issue) => {
    const pathStr = issue.path.join(".")
    return `  - ${pathStr ? `"${pathStr}": ` : ""}${issue.message}`
  })
  return `Invalid config in ${filePath}:\n${issues.join("\n")}`
}

export function loadConfig(configPath?: string): CliConfig {
  const paths = configPath
    ? [path.resolve(configPath)]
    : [path.resolve("factorio-test.json"), path.resolve("package.json")]

  for (const filePath of paths) {
    if (!fs.existsSync(filePath)) continue

    const content = JSON.parse(fs.readFileSync(filePath, "utf8"))
    const rawConfig = filePath.endsWith("package.json") ? content["factorio-test"] : content

    if (!rawConfig) continue

    const result = cliConfigSchema.strict().safeParse(rawConfig)
    if (!result.success) {
      throw new CliError(formatZodError(result.error, filePath))
    }
    return resolveConfigPaths(result.data, path.dirname(filePath))
  }

  return {}
}

function resolveConfigPaths(config: CliConfig, configDir: string): CliConfig {
  return {
    ...config,
    modPath: config.modPath ? path.resolve(configDir, config.modPath) : undefined,
    factorioPath: config.factorioPath ? path.resolve(configDir, config.factorioPath) : undefined,
    dataDirectory: path.resolve(configDir, config.dataDirectory ?? DEFAULT_DATA_DIRECTORY),
    save: config.save ? path.resolve(configDir, config.save) : undefined,
  }
}

export function mergeTestConfig(
  configFile: TestRunnerConfig | undefined,
  cliOptions: Partial<TestRunnerConfig>,
): TestRunnerConfig {
  return {
    ...configFile,
    test_pattern: cliOptions.test_pattern ?? configFile?.test_pattern,
    tag_whitelist: cliOptions.tag_whitelist ?? configFile?.tag_whitelist,
    tag_blacklist: cliOptions.tag_blacklist ?? configFile?.tag_blacklist,
    default_timeout: cliOptions.default_timeout ?? configFile?.default_timeout,
    game_speed: cliOptions.game_speed ?? configFile?.game_speed,
    log_passed_tests: cliOptions.log_passed_tests ?? configFile?.log_passed_tests,
    log_skipped_tests: cliOptions.log_skipped_tests ?? configFile?.log_skipped_tests,
    reorder_failed_first: cliOptions.reorder_failed_first ?? configFile?.reorder_failed_first,
    bail: cliOptions.bail ?? configFile?.bail,
  }
}

export function mergeCliConfig(fileConfig: CliConfig, options: RunOptions): RunOptions {
  options.modPath ??= fileConfig.modPath
  options.modName ??= fileConfig.modName
  options.factorioPath ??= fileConfig.factorioPath
  options.dataDirectory ??= fileConfig.dataDirectory ?? DEFAULT_DATA_DIRECTORY
  options.mods ??= fileConfig.mods
  options.factorioArgs ??= fileConfig.factorioArgs
  options.verbose ??= fileConfig.verbose as true | undefined
  options.quiet ??= fileConfig.quiet as true | undefined
  options.outputTimeout ??= fileConfig.outputTimeout
  return options
}

export function buildTestConfig(fileConfig: CliConfig, options: RunOptions, patterns: string[]): TestRunnerConfig {
  const cliTestOptions = parseCliTestOptions(options as unknown as Record<string, unknown>)
  const testPattern =
    patterns.length > 0
      ? patterns.map((p) => `(${p})`).join("|")
      : (cliTestOptions.test_pattern ?? fileConfig.test?.test_pattern)
  return mergeTestConfig(fileConfig.test, { ...cliTestOptions, test_pattern: testPattern })
}

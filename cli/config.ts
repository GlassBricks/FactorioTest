import * as fs from "fs"
import * as path from "path"
import { ZodError } from "zod"
import { cliConfigSchema, type CliConfig, type TestRunnerConfig } from "./schema.js"
import { CliError } from "./cli-error.js"

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
    dataDirectory: config.dataDirectory ? path.resolve(configDir, config.dataDirectory) : undefined,
    save: config.save ? path.resolve(configDir, config.save) : undefined,
  }
}

export function mergeTestConfig(
  configFile: TestRunnerConfig | undefined,
  cliOptions: Partial<TestRunnerConfig>,
): TestRunnerConfig {
  const baseTestPattern = configFile?.test_pattern
  const cliTestPattern = cliOptions.test_pattern
  const mergedTestPattern =
    cliTestPattern !== undefined
      ? baseTestPattern
        ? `(${baseTestPattern})|(${cliTestPattern})`
        : cliTestPattern
      : baseTestPattern

  return {
    ...configFile,
    test_pattern: mergedTestPattern,
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

export { type CliConfig, type TestRunnerConfig }

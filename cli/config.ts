import * as fs from "fs"
import * as path from "path"
import type { TestRunnerConfig } from "../types/config.js"

export interface CliConfig {
  modPath?: string
  modName?: string
  factorioPath?: string
  dataDirectory?: string
  mods?: string[]
  verbose?: boolean
  showOutput?: boolean
  factorioArgs?: string[]
  test?: TestRunnerConfig
}

const validCliConfigKeys = new Set([
  "modPath",
  "modName",
  "factorioPath",
  "dataDirectory",
  "mods",
  "verbose",
  "showOutput",
  "factorioArgs",
  "test",
])

const validTestConfigKeys = new Set([
  "test_pattern",
  "tag_whitelist",
  "tag_blacklist",
  "default_timeout",
  "game_speed",
  "log_passed_tests",
  "log_skipped_tests",
])

function validateConfig(config: Record<string, unknown>, filePath: string): void {
  for (const key of Object.keys(config)) {
    if (!validCliConfigKeys.has(key)) {
      throw new Error(`Unknown config key "${key}" in ${filePath}`)
    }
  }
  if (config.test && typeof config.test === "object") {
    for (const key of Object.keys(config.test)) {
      if (!validTestConfigKeys.has(key)) {
        throw new Error(`Unknown test config key "${key}" in ${filePath}`)
      }
    }
  }
}

export function loadConfig(configPath?: string): CliConfig {
  const paths = configPath
    ? [path.resolve(configPath)]
    : [path.resolve("factorio-test.json"), path.resolve("package.json")]

  for (const filePath of paths) {
    if (!fs.existsSync(filePath)) continue

    const content = JSON.parse(fs.readFileSync(filePath, "utf8"))

    if (filePath.endsWith("package.json")) {
      if (content["factorio-test"]) {
        validateConfig(content["factorio-test"], filePath)
        return content["factorio-test"] as CliConfig
      }
      continue
    }

    validateConfig(content, filePath)
    return content as CliConfig
  }

  return {}
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
  }
}

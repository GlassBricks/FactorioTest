import * as fs from "fs"
import * as path from "path"
import { ZodError } from "zod"
import { CliError } from "../cli-error.js"
import { getDefaultOutputPath } from "../test-results.js"
import { DEFAULT_DATA_DIRECTORY, fileConfigFields, fileConfigSchema, type FileConfig } from "./cli-config.js"
import { parseCliTestOptions, type TestRunnerConfig } from "./test-config.js"

const DEFAULT_WATCH_PATTERNS = ["info.json", "**/*.lua"]

export interface ResolvedConfig {
  graphics?: true
  watch?: true
  noAutoStart?: true

  modPath?: string
  modName?: string
  factorioPath?: string
  dataDirectory: string
  save?: string
  mods?: string[]
  factorioArgs?: string[]
  verbose?: boolean
  quiet?: boolean
  outputFile?: string
  forbidOnly: boolean
  watchPatterns: string[]
  udpPort: number
  outputTimeout: number

  testConfig: TestRunnerConfig
}

export interface ResolveConfigInput {
  cliOptions: Record<string, unknown>
  patterns: string[]
}

function formatZodError(error: ZodError, filePath: string): string {
  const issues = error.issues.map((issue) => {
    const pathStr = issue.path.join(".")
    return `  - ${pathStr ? `"${pathStr}": ` : ""}${issue.message}`
  })
  return `Invalid config in ${filePath}:\n${issues.join("\n")}`
}

export function loadFileConfig(configPath?: string): FileConfig {
  const paths = configPath
    ? [path.resolve(configPath)]
    : [path.resolve("factorio-test.json"), path.resolve("package.json")]

  for (const filePath of paths) {
    if (!fs.existsSync(filePath)) continue

    const content = JSON.parse(fs.readFileSync(filePath, "utf8"))
    const rawConfig = filePath.endsWith("package.json") ? content["factorio-test"] : content

    if (!rawConfig) continue

    const result = fileConfigSchema.strict().safeParse(rawConfig)
    if (!result.success) {
      throw new CliError(formatZodError(result.error, filePath))
    }
    return resolveConfigPaths(result.data, path.dirname(filePath))
  }

  return {}
}

function resolveConfigPaths(config: FileConfig, configDir: string): FileConfig {
  return {
    ...config,
    modPath: config.modPath ? path.resolve(configDir, config.modPath) : undefined,
    factorioPath: config.factorioPath ? path.resolve(configDir, config.factorioPath) : undefined,
    dataDirectory: path.resolve(configDir, config.dataDirectory ?? DEFAULT_DATA_DIRECTORY),
    save: config.save ? path.resolve(configDir, config.save) : undefined,
  }
}

function mergeTestConfig(
  fileConfig: TestRunnerConfig | undefined,
  cliOptions: Partial<TestRunnerConfig>,
): TestRunnerConfig {
  const defined = Object.fromEntries(Object.entries(cliOptions).filter(([, v]) => v !== undefined))
  return { ...fileConfig, ...defined } as TestRunnerConfig
}

function getBaseConfig(fileConfig: FileConfig, cliOptions: Record<string, unknown>): Omit<FileConfig, "test"> {
  const raw: Record<string, unknown> = {}
  for (const key of Object.keys(fileConfigFields)) {
    raw[key] = cliOptions[key] ?? (fileConfig as Record<string, unknown>)[key]
  }
  return raw as Omit<FileConfig, "test">
}

export function resolveConfig({ cliOptions, patterns }: ResolveConfigInput): ResolvedConfig {
  const fileConfig = loadFileConfig(cliOptions.config as string | undefined)
  const baseConfig = getBaseConfig(fileConfig, cliOptions)

  const testConfig = mergeTestConfig(fileConfig.test, parseCliTestOptions(cliOptions, patterns))

  return {
    graphics: cliOptions.graphics as true | undefined,
    watch: cliOptions.watch as true | undefined,
    noAutoStart: cliOptions.autoStart === false ? true : undefined,

    modPath: baseConfig.modPath,
    modName: baseConfig.modName,
    factorioPath: baseConfig.factorioPath,
    dataDirectory: path.resolve(baseConfig.dataDirectory ?? DEFAULT_DATA_DIRECTORY),
    save: baseConfig.save,
    mods: baseConfig.mods,
    factorioArgs: baseConfig.factorioArgs,
    verbose: baseConfig.verbose,
    quiet: baseConfig.quiet,
    outputFile:
      cliOptions.outputFile === false
        ? undefined
        : (baseConfig.outputFile ??
          getDefaultOutputPath(path.resolve(baseConfig.dataDirectory ?? DEFAULT_DATA_DIRECTORY))),
    forbidOnly: baseConfig.forbidOnly ?? true,
    watchPatterns: baseConfig.watchPatterns ?? DEFAULT_WATCH_PATTERNS,
    udpPort: baseConfig.udpPort ?? 14434,
    outputTimeout: baseConfig.outputTimeout ?? 15,
    testConfig,
  }
}

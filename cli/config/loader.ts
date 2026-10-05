import chalk from "chalk"
import * as fs from "fs"
import * as path from "path"
import { z, ZodError } from "zod"
import { CliError } from "../cli-error.js"
import { getDefaultOutputPath } from "../test-results.js"
import {
  cliOptionsSchema,
  DEFAULT_DATA_DIRECTORY,
  fileOptionsSchema,
  type FileOptions,
  longFlag,
  modOptionKeys,
  type ModOptionKey,
  type OptionKey,
  pathOptionKeys,
  resolvedSchema,
} from "./options.js"

type CliOptions = z.output<typeof cliOptionsSchema>
export type ResolvedConfig = Omit<z.output<typeof resolvedSchema>, "outputFile"> & {
  outputFile?: string
  /** Config file in use, if any. */
  configFile?: string
  /** Directory of the config file in use, else the current directory. */
  configDir: string
}

type CamelToSnake<S extends string> = S extends `${infer Head}${infer Tail}`
  ? `${Head extends Lowercase<Head> ? Head : `_${Lowercase<Head>}`}${CamelToSnake<Tail>}`
  : S

export type ModConfig = { [K in ModOptionKey as CamelToSnake<K>]?: NonNullable<ResolvedConfig[K]> }

export interface ResolveConfigInput {
  cliOptions: Record<string, unknown>
  patterns: string[]
}

const camelToSnake = (key: string) => key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`)
const snakeToCamel = (key: string) => key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase())

const legacyTestSchema = z.strictObject(
  Object.fromEntries(modOptionKeys.map((key) => [camelToSnake(key), fileOptionsSchema.shape[key]])),
)
const fileSchema = fileOptionsSchema.extend({ test: legacyTestSchema.optional() }).strict()

function formatZodError(error: ZodError, source: string, describePath: (p: (string | number)[]) => string): string {
  const issues = error.issues.map((issue) => `  - ${describePath(issue.path)}${issue.message}`)
  return `Invalid ${source}:\n${issues.join("\n")}`
}

function describeFilePath(issuePath: (string | number)[]): string {
  return issuePath.length ? `"${issuePath.join(".")}": ` : ""
}

function describeCliPath([key]: (string | number)[]): string {
  return `${longFlag(key as OptionKey)}: `
}

interface FoundConfigFile {
  filePath: string
  raw: unknown
}

function findConfigFile(configPath: string | undefined): FoundConfigFile | undefined {
  const candidates = configPath
    ? [path.resolve(configPath)]
    : [path.resolve("factorio-test.json"), path.resolve("package.json")]
  for (const filePath of candidates) {
    if (!fs.existsSync(filePath)) continue
    const content = JSON.parse(fs.readFileSync(filePath, "utf8"))
    const raw = filePath.endsWith("package.json") ? content["factorio-test"] : content
    if (raw) return { filePath, raw }
  }
  return undefined
}

export function loadFileConfig(configPath?: string): FileOptions {
  return parseFileConfig(findConfigFile(configPath))
}

function parseFileConfig(found: FoundConfigFile | undefined): FileOptions {
  if (!found) return {}

  const result = fileSchema.safeParse(found.raw)
  if (!result.success) {
    throw new CliError(formatZodError(result.error, `config in ${found.filePath}`, describeFilePath))
  }
  const { test, ...options } = result.data
  const merged = test ? mergeLegacyTestOptions(options, test, found.filePath) : options
  return resolveConfigPaths(merged, path.dirname(found.filePath))
}

function mergeLegacyTestOptions(options: FileOptions, test: Record<string, unknown>, filePath: string): FileOptions {
  console.warn(
    chalk.yellow(
      `${filePath}: the "test" key is deprecated. Move its options to the top level, in camelCase (e.g. "test.game_speed" -> "gameSpeed").`,
    ),
  )
  const merged: Record<string, unknown> = { ...options }
  for (const [snakeKey, value] of Object.entries(test)) {
    const key = snakeToCamel(snakeKey)
    if (key in options) {
      throw new CliError(`Invalid config in ${filePath}: both "${key}" and "test.${snakeKey}" are set.`)
    }
    merged[key] = value
  }
  return merged as FileOptions
}

function resolveConfigPaths(config: FileOptions, configDir: string): FileOptions {
  const resolved: Record<string, unknown> = {
    ...config,
    dataDirectory: config.dataDirectory ?? DEFAULT_DATA_DIRECTORY,
  }
  for (const key of pathOptionKeys) {
    const value = resolved[key]
    if (typeof value === "string") resolved[key] = path.resolve(configDir, value)
  }
  return resolved as FileOptions
}

function combineTestPatterns(optionPattern: string | undefined, positional: string[]): string | string[] | undefined {
  const all = optionPattern === undefined ? positional : [optionPattern, ...positional]
  if (all.length <= 1) return all[0]
  return all
}

export function parseCliOptions(cliOptions: Record<string, unknown>, patterns: string[]): CliOptions {
  const testPattern = combineTestPatterns(cliOptions.testPattern as string | undefined, patterns)
  const result = cliOptionsSchema.safeParse({ ...cliOptions, testPattern })
  if (!result.success) {
    throw new CliError(formatZodError(result.error, "command line options", describeCliPath))
  }
  return Object.fromEntries(Object.entries(result.data).filter(([, value]) => value !== undefined)) as CliOptions
}

export function resolveConfig({ cliOptions, patterns }: ResolveConfigInput): ResolvedConfig {
  const found = findConfigFile(cliOptions.config as string | undefined)
  const fileConfig = parseFileConfig(found)
  const config = resolvedSchema.parse({ ...fileConfig, ...parseCliOptions(cliOptions, patterns) })
  const dataDirectory = path.resolve(config.dataDirectory)
  return {
    ...config,
    dataDirectory,
    configFile: found?.filePath,
    configDir: found ? path.dirname(found.filePath) : process.cwd(),
    outputFile: config.outputFile === false ? undefined : (config.outputFile ?? getDefaultOutputPath(dataDirectory)),
  }
}

export function toModConfig(config: ResolvedConfig): ModConfig {
  const entries = modOptionKeys
    .filter((key) => config[key] !== undefined)
    .map((key) => [camelToSnake(key), config[key]])
  return Object.fromEntries(entries) as ModConfig
}

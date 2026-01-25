import type { Command } from "@commander-js/extra-typings"
import { z } from "zod"
import type { TestRunnerConfig as PublicTestRunnerConfig } from "../types/config.js"

export const testRunnerConfigSchema = z.strictObject({
  test_pattern: z.string().optional(),
  tag_whitelist: z.array(z.string()).optional(),
  tag_blacklist: z.array(z.string()).optional(),
  default_timeout: z.number().int().positive().optional(),
  game_speed: z.number().int().positive().optional(),
  log_passed_tests: z.boolean().optional(),
  log_skipped_tests: z.boolean().optional(),
})

export type TestRunnerConfig = z.infer<typeof testRunnerConfigSchema>

const _typeCheck: PublicTestRunnerConfig = {} as TestRunnerConfig
void _typeCheck

export const cliConfigSchema = z.object({
  modPath: z.string().optional(),
  modName: z.string().optional(),
  factorioPath: z.string().optional(),
  dataDirectory: z.string().optional(),
  save: z.string().optional(),
  mods: z.array(z.string()).optional(),
  verbose: z.boolean().optional(),
  showOutput: z.boolean().optional(),
  factorioArgs: z.array(z.string()).optional(),
  test: testRunnerConfigSchema.optional(),
})

export type CliConfig = z.infer<typeof cliConfigSchema>

interface CliOptionMeta {
  flags: string
  description: string
  parseArg?: (value: string) => unknown
}

const testRunnerCliOptions: Record<keyof TestRunnerConfig, CliOptionMeta> = {
  test_pattern: { flags: "--test-pattern <pattern>", description: "Pattern to filter tests" },
  tag_whitelist: { flags: "--tag-whitelist <tags...>", description: "Only run tests with these tags" },
  tag_blacklist: { flags: "--tag-blacklist <tags...>", description: "Skip tests with these tags" },
  default_timeout: {
    flags: "--default-timeout <ticks>",
    description: "Default test timeout in ticks",
    parseArg: parseInt,
  },
  game_speed: { flags: "--game-speed <speed>", description: "Game speed multiplier", parseArg: parseInt },
  log_passed_tests: { flags: "--log-passed-tests", description: "Log passed test names" },
  log_skipped_tests: { flags: "--log-skipped-tests", description: "Log skipped test names" },
}

export function registerTestRunnerOptions(command: Command<unknown[], Record<string, unknown>>): void {
  for (const [key, meta] of Object.entries(testRunnerCliOptions)) {
    if (meta.parseArg) {
      command.option(meta.flags, meta.description, meta.parseArg)
    } else {
      command.option(meta.flags, meta.description)
    }
    if (key === "log_passed_tests") {
      command.option("--no-log-passed-tests", "Don't log passed test names")
    }
  }
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

export function parseCliTestOptions(opts: Record<string, unknown>): Partial<TestRunnerConfig> {
  const result: Record<string, unknown> = {}
  for (const snake of Object.keys(testRunnerConfigSchema.shape)) {
    const camel = snakeToCamel(snake)
    if (opts[camel] !== undefined) {
      result[snake] = opts[camel]
    }
  }
  return result as Partial<TestRunnerConfig>
}

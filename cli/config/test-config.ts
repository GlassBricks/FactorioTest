import type { Command } from "@commander-js/extra-typings"
import { z } from "zod"
import type { TestRunnerConfig } from "../../types/config.js"

export type { TestRunnerConfig }

interface CliOptionMeta {
  flags: string
  description: string
  negatable?: boolean
  parseArg?: (value: string) => unknown
}

interface FieldDef {
  schema: z.ZodTypeAny
  cli: CliOptionMeta
}

const testConfigFields = {
  test_pattern: {
    schema: z.string().optional(),
    cli: {
      flags: "--test-pattern <pattern>",
      description: "Filter tests by Lua pattern (escape - as %-).",
    },
  },
  tag_whitelist: {
    schema: z.array(z.string()).optional(),
    cli: {
      flags: "--tag-whitelist <tags...>",
      description: "Only run tests with these tags.",
    },
  },
  tag_blacklist: {
    schema: z.array(z.string()).optional(),
    cli: {
      flags: "--tag-blacklist <tags...>",
      description: "Skip tests with these tags.",
    },
  },
  default_timeout: {
    schema: z.number().int().positive().optional(),
    cli: {
      flags: "--default-timeout <ticks>",
      description: "Default async test timeout in ticks.",
      parseArg: parseInt,
    },
  },
  game_speed: {
    schema: z.number().int().positive().optional(),
    cli: {
      flags: "--game-speed <speed>",
      description: "Game speed multiplier.",
      parseArg: parseInt,
    },
  },
  bail: {
    schema: z.number().int().positive().optional(),
    cli: {
      flags: "-b --bail [count]",
      description: "Stop after n failures (default: 1 when flag present).",
      parseArg: (v: string | undefined) => (v === undefined ? 1 : parseInt(v)),
    },
  },
  reorder_failed_first: {
    schema: z.boolean().optional(),
    cli: {
      flags: "--reorder-failed-first",
      description: "Run previously failed tests first (default: disabled).",
      negatable: true,
    },
  },
  log_passed_tests: {
    schema: z.boolean().optional(),
    cli: {
      flags: "--log-passed-tests",
      description: "Log passed test names (default: enabled).",
      negatable: true,
    },
  },
  log_skipped_tests: {
    schema: z.boolean().optional(),
    cli: {
      flags: "--log-skipped-tests",
      description: "Log skipped test names.",
    },
  },
} satisfies Record<string, FieldDef>

export const testRunnerConfigSchema: z.ZodType<TestRunnerConfig> = z.strictObject(
  Object.fromEntries(Object.entries(testConfigFields).map(([k, v]) => [k, v.schema])) as {
    [K in keyof typeof testConfigFields]: (typeof testConfigFields)[K]["schema"]
  },
)

export function registerTestConfigOptions(command: Command<unknown[], Record<string, unknown>>): void {
  for (const field of Object.values(testConfigFields) as FieldDef[]) {
    const cli = field.cli
    if (cli.parseArg) {
      command.option(cli.flags, cli.description, cli.parseArg)
    } else {
      command.option(cli.flags, cli.description)
    }
    if (cli.negatable) {
      const flagName = cli.flags.split(" ")[0].replace("--", "")
      command.option(`--no-${flagName}`, `Disable ${cli.description.toLowerCase().replace(/\.$/, "")}`)
    }
  }
}

function snakeToCamel(str: string): string {
  return str.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
}

export function parseCliTestOptions(opts: Record<string, unknown>, patterns: string[]): Partial<TestRunnerConfig> {
  const result: Record<string, unknown> = {}
  for (const snake of Object.keys(testConfigFields)) {
    const camel = snakeToCamel(snake)
    let value = opts[camel]
    if (value !== undefined) {
      if (snake === "bail" && value === true) {
        value = 1
      }
      result[snake] = value
    }
  }
  if (patterns.length > 0) {
    result.test_pattern = patterns.map((p) => `(${p})`).join("|")
  }
  return result as Partial<TestRunnerConfig>
}

import type { Command } from "@commander-js/extra-typings"
import { z } from "zod"
import { testRunnerConfigSchema } from "./test-config.js"

interface CliOptionMeta {
  flags: string
  description: string
  default?: string
  negatable?: boolean
  parseArg?: (value: string) => unknown
}

interface FieldDef {
  schema: z.ZodTypeAny
  cli?: CliOptionMeta
}

export const DEFAULT_DATA_DIRECTORY = "./factorio-test-data-dir"

const cliConfigFields = {
  modPath: {
    schema: z.string().optional(),
    cli: {
      flags: "--mod-path <path>",
      description: "Path to the mod folder (containing info.json). Either this or --mod-name must be specified.",
    },
  },
  modName: {
    schema: z.string().optional(),
    cli: {
      flags: "--mod-name <name>",
      description: "Name of the mod to test. The mod must already be in the data directory.",
    },
  },
  factorioPath: {
    schema: z.string().optional(),
    cli: {
      flags: "--factorio-path <path>",
      description: "The path to the factorio binary. If not specified, attempts to auto-detect the path.",
    },
  },
  dataDirectory: {
    schema: z.string().optional(),
    cli: {
      flags: "-d --data-directory <path>",
      description: "Factorio user data directory for the testing instance.",
      default: DEFAULT_DATA_DIRECTORY,
    },
  },
  save: {
    schema: z.string().optional(),
    cli: { flags: "--save <path>", description: "Path to save file" },
  },
  mods: {
    schema: z.array(z.string()).optional(),
    cli: {
      flags: "--mods <mods...>",
      description: 'Additional mods to enable. Example: "--mods mod1 mod2=1.2.3".',
    },
  },
  verbose: {
    schema: z.boolean().optional(),
    cli: {
      flags: "-v --verbose",
      description: "Enables more logging, and pipes the Factorio process output to stdout.",
    },
  },
  quiet: {
    schema: z.boolean().optional(),
    cli: { flags: "-q --quiet", description: "Suppress per-test output, show only final result." },
  },
  showOutput: {
    schema: z.boolean().optional(),
    cli: { flags: "--show-output", description: "Print test output to stdout." },
  },
  factorioArgs: {
    schema: z.array(z.string()).optional(),
    cli: { flags: "--factorio-args <args...>", description: "Additional arguments to pass to the Factorio process." },
  },
  forbidOnly: {
    schema: z.boolean().optional(),
    cli: { flags: "--forbid-only", description: "Fail if .only tests are present (default: true)", negatable: true },
  },
  outputFile: {
    schema: z.string().optional(),
    cli: { flags: "--output-file <path>", description: "Path to write test results JSON file" },
  },
  watchPatterns: {
    schema: z.array(z.string()).optional(),
    cli: {
      flags: "--watch-patterns <patterns...>",
      description: "Glob patterns to watch (default: info.json, **/*.lua)",
    },
  },
  udpPort: {
    schema: z.number().int().positive().optional(),
    cli: {
      flags: "--udp-port <port>",
      description: "UDP port for graphics watch mode rerun trigger (default: 14434)",
      parseArg: (v) => parseInt(v, 10),
    },
  },
} satisfies Record<string, FieldDef>

export const cliConfigSchema = z.object({
  ...(Object.fromEntries(Object.entries(cliConfigFields).map(([k, v]) => [k, v.schema])) as {
    [K in keyof typeof cliConfigFields]: (typeof cliConfigFields)[K]["schema"]
  }),
  test: testRunnerConfigSchema.optional(),
})

export type CliConfig = z.infer<typeof cliConfigSchema>

export function registerCliConfigOptions(command: Command<unknown[], Record<string, unknown>>): void {
  for (const field of Object.values(cliConfigFields) as FieldDef[]) {
    if (!field.cli) continue
    const cli = field.cli
    if (cli.parseArg) {
      command.option(cli.flags, cli.description, cli.parseArg, cli.default)
    } else if ("default" in cli && cli.default !== undefined) {
      command.option(cli.flags, cli.description, cli.default)
    } else {
      command.option(cli.flags, cli.description)
    }
    if (cli.negatable) {
      const flagName = cli.flags
        .split(" ")[0]
        .replace(/^-+/, "")
        .replace(/^[a-z] --/, "")
      command.option(`--no-${flagName}`, `Disable ${flagName}`)
    }
  }
  command.option("--no-output-file", "Disable writing test results file")
}

export interface CliOnlyOptions {
  config?: string
  graphics?: true
  watch?: true
}

export function registerCliOnlyOptions(command: Command<unknown[], Record<string, unknown>>): void {
  command.option("--config <path>", "Path to config file")
  command.option("--graphics", "Run with graphics (interactive mode). Default: headless.")
  command.option("-w --watch", "Watch mod directory and rerun tests on changes. With --graphics, uses UDP to trigger reloads (see --udp-port)")
}

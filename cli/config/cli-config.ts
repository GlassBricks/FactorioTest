import type { Command } from "@commander-js/extra-typings"
import { z } from "zod"
import { testRunnerConfigSchema, registerTestConfigOptions } from "./test-config.js"

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

export const fileConfigFields = {
  modPath: {
    schema: z.string().optional(),
    cli: {
      flags: "-p --mod-path <path>",
      description:
        "[one required] Path to the mod folder (containing info.json). Will create a symlink from mods folder to here.",
    },
  },
  modName: {
    schema: z.string().optional(),
    cli: {
      flags: "--mod-name <name>",
      description: "[one required] Name of a mod already in the configured data directory.",
    },
  },
  factorioPath: {
    schema: z.string().optional(),
    cli: {
      flags: "--factorio-path <path>",
      description: "Path to the Factorio binary. If not specified, will attempt to be auto-detected.",
    },
  },
  dataDirectory: {
    schema: z.string().optional(),
    cli: {
      flags: "-d --data-directory <path>",
      description: `Factorio data directory, where mods, saves, config etc. will be (default: "${DEFAULT_DATA_DIRECTORY}").`,
    },
  },
  save: {
    schema: z.string().optional(),
    cli: {
      flags: "--save <path>",
      description: "Path to save file. Default: uses a bundled save with empty lab-tile world.",
    },
  },
  mods: {
    schema: z.array(z.string()).optional(),
    cli: {
      flags: "--mods <mods...>",
      description: "Additional mods to enable besides the mod under test (e.g., --mods mod1 mod2=1.2.3).",
    },
  },
  factorioArgs: {
    schema: z.array(z.string()).optional(),
    cli: {
      flags: "--factorio-args <args...>",
      description: "Additional arguments to pass to Factorio process.",
    },
  },
  verbose: {
    schema: z.boolean().optional(),
    cli: {
      flags: "-v --verbose",
      description: "Enable verbose logging; pipe Factorio output to stdout.",
    },
  },
  quiet: {
    schema: z.boolean().optional(),
    cli: {
      flags: "-q --quiet",
      description: "Suppress per-test output, show only final result.",
    },
  },
  outputFile: {
    schema: z.string().optional(),
    cli: {
      flags: "--output-file <path>",
      description: "Path for test results JSON file. Used to reorder failed tests first on subsequent runs.",
    },
  },
  forbidOnly: {
    schema: z.boolean().optional(),
    cli: {
      flags: "--forbid-only",
      description: "Fail if .only tests are present (default: enabled). Useful for CI.",
      negatable: true,
    },
  },
  watchPatterns: {
    schema: z.array(z.string()).optional(),
    cli: {
      flags: "--watch-patterns <patterns...>",
      description: "Glob patterns to watch (default: info.json, **/*.lua).",
    },
  },
  udpPort: {
    schema: z.number().int().positive().optional(),
    cli: {
      flags: "--udp-port <port>",
      description: "UDP port to use for --graphics --watch mode reload trigger (default: 14434).",
      parseArg: (v) => parseInt(v, 10),
    },
  },
  outputTimeout: {
    schema: z.number().min(0).optional(),
    cli: {
      flags: "--output-timeout <seconds>",
      description:
        "Kill Factorio if no stdout/stderr output received within this many seconds. 0 to disable (default: 15).",
      parseArg: (v) => parseInt(v, 10),
    },
  },
} satisfies Record<string, FieldDef>

export const fileConfigSchema = z.object({
  ...(Object.fromEntries(Object.entries(fileConfigFields).map(([k, v]) => [k, v.schema])) as {
    [K in keyof typeof fileConfigFields]: (typeof fileConfigFields)[K]["schema"]
  }),
  test: testRunnerConfigSchema.optional(),
})

export type FileConfig = z.infer<typeof fileConfigSchema>

function addOption(command: Command<unknown[], Record<string, unknown>>, cli: CliOptionMeta): void {
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

export interface CliOnlyOptions {
  config?: string
  graphics?: true
  watch?: true
  autoStart?: false
}

export function registerAllCliOptions(command: Command<unknown[], Record<string, unknown>>): void {
  const f = fileConfigFields

  command.option(
    "-c --config <path>",
    "Path to config file (default: factorio-test.json, or 'factorio-test' key in package.json)",
  )
  command.option("-g --graphics", "Launch Factorio with graphics (interactive mode) instead of headless")
  command.option("-w --watch", "Watch for file changes and rerun tests")
  command.option("--no-auto-start", "Configure tests but do not auto-start them (requires --graphics)")

  addOption(command, f.modPath.cli!)
  addOption(command, f.modName.cli!)

  addOption(command, f.factorioPath.cli!)
  addOption(command, f.dataDirectory.cli!)
  addOption(command, f.save.cli!)
  addOption(command, f.mods.cli!)
  addOption(command, f.factorioArgs.cli!)

  registerTestConfigOptions(command)

  addOption(command, f.verbose.cli!)
  addOption(command, f.quiet.cli!)
  addOption(command, f.outputFile.cli!)
  command.option("--no-output-file", "Disable writing test results file")
  addOption(command, f.forbidOnly.cli!)

  addOption(command, f.outputTimeout.cli!)

  addOption(command, f.watchPatterns.cli!)
  addOption(command, f.udpPort.cli!)
}

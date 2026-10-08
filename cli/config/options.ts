import type { Command } from "@commander-js/extra-typings"
import { z } from "zod"

export const DEFAULT_DATA_DIRECTORY = "./factorio-test-data-dir"

interface OptionDef {
  flags: string
  description: string
  /** Description for `mods install` / `mods update`, if different. */
  modSetupDescription?: string
  schema: z.ZodTypeAny
  parseArg?: (value: string) => unknown
  preset?: unknown
  negation?: string
  isPath?: true
  forMod?: true
  /** Used by `mods install` / `mods update`, besides `run`. */
  forModSetup?: true
  cliOnly?: true
}

export const optionDefs = {
  modPath: {
    flags: "-p --mod-path <path>",
    description:
      "[one required] Path to the mod to test (folder containing info.json). Will create a symlink from mods folder to here.",
    modSetupDescription:
      "Path to the mod to test (folder containing info.json). Will create a symlink from mods folder to here.",
    schema: z.string().optional(),
    isPath: true,
    forModSetup: true,
  },
  modName: {
    flags: "--mod-name <name>",
    description: "[one required] Name of the mod to test, already configured in the data directory.",
    modSetupDescription: "Name of the mod to test, already in the configured data directory.",
    schema: z.string().optional(),
    forModSetup: true,
  },
  scenarioPath: {
    flags: "--scenario-path <path>",
    description:
      "[one required] Path to the scenario folder to test. Will create a symlink from the scenarios folder to here.",
    schema: z.string().optional(),
    isPath: true,
  },
  scenario: {
    flags: "--scenario <ref>",
    description:
      "[one required] Scenario to test, as [mod/]name. Expected to be already installed. Can be combined " +
      "with --mod-path, if the scenario is part of a local mod; in which case the mod will be installed, " +
      "but the scenario will be tested.",
    schema: z.string().optional(),
  },
  graphics: {
    flags: "-g --graphics",
    description: "Launch Factorio with graphics (interactive mode) instead of headless.",
    schema: z.boolean().optional(),
    cliOnly: true,
  },
  watch: {
    flags: "-w --watch",
    description: "Watch for file changes and rerun tests.",
    schema: z.boolean().optional(),
    cliOnly: true,
  },
  autoStart: {
    flags: "--no-auto-start",
    description: "Configure tests but do not auto-start them (requires --graphics).",
    schema: z.boolean().default(true),
    cliOnly: true,
  },
  factorioPath: {
    flags: "--factorio-path <path>",
    description: "Path to the Factorio binary. If not specified, will attempt to be auto-detected.",
    schema: z.string().optional(),
    isPath: true,
    forModSetup: true,
  },
  dataDirectory: {
    flags: "-d --data-directory <path>",
    description: "Factorio data directory, where mods, saves, config etc. will be.",
    schema: z.string().default(DEFAULT_DATA_DIRECTORY),
    isPath: true,
    forModSetup: true,
  },
  save: {
    flags: "--save <path>",
    description: "Path to save file. Default: uses a bundled save with empty lab-tile world.",
    schema: z.string().optional(),
    isPath: true,
  },
  startScenario: {
    flags: "--start-scenario <ref>",
    description:
      "May be used when testing a mod, not a scenario. Starts a new game from this scenario ([mod/]name) instead of the default save. To test a scenario, not a mod, use --scenario.",
    schema: z.string().optional(),
  },
  mods: {
    flags: "--mods <mods...>",
    description:
      'Mods to enable besides the mod under test and its dependencies, in info.json dependency format; "!name" leaves out a recommended dependency (e.g., --mods space-age "flib >= 0.16" "!quality").',
    schema: z.array(z.string()).optional(),
    forModSetup: true,
  },
  frozenLockfile: {
    flags: "--frozen-lockfile",
    description:
      "Fail if factorio-test.lock.json is missing or out of date, instead of updating it (default: enabled if the CI environment variable is set).",
    schema: z.boolean().optional(),
    negation: "Update factorio-test.lock.json if needed, even in CI.",
    forModSetup: true,
  },
  factorioArgs: {
    flags: "--factorio-args <args...>",
    description: "Additional arguments to pass to Factorio process.",
    schema: z.array(z.string()).optional(),
  },
  testPattern: {
    flags: "--test-pattern <pattern>",
    description: "Filter tests by Lua pattern (escape - as %-). Combined with filter arguments using OR logic.",
    schema: z.union([z.string(), z.array(z.string())]).optional(),
    forMod: true,
  },
  tagWhitelist: {
    flags: "--tag-whitelist <tags...>",
    description: "Only run tests with these tags.",
    schema: z.array(z.string()).optional(),
    forMod: true,
  },
  tagBlacklist: {
    flags: "--tag-blacklist <tags...>",
    description: "Skip tests with these tags.",
    schema: z.array(z.string()).optional(),
    forMod: true,
  },
  defaultTimeout: {
    flags: "--default-timeout <ticks>",
    description: "Default async test timeout in ticks.",
    schema: z.number().int().positive().optional(),
    parseArg: Number,
    forMod: true,
  },
  gameSpeed: {
    flags: "--game-speed <speed>",
    description: "Game speed multiplier.",
    schema: z.number().int().positive().optional(),
    parseArg: Number,
    forMod: true,
  },
  bail: {
    flags: "-b --bail [count]",
    description: "Stop after n failures.",
    schema: z.number().int().positive().optional(),
    parseArg: Number,
    preset: 1,
    forMod: true,
  },
  reorderFailedFirst: {
    flags: "--reorder-failed-first",
    description: "Run previously failed tests first (default: disabled).",
    schema: z.boolean().optional(),
    negation: "Run tests in declaration order.",
    forMod: true,
  },
  logPassedTests: {
    flags: "--log-passed-tests",
    description: "Log passed test names (default: enabled).",
    schema: z.boolean().optional(),
    negation: "Do not log passed test names.",
    forMod: true,
  },
  logSkippedTests: {
    flags: "--log-skipped-tests",
    description: "Log skipped test names.",
    schema: z.boolean().optional(),
    forMod: true,
  },
  step: {
    flags: "--step",
    description: "Pause before each test and step, to watch the run in a window (requires --graphics).",
    schema: z.boolean().optional(),
    forMod: true,
  },
  verbose: {
    flags: "-v --verbose",
    description: "Enable verbose logging; pipe Factorio output to stdout.",
    schema: z.boolean().optional(),
    forModSetup: true,
  },
  quiet: {
    flags: "-q --quiet",
    description: "Suppress per-test output, show only final result.",
    schema: z.boolean().optional(),
  },
  outputFile: {
    flags: "--output-file <path>",
    description: "Path for test results JSON file. Used to reorder failed tests first on subsequent runs.",
    schema: z.union([z.string(), z.literal(false)]).optional(),
    negation: "Disable writing test results file.",
    isPath: true,
  },
  forbidOnly: {
    flags: "--forbid-only",
    description: "Fail if .only tests are present. Useful for CI.",
    schema: z.boolean().default(true),
    negation: "Allow .only tests.",
  },
  outputTimeout: {
    flags: "--output-timeout <seconds>",
    description: "Kill Factorio if no stdout/stderr output received within this many seconds. 0 to disable.",
    schema: z.number().min(0).default(15),
    parseArg: Number,
  },
  watchPatterns: {
    flags: "--watch-patterns <patterns...>",
    description: "Glob patterns to watch.",
    schema: z.array(z.string()).default(["info.json", "**/*.lua"]),
  },
  udpPort: {
    flags: "--udp-port <port>",
    description: "UDP port to use for --graphics --watch mode reload trigger.",
    schema: z.number().int().positive().default(14434),
    parseArg: Number,
  },
} satisfies Record<string, OptionDef>

type OptionDefs = typeof optionDefs
export type OptionKey = keyof OptionDefs
type KeysWhere<Flag extends keyof OptionDef> = {
  [K in OptionKey]: OptionDefs[K] extends Record<Flag, true> ? K : never
}[OptionKey]
type CliOnlyKey = KeysWhere<"cliOnly">
export type ModOptionKey = KeysWhere<"forMod">

const defEntries = Object.entries(optionDefs) as [OptionKey, OptionDef][]

function keysWhere(predicate: (def: OptionDef) => boolean | undefined): OptionKey[] {
  return defEntries.filter(([, def]) => predicate(def)).map(([key]) => key)
}

export const pathOptionKeys = keysWhere((def) => def.isPath)
export const modOptionKeys = keysWhere((def) => def.forMod) as ModOptionKey[]

export const resolvedSchema = z.object(
  Object.fromEntries(defEntries.map(([key, def]) => [key, def.schema])) as {
    [K in OptionKey]: OptionDefs[K]["schema"]
  },
)

export const cliOptionsSchema = resolvedSchema.partial()

const cliOnlyMask = Object.fromEntries(keysWhere((def) => def.cliOnly).map((key) => [key, true])) as {
  [K in CliOnlyKey]: true
}
export const fileOptionsSchema = cliOptionsSchema.omit(cliOnlyMask)
export type FileOptions = z.output<typeof fileOptionsSchema>

export function longFlag(key: OptionKey): string {
  return optionDefs[key].flags.split(" ").find((flag) => flag.startsWith("--"))!
}

function formatDefault(value: unknown): string {
  if (typeof value === "boolean") return value ? "enabled" : "disabled"
  if (Array.isArray(value)) return value.join(", ")
  return JSON.stringify(value)
}

function helpDescription(def: OptionDef, description: string): string {
  if (!(def.schema instanceof z.ZodDefault) || def.flags.startsWith("--no-")) return description
  return `${description} (default: ${formatDefault(def.schema._def.defaultValue())})`
}

export function registerAllCliOptions(command: Command<unknown[], Record<string, unknown>>): void {
  registerCliOptions(command, defEntries, (def) => def.description)
}

export function registerModSetupCliOptions(
  command: Command<unknown[], Record<string, unknown>>,
  omit: OptionKey[] = [],
): void {
  registerCliOptions(
    command,
    defEntries.filter(([key, def]) => def.forModSetup && !omit.includes(key)),
    (def) => def.modSetupDescription ?? def.description,
  )
}

function registerCliOptions(
  command: Command<unknown[], Record<string, unknown>>,
  entries: [OptionKey, OptionDef][],
  description: (def: OptionDef) => string,
): void {
  for (const [key, def] of entries) {
    const option = command.createOption(def.flags, helpDescription(def, description(def)))
    if (def.parseArg) option.argParser(def.parseArg)
    if (def.preset !== undefined) option.preset(def.preset)
    command.addOption(option)
    if (def.negation) command.option(`--no-${longFlag(key).slice(2)}`, def.negation)
  }
  command.option(
    "-c --config <path>",
    "Path to config file (default: factorio-test.json, or 'factorio-test' key in package.json).",
  )
}

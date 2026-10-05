import type { Command } from "@commander-js/extra-typings"
import * as path from "path"
import { CliError } from "./cli-error.js"
import { registerModSetupCliOptions, resolveConfig, type ResolvedConfig } from "./config/index.js"
import { autoDetectFactorioPath } from "./factorio-process.js"
import { compareVersions, formatConstraint, majorMinor, satisfies } from "./mods/dependency.js"
import { type InstalledMods, installMods, type ModSetupInput } from "./mods/install.js"
import type { LockedMods } from "./mods/lock.js"
import { createModPortal, type ModPortal } from "./mods/portal.js"
import { setVerbose } from "./process-utils.js"
import { validateModSource } from "./run-plan.js"

/** Mod setup input shared by `run` and the `mods` commands. */
export function modSetupInput(config: ResolvedConfig, cliOptions: Record<string, unknown>): ModSetupInput {
  return {
    modsDir: path.join(config.dataDirectory, "mods"),
    factorioPath: config.factorioPath ?? autoDetectFactorioPath(),
    modPath: config.modPath,
    modName: config.modName,
    mods: config.mods,
    modsSource: cliOptions.mods === undefined ? "config mods" : "--mods",
    lockDir: config.configDir,
    frozen: config.frozenLockfile ?? !!process.env.CI,
  }
}

function resolveModSetupConfig(cliOptions: Record<string, unknown>): ResolvedConfig {
  const config = resolveConfig({ cliOptions, patterns: [] })
  setVerbose(!!config.verbose)
  validateModSource(config)
  return config
}

async function installCommand(args: string[], cliOptions: Record<string, unknown>): Promise<void> {
  const config = resolveModSetupConfig(cliOptions)
  if (args.length > 0) {
    const configFile = config.configFile ? path.basename(config.configFile) : "factorio-test.json"
    throw new CliError(`To add a mod, list it in "mods" in ${configFile}.`)
  }
  await installMods(modSetupInput(config, cliOptions))
}

async function updateCommand(names: string[], cliOptions: Record<string, unknown>): Promise<void> {
  const config = resolveModSetupConfig(cliOptions)
  const portal = createModPortal()
  const update = names.length > 0 ? new Set(names) : "all"
  const result = await installMods({ ...modSetupInput(config, cliOptions), frozen: false, update, portal })
  const lines = [...formatLockChanges(result.previousLock ?? {}, result.plannedLock)]
  lines.push(...(await formatHeldBack(result, portal, update)))
  console.log(lines.length > 0 ? lines.join("\n") : "All mods up to date.")
}

/** `flib 0.16.2 → 0.17.0`. */
export function formatLockChanges(previous: LockedMods, planned: LockedMods): string[] {
  const names = [...new Set([...Object.keys(previous), ...Object.keys(planned)])].sort()
  return names.flatMap((name) => {
    const before = previous[name]
    const after = planned[name]
    if (before === after) return []
    if (before === undefined) return [`${name} ${after} (added)`]
    if (after === undefined) return [`${name} ${before} (removed)`]
    return [`${name} ${before} → ${after}`]
  })
}

/** Updated mods whose newest compatible release is excluded by a constraint. */
async function formatHeldBack(
  { resolution, game }: InstalledMods,
  portal: ModPortal,
  update: ReadonlySet<string> | "all",
): Promise<string[]> {
  const lines: string[] = []
  for (const candidate of resolution.enabled.values()) {
    if (candidate.origin === "builtin" || candidate.origin === "mut" || candidate.origin === "user-managed") continue
    if (update !== "all" && !update.has(candidate.name)) continue
    const releases = (await portal.getReleases(candidate.name)) ?? []
    const newest = releases
      .filter(({ factorioVersion }) => factorioVersion === majorMinor(game.version))
      .map(({ version }) => version)
      .sort(compareVersions)
      .at(-1)
    if (!newest || compareVersions(newest, candidate.version) <= 0) continue
    const excluding = (resolution.imposed.get(candidate.name) ?? [])
      .filter(
        ({ dependency: { kind, constraint } }) =>
          kind !== "incompatible" && constraint && !satisfies(newest, constraint),
      )
      .map(({ dependency, from }) => `${formatConstraint(dependency.constraint!)} (from ${from})`)
    if (excluding.length === 0) continue
    lines.push(
      `${candidate.name} ${candidate.version}: ${newest} is available, but held back by ${excluding.join(", ")}`,
    )
  }
  return lines
}

export function registerModsCommand(program: Command): void {
  const modsCommand = program
    .command("mods")
    .summary("Install or update the mods used by test runs.")
    .description(
      `Install or update the mods used by test runs: the mod under test's dependencies, "mods" from the config, and factorio-test. Chosen versions are recorded in factorio-test.lock.json.`,
    )

  const install = modsCommand
    .command("install")
    .summary("Install the mods used by test runs, at the locked versions.")
    .description(
      `Resolves and downloads the mods used by test runs, preferring locked, then installed versions, and updates factorio-test.lock.json. Does not start Factorio or change which mods are enabled.
To add a mod, list it in "mods" in the config file.`,
    )
    .argument("[args...]")
  registerModSetupCliOptions(install)
  install.action((args, options) => installCommand(args, options as Record<string, unknown>))

  const update = modsCommand
    .command("update")
    .summary("Update mods to the newest versions allowed by the config.")
    .description(
      "Updates the named mods (all, if none named) to the newest mod portal release allowed by version constraints, and updates factorio-test.lock.json. Never frozen, even in CI.",
    )
    .argument("[names...]", "mods to update")
  registerModSetupCliOptions(update, ["frozenLockfile"])
  update.action((names, options) => updateCommand(names, options as Record<string, unknown>))
}

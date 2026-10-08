import * as fsp from "fs/promises"
import * as path from "path"
import { CliError } from "./cli-error.js"

/** Symlinks `sourcePath` as `<dir>/<name>`. Only an existing symlink is replaced; `hint` follows the error otherwise. */
export async function linkIntoDir(dir: string, sourcePath: string, name: string, hint: string): Promise<void> {
  const linkPath = path.join(dir, name)
  const stat = await fsp.lstat(linkPath).catch(() => undefined)
  if (stat && !stat.isSymbolicLink()) {
    throw new CliError(`${linkPath} already exists and is not a symlink. ${hint}`)
  }
  await fsp.mkdir(dir, { recursive: true })
  if (stat) await fsp.rm(linkPath)
  await fsp.symlink(path.resolve(sourcePath), linkPath, "junction")
}

/** Symlinks `--scenario-path` into `<dataDir>/scenarios`, named after its folder. Returns that name. */
export async function linkScenario(dataDir: string, scenarioPath: string): Promise<string> {
  const name = path.basename(path.resolve(scenarioPath))
  await linkIntoDir(path.join(dataDir, "scenarios"), scenarioPath, name, `Remove it, or use --scenario ${name}.`)
  return name
}

/** TGT-6: a scenario in the data dir must exist; a mod's scenario is left to Factorio. */
export async function checkScenarioExists(dataDir: string, name: string): Promise<void> {
  const scenarioPath = path.join(dataDir, "scenarios", name)
  if (await fsp.stat(scenarioPath).catch(() => undefined)) return
  throw new CliError(`Scenario ${name} not found in ${path.dirname(scenarioPath)}.`)
}

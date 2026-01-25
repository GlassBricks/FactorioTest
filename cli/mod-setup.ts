import * as fsp from "fs/promises"
import * as fs from "fs"
import * as path from "path"
import { runScript, runProcess } from "./process-utils.js"
import { getFactorioPlayerDataPath } from "./factorio-discovery.js"
import { CliError } from "./cli-error.js"

const MIN_FACTORIO_TEST_VERSION = "3.0.0"

type Version = [number, number, number]

function parseVersion(version: string): Version {
  const parts = version.split(".").map(Number)
  return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0]
}

function compareVersions(a: string, b: string): number {
  const [aMajor, aMinor, aPatch] = parseVersion(a)
  const [bMajor, bMinor, bPatch] = parseVersion(b)
  if (aMajor !== bMajor) return aMajor - bMajor
  if (aMinor !== bMinor) return aMinor - bMinor
  return aPatch - bPatch
}

export async function configureModToTest(
  modsDir: string,
  modPath?: string,
  modName?: string,
  verbose?: boolean,
): Promise<string> {
  if (modPath) {
    if (verbose) console.log("Creating mod symlink", modPath)
    return configureModPath(modPath, modsDir)
  } else {
    await configureModName(modsDir, modName!)
    return modName!
  }
}

async function configureModPath(modPath: string, modsDir: string): Promise<string> {
  modPath = path.resolve(modPath)
  const infoJsonFile = path.join(modPath, "info.json")
  let infoJson: { name: unknown }
  try {
    infoJson = JSON.parse(await fsp.readFile(infoJsonFile, "utf8")) as { name: unknown }
  } catch (e) {
    throw new CliError(`Could not read info.json file from ${modPath}`, { cause: e })
  }
  const modName = infoJson.name
  if (typeof modName !== "string") {
    throw new CliError(`info.json file at ${infoJsonFile} does not contain a string property "name".`)
  }
  const resultPath = path.join(modsDir, modName)
  const stat = await fsp.stat(resultPath).catch(() => undefined)
  if (stat) await fsp.rm(resultPath, { recursive: true })

  await fsp.symlink(modPath, resultPath, "junction")
  return modName
}

async function configureModName(modsDir: string, modName: string): Promise<void> {
  const exists = await checkModExists(modsDir, modName)
  if (!exists) {
    throw new CliError(`Mod ${modName} not found in ${modsDir}.`)
  }
}

export async function checkModExists(modsDir: string, modName: string): Promise<boolean> {
  const stat = await fsp.stat(modsDir).catch(() => undefined)
  if (!stat?.isDirectory()) return false

  const files = await fsp.readdir(modsDir)
  return files.some((f) => {
    const fileStat = fs.statSync(path.join(modsDir, f), { throwIfNoEntry: false })
    if (fileStat?.isDirectory()) {
      return f === modName || f.match(new RegExp(`^${modName}_\\d+\\.\\d+\\.\\d+$`))
    }
    if (fileStat?.isFile()) {
      return f === modName + ".zip" || f.match(new RegExp(`^${modName}_\\d+\\.\\d+\\.\\d+\\.zip$`))
    }
    return false
  })
}

async function getInstalledModVersion(modsDir: string, modName: string): Promise<string | undefined> {
  const stat = await fsp.stat(modsDir).catch(() => undefined)
  if (!stat?.isDirectory()) return undefined

  const files = await fsp.readdir(modsDir)
  for (const f of files) {
    const fullPath = path.join(modsDir, f)
    const fileStat = fs.statSync(fullPath, { throwIfNoEntry: false })

    if (fileStat?.isDirectory()) {
      if (f === modName) {
        const infoPath = path.join(fullPath, "info.json")
        try {
          const info = JSON.parse(await fsp.readFile(infoPath, "utf8")) as { version?: string }
          if (info.version) return info.version
        } catch {
          continue
        }
      }
      const versionedMatch = f.match(new RegExp(`^${modName}_(\\d+\\.\\d+\\.\\d+)$`))
      if (versionedMatch) {
        const infoPath = path.join(fullPath, "info.json")
        try {
          const info = JSON.parse(await fsp.readFile(infoPath, "utf8")) as { version?: string }
          if (info.version) return info.version
        } catch {
          return versionedMatch[1]
        }
      }
    }

    if (fileStat?.isFile()) {
      const zipMatch = f.match(new RegExp(`^${modName}_(\\d+\\.\\d+\\.\\d+)\\.zip$`))
      if (zipMatch) return zipMatch[1]
    }
  }
  return undefined
}

export async function installFactorioTest(modsDir: string): Promise<void> {
  await fsp.mkdir(modsDir, { recursive: true })
  const playerDataPath = getFactorioPlayerDataPath()

  let version = await getInstalledModVersion(modsDir, "factorio-test")

  if (!version) {
    console.log("Downloading factorio-test from mod portal using fmtk.")
    await runScript("fmtk", "mods", "install", "--modsPath", modsDir, "--playerData", playerDataPath, "factorio-test")
    version = await getInstalledModVersion(modsDir, "factorio-test")
  } else if (compareVersions(version, MIN_FACTORIO_TEST_VERSION) < 0) {
    console.log(`factorio-test ${version} is outdated, downloading latest version.`)
    await runScript(
      "fmtk",
      "mods",
      "install",
      "--force",
      "--modsPath",
      modsDir,
      "--playerData",
      playerDataPath,
      "factorio-test",
    )
    version = await getInstalledModVersion(modsDir, "factorio-test")
  }

  if (!version || compareVersions(version, MIN_FACTORIO_TEST_VERSION) < 0) {
    throw new CliError(
      `factorio-test mod version ${version ?? "unknown"} is below minimum required ${MIN_FACTORIO_TEST_VERSION}`,
    )
  }
}

export async function ensureConfigIni(dataDir: string): Promise<void> {
  const filePath = path.join(dataDir, "config.ini")
  if (!fs.existsSync(filePath)) {
    console.log("Creating config.ini file")
    await fsp.writeFile(
      filePath,
      `; This file was auto-generated by factorio-test cli

[path]
read-data=__PATH__executable__/../../data
write-data=${dataDir}

[general]
locale=
`,
    )
  } else {
    const content = await fsp.readFile(filePath, "utf8")
    const newContent = content.replace(/^write-data=.*$/m, `write-data=${dataDir}`)
    if (content !== newContent) {
      await fsp.writeFile(filePath, newContent)
    }
  }
}

export interface AutorunOptions {
  verbose?: boolean
  lastFailedTests?: string[]
}

export async function setSettingsForAutorun(
  factorioPath: string,
  dataDir: string,
  modsDir: string,
  modToTest: string,
  mode: "headless" | "graphics",
  options?: AutorunOptions,
): Promise<void> {
  const settingsDat = path.join(modsDir, "mod-settings.dat")
  if (!fs.existsSync(settingsDat)) {
    if (options?.verbose) console.log("Creating mod-settings.dat file by running factorio")
    const dummySaveFile = path.join(dataDir, "____dummy_save_file.zip")
    await runProcess(
      false,
      factorioPath,
      "--create",
      dummySaveFile,
      "--mod-directory",
      modsDir,
      "-c",
      path.join(dataDir, "config.ini"),
    )

    if (fs.existsSync(dummySaveFile)) {
      await fsp.rm(dummySaveFile)
    }
  }
  if (options?.verbose) console.log("Setting autorun settings")
  const autoStartConfig = JSON.stringify({
    mod: modToTest,
    headless: mode === "headless",
    ...(options?.lastFailedTests?.length && { last_failed_tests: options.lastFailedTests }),
  })
  await runScript(
    "fmtk",
    "settings",
    "set",
    "startup",
    "factorio-test-auto-start-config",
    autoStartConfig,
    "--modsPath",
    modsDir,
  )
}

export async function resetAutorunSettings(modsDir: string, verbose?: boolean): Promise<void> {
  if (verbose) console.log("Disabling auto-start settings")
  await runScript("fmtk", "settings", "set", "startup", "factorio-test-auto-start-config", "{}", "--modsPath", modsDir)
}

export function parseRequiredDependencies(dependencies: string[]): string[] {
  const result: string[] = []
  for (const dep of dependencies) {
    const trimmed = dep.trim()
    if (trimmed.startsWith("?") || trimmed.startsWith("!") || trimmed.startsWith("(?)")) {
      continue
    }
    const withoutPrefix = trimmed.startsWith("~") ? trimmed.slice(1).trim() : trimmed
    const modName = withoutPrefix.split(/\s/)[0]
    if (modName && modName !== "base") {
      result.push(modName)
    }
  }
  return result
}

export async function installModDependencies(modsDir: string, modPath: string, verbose?: boolean): Promise<string[]> {
  const infoJsonPath = path.join(modPath, "info.json")
  let infoJson: { dependencies?: string[] }
  try {
    infoJson = JSON.parse(await fsp.readFile(infoJsonPath, "utf8")) as { dependencies?: string[] }
  } catch {
    return []
  }

  const dependencies = infoJson.dependencies
  if (!Array.isArray(dependencies)) return []

  const required = parseRequiredDependencies(dependencies)
  const playerDataPath = getFactorioPlayerDataPath()

  for (const modName of required) {
    const exists = await checkModExists(modsDir, modName)
    if (exists) continue

    if (verbose) console.log(`Installing dependency: ${modName}`)
    await runScript("fmtk", "mods", "install", "--modsPath", modsDir, "--playerData", playerDataPath, modName)
  }

  return required
}

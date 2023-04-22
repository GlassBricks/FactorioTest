import { program } from "@commander-js/extra-typings"
import * as os from "os"
import * as fsp from "fs/promises"
import * as fs from "fs"
import * as path from "path"
import { spawn } from "child_process"
import BufferReadLine from "./buffer-read-line.js"
import chalk from "chalk"

program
  .command("run")
  .summary("Runs tests with Factorio test.")
  .description("Runs tests for the specified mod with Factorio test. Exits with code 0 only if all tests pass.")
  .option(
    "--mod-path <path>",
    "The path to your mod files (containing info.json). If specified, the name of the mod will be determined from the info.json files, and a symlink will be made from factorio mods directory to this path.",
  )
  .option(
    "--mod-name <path>",
    "The name of the mod to test; must already be present in the mods directory. One of --mod-path or --mod-name must be specified.",
  )
  .option(
    "--factorio-path <path>",
    "The path to the factorio installation. If not specified, tries to auto-detect the factorio path.",
  )
  .option(
    "-d --data-directory <path>",
    'The path to the data directory. Defaults to "./factorio-test".',
    "./factorio-test",
  )
  .addHelpText("after", `You should have a symlink to or copy of your mod in the specified data directory.`)
  .action((options) => runTests(options))

async function runTests(options: { factorioPath?: string; modPath?: string; modName?: string; dataDirectory: string }) {
  if (options.modPath !== undefined && options.modName !== undefined) {
    throw new Error("Only one of --mod-path or --mod-name can be specified.")
  }
  if (options.modPath === undefined && options.modName === undefined) {
    throw new Error("One of --mod-path or --mod-name must be specified.")
  }

  const factorioPath = options.factorioPath ?? autoDetectFactorioPath()
  const dataDir = path.resolve(options.dataDirectory)
  const modsDir = path.join(dataDir, "mods")
  await fsp.mkdir(modsDir, { recursive: true })

  const modToTest = await configureModToTest(modsDir, options.modPath, options.modName)
  await installFactorioTest(modsDir)

  await runScript("fmtk", "mods", "adjust", "--modsPath", modsDir, "factorio-test=true", modToTest + "=true")
  await ensureConfigIni(dataDir)
  await setSettingsForAutorun(factorioPath, dataDir, modsDir, modToTest)

  await runFactorioTests(factorioPath, dataDir)
}

async function configureModToTest(modsDir: string, modPath?: string, modName?: string): Promise<string> {
  if (modPath) {
    return configureModPath(modPath, modsDir)
  } else {
    await configureModName(modsDir, modName!)
    return modName!
  }
}

async function configureModPath(modPath: string, modsDir: string) {
  modPath = path.resolve(modPath)
  const infoJsonFile = path.join(modPath, "info.json")
  let infoJson: { name: unknown }
  try {
    infoJson = JSON.parse(await fsp.readFile(infoJsonFile, "utf8")) as { name: unknown }
  } catch (e) {
    throw new Error(`Could not read info.json file from ${modPath}`, { cause: e })
  }
  const modName = infoJson.name
  if (typeof modName !== "string") {
    throw new Error(`info.json file at ${infoJsonFile} does not contain a string property "name".`)
  }
  // make symlink modsDir/modName -> modPath
  // delete if exists
  const resultPath = path.join(modsDir, modName)
  const stat = await fsp.stat(resultPath).catch(() => undefined)
  if (stat) await fsp.rm(resultPath, { recursive: true })

  await fsp.symlink(modPath, resultPath, "junction")

  return modName
}

async function configureModName(modsDir: string, modName: string) {
  // check if modName is in modsDir
  const alreadyExists = await checkModExists(modsDir, modName)
  if (!alreadyExists) {
    throw new Error(`Mod ${modName} not found in ${modsDir}.`)
  }
  return modName
}

async function checkModExists(modsDir: string, modName: string) {
  const alreadyExists =
    (await fsp.stat(modsDir).catch(() => undefined))?.isDirectory() &&
    (await fsp.readdir(modsDir))?.find((f) => {
      const stat = fs.statSync(path.join(modsDir, f), { throwIfNoEntry: false })
      if (stat?.isDirectory()) {
        return f === modName || f.match(new RegExp(`^${modName}_\\d+\\.\\d+\\.\\d+$`))
      }
      if (stat?.isFile()) {
        return f === modName + ".zip" || f.match(new RegExp(`^${modName}_\\d+\\.\\d+\\.\\d+\\.zip$`))
      }
    })
  return !!alreadyExists
}

async function installFactorioTest(modsDir: string) {
  await fsp.mkdir(modsDir, { recursive: true })

  // const testModName = "testorio"
  const testModName = "factorio-test"

  // if not found, install it
  const alreadyExists = await checkModExists(modsDir, testModName)
  if (!alreadyExists) {
    console.log(`Installing ${testModName}...`)
    await runScript("fmtk", "mods", "install", "--modsPath", modsDir, testModName)
  }
}

async function ensureConfigIni(dataDir: string) {
  const filePath = path.join(dataDir, "config.ini")
  if (!fs.existsSync(filePath)) {
    await fsp.writeFile(
      filePath,
      `
;this file is auto-generated by factorio-test
[path]
read-data=__PATH__executable__/../../data
write-data=${dataDir}
`,
    )
  }
}

async function setSettingsForAutorun(factorioPath: string, dataDir: string, modsDir: string, modToTest: string) {
  // touch modsDir/mod-settings.dat
  const settingsDat = path.join(modsDir, "mod-settings.dat")
  if (!fs.existsSync(settingsDat)) {
    // run factorio once to create it
    console.log(
      "running factorio once to generate mod-settings.dat. You can safely delete the created save file later.",
    )
    await runProcess(
      factorioPath,
      "--create",
      "__test",
      "--mod-directory",
      modsDir,
      "-c",
      path.join(dataDir, "config.ini"),
    )
  }
  await runScript("fmtk settings set startup factorio-test-auto-start true", "--modsPath", modsDir)
  await runScript("fmtk settings set runtime-global factorio-test-mod-to-test", modToTest, "--modsPath", modsDir)
}

async function runFactorioTests(factorioPath: string, dataDir: string) {
  const args = program.args
  const index = args.indexOf("--")
  const additionalArgs = index >= 0 ? args.slice(index + 1) : []

  const actualArgs = [
    "--load-scenario",
    "factorio-test/Test",
    "--mod-directory",
    path.join(dataDir, "mods"),
    "-c",
    path.join(dataDir, "config.ini"),
    "--graphics-quality",
    "very-low",
    ...additionalArgs,
  ]
  const factorioProcess = spawn(factorioPath, actualArgs, {
    stdio: ["inherit", "pipe", "inherit"],
  })

  let resultMessage: string | undefined = undefined
  new BufferReadLine(factorioProcess.stdout).on("line", (data) => {
    if (data.startsWith("FACTORIO-TEST:")) {
      resultMessage = data.slice("FACTORIO-TEST:".length)
      factorioProcess.kill()
    } else {
      console.log(data)
    }
  })
  await new Promise<void>((resolve, reject) => {
    factorioProcess.on("exit", (code) => {
      if (code === 0 || resultMessage !== undefined) {
        resolve()
      } else {
        reject(new Error(`Factorio exited with code ${code}`))
      }
    })
  })
  if (resultMessage) {
    const color =
      resultMessage == "passed" ? chalk.greenBright : resultMessage == "todo" ? chalk.yellowBright : chalk.redBright
    console.log("Test run result:", color(resultMessage))
    process.exit(resultMessage === "passed" ? 0 : 1)
  }
}

function runScript(...command: string[]) {
  return runProcess("npx", ...command)
}

function runProcess(command: string, ...args: string[]) {
  console.log("Running:", command, ...args)
  // run another npx command
  const process = spawn(command, args, {
    stdio: "inherit",
    shell: true,
  })
  return new Promise<void>((resolve, reject) => {
    process.on("exit", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command exited with code ${code}`))
      }
    })
  })
}

function autoDetectFactorioPath(): string {
  let pathsToTry: string[]
  // check if is linux
  if (os.platform() === "linux" || os.platform() === "darwin") {
    pathsToTry = [
      "factorio",
      "~/.local/share/Steam/steamapps/common/Factorio/bin/x64/factorio",
      "~/Library/Application Support/Steam/steamapps/common/Factorio/factorio.app/Contents/MacOS/factorio",
      "~/.factorio/bin/x64/factorio",
      "/Applications/factorio.app/Contents/MacOS/factorio",
      "/usr/share/factorio/bin/x64/factorio",
      "/usr/share/games/factorio/bin/x64/factorio",
    ]
  } else if (os.platform() === "win32") {
    pathsToTry = [
      "factorio.exe",
      process.env["ProgramFiles(x86)"] + "\\Steam\\steamapps\\common\\Factorio\\bin\\x64\\factorio.exe",
      process.env["ProgramFiles"] + "\\Factorio\\bin\\x64\\factorio.exe",
    ]
  } else {
    throw new Error(`Can not auto-detect factorio path on platform ${os.platform()}`)
  }
  pathsToTry = pathsToTry.map((p) => p.replace(/^~\//, os.homedir() + "/"))

  for (const testPath of pathsToTry) {
    if (fs.statSync(testPath, { throwIfNoEntry: false })?.isFile()) {
      return path.resolve(testPath)
    }
  }
  throw new Error(
    `Could not auto-detect factorio executable. Tried: ${pathsToTry.join(
      ", ",
    )}. Either add the factorio bin to your path, or specify the path with --factorio-path`,
  )
}

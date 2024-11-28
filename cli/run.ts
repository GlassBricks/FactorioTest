import { program } from "commander"
import * as os from "os"
import * as fsp from "fs/promises"
import * as fs from "fs"
import * as path from "path"
import { spawn, spawnSync } from "child_process"
import BufferLineSplitter from "./buffer-line-splitter.js"
import chalk from "chalk"
import type { Command } from "@commander-js/extra-typings"
import * as process from "node:process"

const thisCommand = (program as unknown as Command)
  .command("run")
  .summary("Runs tests with Factorio test.")
  .description("Runs tests for the specified mod with Factorio test. Exits with code 0 only if all tests pass.\n")
  .argument(
    "[mod-path]",
    "The path to the mod to test (containing info.json). A symlink will be created in the mods folder to this folder. Alternatively, you can specify --mod-name for manual setup.",
  )
  .option(
    "--mod-name <name>",
    "The name of the mod to test. If specified, the mod must already be present in the mods directory (sse --data-directory below). One of [mod-path] or --mod-name must be specified.",
  )
  .option(
    "--factorio-path <path>",
    "The path to the factorio binary. If not specified, tries to auto-detect the factorio installation.",
  )
  .option(
    "-d --data-directory <path>",
    'The path to the data directory. The "config.ini" file and the "mods" folder will be in this directory.',
    "./factorio-test-data",
  )
  .option("--show-output", "Prints test output to stdout.", true)
  .option(
    "-v --verbose",
    "Enables more logging, and prints all outputs of the Factorio process to stdout (not just test output).",
  )
  .addHelpText("after", 'Options passed after "--" are passed as Factorio launch arguments.')
  .action((modPath, options) => runTests(modPath, options))

async function runTests(
  modPath: string | undefined,
  options: {
    factorioPath?: string
    modName?: string
    dataDirectory: string
    verbose?: true
  },
) {
  if (modPath !== undefined && options.modName !== undefined) {
    throw new Error("Only one of --mod-path or --mod-name can be specified.")
  }
  if (modPath === undefined && options.modName === undefined) {
    throw new Error("One of --mod-path or --mod-name must be specified.")
  }

  const factorioPath = options.factorioPath ?? autoDetectFactorioPath()
  const dataDir = path.resolve(options.dataDirectory)
  const modsDir = path.join(dataDir, "mods")
  await fsp.mkdir(modsDir, { recursive: true })

  const modToTest = await configureModToTest(modsDir, modPath, options.modName)
  await installFactorioTest(modsDir)

  if (options.verbose) console.log("Enabling mods", modToTest, "and factorio-test")
  await runScript("fmtk mods adjust", "--modsPath", modsDir, "factorio-test=true", modToTest + "=true")
  await ensureConfigIni(dataDir)
  await setSettingsForAutorun(factorioPath, dataDir, modsDir, modToTest)

  let resultMessage: string | undefined
  try {
    resultMessage = await runFactorioTests(factorioPath, dataDir)
  } finally {
    if (options.verbose) console.log("Disabling auto-start settings")
    await runScript("fmtk settings set startup factorio-test-auto-start false", "--modsPath", modsDir)
  }
  if (resultMessage) {
    const color =
      resultMessage == "passed" ? chalk.greenBright : resultMessage == "todo" ? chalk.yellowBright : chalk.redBright
    console.log("Test run result:", color(resultMessage))
    process.exit(resultMessage === "passed" ? 0 : 1)
  }
}

async function configureModToTest(modsDir: string, modPath?: string, modName?: string): Promise<string> {
  if (modPath) {
    if (thisCommand.opts().verbose) console.log("Creating mod symlink", modPath)
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

  const testModName = "factorio-test"

  // if not found, install it
  const alreadyExists = await checkModExists(modsDir, testModName)
  if (!alreadyExists) {
    console.log(`Downloading ${testModName} from mod portal using fmtk. This may ask for factorio login credentials.`)
    await runScript("fmtk mods install", "--modsPath", modsDir, testModName)
  }
}

async function ensureConfigIni(dataDir: string) {
  const filePath = path.join(dataDir, "config.ini")
  if (!fs.existsSync(filePath)) {
    console.log("Creating config.ini file")
    await fsp.writeFile(
      filePath,
      `
; This file was auto-generated by factorio-test cli

[path]
read-data=__PATH__executable__/../../data
write-data=${dataDir}

[general]
locale=
`,
    )
  }
}

async function setSettingsForAutorun(factorioPath: string, dataDir: string, modsDir: string, modToTest: string) {
  // touch modsDir/mod-settings.dat
  const settingsDat = path.join(modsDir, "mod-settings.dat")
  if (!fs.existsSync(settingsDat)) {
    if (thisCommand.opts().verbose) console.log("Creating mod-settings.dat file by running factorio")
    // run factorio once to create it
    const dummySaveFile = path.join(dataDir, "____dummy_save_file.zip")
    await runProcess(
      false,
      `"${factorioPath}"`,
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
  if (thisCommand.opts().verbose) console.log("Setting autorun settings")
  await runScript("fmtk settings set startup factorio-test-auto-start true", "--modsPath", modsDir)
  await runScript("fmtk settings set runtime-global factorio-test-mod-to-test", modToTest, "--modsPath", modsDir)
}

async function runFactorioTests(factorioPath: string, dataDir: string) {
  const args = process.argv
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
    "low",
    ...additionalArgs,
  ]
  console.log("Running tests...")
  const factorioProcess = spawn(factorioPath, actualArgs, {
    stdio: ["inherit", "pipe", "inherit"],
  })

  const verbose = thisCommand.opts().verbose
  const showOutput = thisCommand.opts().showOutput

  let resultMessage: string | undefined = undefined
  let isMessage = false
  let isMessageFirstLine = true
  new BufferLineSplitter(factorioProcess.stdout).on("line", (line) => {
    if (line.startsWith("FACTORIO-TEST-RESULT:")) {
      resultMessage = line.slice("FACTORIO-TEST-RESULT:".length)
      factorioProcess.kill()
    } else if (line === "FACTORIO-TEST-MESSAGE-START") {
      isMessage = true
      isMessageFirstLine = true
    } else if (line === "FACTORIO-TEST-MESSAGE-END") {
      isMessage = false
    } else if (verbose) {
      console.log(line)
    } else if (isMessage && showOutput) {
      if (isMessageFirstLine) {
        console.log(line.slice(line.indexOf(": ") + 2))
        isMessageFirstLine = false
      } else {
        // print line with tab
        console.log("    " + line)
      }
    }
  })
  await new Promise<void>((resolve, reject) => {
    factorioProcess.on("exit", (code, signal) => {
      if (code === 0 && resultMessage !== undefined) {
        resolve()
      } else {
        reject(new Error(`Factorio exited with code ${code}, signal ${signal}`))
      }
    })
  })
  return resultMessage
}

function runScript(...command: string[]) {
  return runProcess(true, "npx", ...command)
}

function runProcess(inheritStdio: boolean, command: string, ...args: string[]) {
  if (thisCommand.opts().verbose) console.log("Running:", command, ...args)
  // run another npx command
  const process = spawn(command, args, {
    stdio: inheritStdio ? "inherit" : "ignore",
    shell: true,
  })
  return new Promise<void>((resolve, reject) => {
    process.on("error", reject)
    process.on("exit", (code) => {
      if (code === 0) {
        resolve()
      } else {
        reject(new Error(`Command exited with code ${code}: ${command} ${args.join(" ")}`))
      }
    })
  })
}

function factorioIsInPath(): boolean {
  const result = spawnSync("factorio", ["--version"], { stdio: "ignore" })
  return result.status === 0
}

function autoDetectFactorioPath(): string {
  if (factorioIsInPath()) {
    return "factorio"
  }
  let pathsToTry: string[]
  // check if is linux
  if (os.platform() === "linux" || os.platform() === "darwin") {
    pathsToTry = [
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

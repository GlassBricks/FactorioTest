import * as os from "os"
import * as fs from "fs"
import * as path from "path"
import { spawnSync } from "child_process"
import { CliError } from "./cli-error.js"

function factorioIsInPath(): boolean {
  const result = spawnSync("factorio", ["--version"], { stdio: "ignore" })
  return result.status === 0
}

export function autoDetectFactorioPath(): string {
  if (factorioIsInPath()) {
    return "factorio"
  }

  let pathsToTry: string[]
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
    throw new CliError(`Cannot auto-detect factorio path on platform ${os.platform()}`)
  }

  pathsToTry = pathsToTry.map((p) => p.replace(/^~\//, os.homedir() + "/"))

  for (const testPath of pathsToTry) {
    if (fs.statSync(testPath, { throwIfNoEntry: false })?.isFile()) {
      return path.resolve(testPath)
    }
  }

  throw new CliError(
    `Could not auto-detect factorio executable. Tried: ${pathsToTry.join(", ")}. ` +
      "Either add the factorio bin to your path, or specify the path with --factorio-path",
  )
}

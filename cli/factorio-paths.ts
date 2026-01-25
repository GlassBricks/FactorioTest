import * as os from "os"
import * as path from "path"

export function getFactorioPlayerDataPath(): string {
  const platform = os.platform()
  if (platform === "win32") {
    return path.join(process.env.APPDATA!, "Factorio", "player-data.json")
  }
  if (platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "factorio", "player-data.json")
  }
  return path.join(os.homedir(), ".factorio", "player-data.json")
}

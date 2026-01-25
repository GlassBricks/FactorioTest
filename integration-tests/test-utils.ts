import * as fs from "fs"
import * as path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const root = path.resolve(__dirname, "..")

export async function symlinkLocalFactorioTest(modsDir: string): Promise<void> {
  await fs.promises.mkdir(modsDir, { recursive: true })
  const localModPath = path.join(root, "mod")
  const symlinkPath = path.join(modsDir, "factorio-test")
  await fs.promises.symlink(localModPath, symlinkPath, "junction")
}

import { fileURLToPath } from "url"
import * as path from "path"
import * as fs from "fs"
import { mkdirSync } from "fs"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, "..")

// create "factorio" directory

const factorioDir = path.join(root, "factorio-test")

const modsDir = path.join(factorioDir, "mods")
mkdirSync(modsDir, { recursive: true })

function tryMakeSymlink(target: string, dest: string) {
  if(fs.existsSync(dest)) fs.unlinkSync(dest)
  fs.symlinkSync(target, dest, "junction")
}

tryMakeSymlink(path.join(root, "src"), path.join(modsDir, "factorio-test"))

tryMakeSymlink(path.join(root, "usage-test-mod"), path.join(modsDir, "__factorio-usage-test-mod"))

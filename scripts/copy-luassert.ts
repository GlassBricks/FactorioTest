import * as path from "path"
import { deleteAsync } from "del"
import * as fs from "fs/promises"
import * as globby from "globby"
import { fileURLToPath } from "url"

// __dirname patch

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const root = path.resolve(__dirname, "..")

const outDir = path.resolve(root, "src")

async function copyLuassert() {
  const repo = path.join(root, "luassert")
  const repoSrc = path.join(repo, "src")
  const destination = path.join(outDir, "luassert")

  await deleteAsync(["**/*", "!**/*.ts"], {
    cwd: destination,
  })
  const licenseDest = path.join(destination, "LICENSE")
  await fs.mkdir(path.dirname(licenseDest), {
    recursive: true,
  })
  await fs.copyFile(path.join(repo, "LICENSE"), licenseDest)

  for await (const file of globby.stream("**/*.lua", {
    cwd: repoSrc,
  })) {
    const fileContents = await fs.readFile(path.join(repoSrc, file.toString()), "utf-8")
    const newContents = fileContents.replace(
      /((?:^|\s|;|=)require ?\(?['"])(.+?['"]\)?)/gm,
      (str, first, second) => first + "__factorio-test__." + second,
    )
    const outFile = path.join(destination, file.toString())
    await fs.mkdir(path.dirname(outFile), {
      recursive: true,
    })
    await fs.writeFile(outFile, newContents)
  }
}

async function copySay() {
  const repo = path.join(root, "say")
  const destination = outDir
  await Promise.all([
    fs.copyFile(path.join(repo, "src/init.lua"), path.join(destination, "say.lua")),
    fs.copyFile(path.join(repo, "LICENSE"), path.join(destination, "say-LICENSE")),
  ])
}

await Promise.all([copyLuassert(), copySay()])

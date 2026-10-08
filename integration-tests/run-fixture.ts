import * as fs from "fs"
import * as path from "path"
import { root, spawnCli, symlinkLocalFactorioTest } from "./test-utils.js"

const fixturesDir = path.join(root, "integration-tests/fixtures")
const defaultFixture = "usage-test-mod"

function parseArgs(argv: string[]): { fixture: string; extraArgs: string[] } {
  const [first, ...rest] = argv
  if (first === undefined || first.startsWith("-")) return { fixture: defaultFixture, extraArgs: argv }
  return { fixture: first, extraArgs: rest }
}

async function listFixtures(): Promise<string[]> {
  const entries = await fs.promises.readdir(fixturesDir, { withFileTypes: true })
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name)
}

async function main() {
  const { fixture, extraArgs } = parseArgs(process.argv.slice(2))

  const fixtures = await listFixtures()
  if (!fixtures.includes(fixture)) {
    console.error(`No fixture named "${fixture}". Available: ${fixtures.join(", ")}`)
    process.exit(1)
  }

  const dataDir = path.join(root, "factorio-test-data-dir-fixtures", fixture)
  await symlinkLocalFactorioTest(path.join(dataDir, "mods"))

  // a fixture without info.json is a scenario
  const fixturePath = path.join(fixturesDir, fixture)
  const isScenario = !fs.existsSync(path.join(fixturePath, "info.json"))
  const targetArgs = isScenario ? ["--scenario-path", fixturePath] : []

  console.log(`Running fixture ${fixture} with graphics, data directory ${dataDir}`)
  const child = spawnCli(
    {
      modPath: isScenario ? null : fixturePath,
      dataDir,
      extraArgs: [...targetArgs, "--graphics", ...extraArgs],
    },
    "inherit",
  )
  child.on("exit", (code) => process.exit(code ?? 1))
}

main()

import * as fs from "fs"
import * as path from "path"
import { runCli, runTests, TestContext, TestDefinition } from "../test-utils.js"

interface ModListEntry {
  name: string
  enabled: boolean
}

async function readModList(dataDir: string): Promise<ModListEntry[]> {
  const modListPath = path.join(dataDir, "mods", "mod-list.json")
  const content = JSON.parse(await fs.promises.readFile(modListPath, "utf-8")) as { mods: ModListEntry[] }
  return content.mods
}

function checkModEnabled(ctx: TestContext, mods: ModListEntry[], name: string, expected: boolean): boolean {
  const entry = mods.find((m) => m.name === name)
  if (!entry) {
    ctx.log(`FAIL: ${name} missing from mod-list.json`)
    return false
  }
  if (entry.enabled !== expected) {
    ctx.log(`FAIL: Expected ${name} enabled=${expected}, got ${entry.enabled}`)
    return false
  }
  ctx.log(`PASS: ${name} enabled=${expected}`)
  return true
}

async function testDlcModsDisabledByDefault(ctx: TestContext): Promise<boolean> {
  await runCli({ dataDir: ctx.dataDir })

  const mods = await readModList(ctx.dataDir)
  return ["space-age", "quality", "elevated-rails", "recycler"].every((name) => checkModEnabled(ctx, mods, name, false))
}

async function testDlcModEnabledWhenConfigured(ctx: TestContext): Promise<boolean> {
  await runCli({ dataDir: ctx.dataDir, extraArgs: ["--mods", "space-age"] })

  const mods = await readModList(ctx.dataDir)
  return checkModEnabled(ctx, mods, "space-age", true) && checkModEnabled(ctx, mods, "quality", false)
}

export const tests: TestDefinition[] = [
  { name: "DLC mods disabled by default", run: testDlcModsDisabledByDefault },
  { name: "DLC mod enabled via --mods", run: testDlcModEnabledWhenConfigured },
]

if (import.meta.url === `file://${process.argv[1]}`) {
  runTests(tests)
}

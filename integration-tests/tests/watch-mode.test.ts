import * as child_process from "child_process"
import { once } from "events"
import * as fs from "fs"
import * as path from "path"
import { setTimeout as delay } from "timers/promises"
import { expect } from "vitest"
import { test } from "../test-fixture.js"
import { fixturePath, root, type RunCliOptions, spawnCli } from "../test-utils.js"

const modFiles = ["info.json", "control.lua", "test1.lua", "lualib_bundle.lua"]

async function copyModToDir(dir: string): Promise<string> {
  const modDir = path.join(dir, "test-mod")
  await fs.promises.mkdir(modDir, { recursive: true })
  const srcModDir = path.join(root, "integration-tests/fixtures/usage-test-mod")
  for (const file of modFiles) {
    await fs.promises.copyFile(path.join(srcModDir, file), path.join(modDir, file))
  }
  return modDir
}

async function copyScenarioToDir(dir: string): Promise<string> {
  const scenarioDir = path.join(dir, "test-scenario")
  await fs.promises.cp(fixturePath("test-scenario"), scenarioDir, { recursive: true })
  return scenarioDir
}

function spawnWatchCli(options: RunCliOptions) {
  const child = spawnCli({ ...options, extraArgs: ["--watch", "--test-pattern", "Pass", ...(options.extraArgs ?? [])] })
  let output = ""
  child.stdout?.on("data", (data) => (output += data.toString()))
  child.stderr?.on("data", (data) => (output += data.toString()))
  return {
    child,
    output: () => output,
    clearOutput: () => (output = ""),
  }
}

async function stopChild(child: child_process.ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, "exit")
  child.kill("SIGTERM")
  const forceKill = setTimeout(() => child.kill("SIGKILL"), 5000)
  await exited
  clearTimeout(forceKill)
}

async function expectRerunOnTouch(options: RunCliOptions, fileToTouch: string): Promise<void> {
  const { child, output, clearOutput } = spawnWatchCli(options)

  try {
    await expect.poll(output, { timeout: 60_000 }).toContain("Tests:")

    clearOutput()
    await delay(500)
    const now = new Date()
    await fs.promises.utimes(fileToTouch, now, now)

    await expect.poll(output, { timeout: 5_000 }).toContain("File change detected")
    await expect.poll(output, { timeout: 60_000 }).toContain("Tests:")
  } finally {
    await stopChild(child)
  }
}

test("Watch mode reruns on file change", async ({ dirs }) => {
  const modDir = await copyModToDir(dirs.tempDir)
  await expectRerunOnTouch({ modPath: modDir, dataDir: dirs.dataDir }, path.join(modDir, "test1.lua"))
})

test("Watch mode reruns a scenario on file change", async ({ dirs }) => {
  const scenarioDir = await copyScenarioToDir(dirs.tempDir)
  await expectRerunOnTouch(
    { modPath: null, dataDir: dirs.dataDir, extraArgs: ["--scenario-path", scenarioDir] },
    path.join(scenarioDir, "tests", "scenario-test.lua"),
  )
})

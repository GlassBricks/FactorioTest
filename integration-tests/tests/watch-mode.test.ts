import * as child_process from "child_process"
import { once } from "events"
import * as fs from "fs"
import * as path from "path"
import { setTimeout as delay } from "timers/promises"
import { expect } from "vitest"
import { test } from "../test-fixture.js"
import { root, spawnCli } from "../test-utils.js"

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

function spawnWatchCli(modDir: string, dataDir: string) {
  const child = spawnCli({ modPath: modDir, dataDir, extraArgs: ["--watch", "--test-pattern", "Pass"] })
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

test("Watch mode reruns on file change", async ({ dirs }) => {
  const modDir = await copyModToDir(dirs.tempDir)
  const { child, output, clearOutput } = spawnWatchCli(modDir, dirs.dataDir)

  try {
    await expect.poll(output, { timeout: 60_000 }).toContain("Tests:")

    clearOutput()
    await delay(500)
    const now = new Date()
    await fs.promises.utimes(path.join(modDir, "test1.lua"), now, now)

    await expect.poll(output, { timeout: 5_000 }).toContain("File change detected")
    await expect.poll(output, { timeout: 60_000 }).toContain("Tests:")
  } finally {
    await stopChild(child)
  }
})

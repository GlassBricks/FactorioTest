import * as child_process from "child_process"
import * as fs from "fs"
import * as os from "os"
import * as path from "path"
import { fileURLToPath } from "url"

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

export const root = path.resolve(__dirname, "..")

export async function symlinkLocalFactorioTest(modsDir: string): Promise<void> {
  await fs.promises.mkdir(modsDir, { recursive: true })
  const localModPath = path.join(root, "mod")
  const symlinkPath = path.join(modsDir, "factorio-test")
  await fs.promises.rm(symlinkPath, { recursive: true, force: true })
  await fs.promises.symlink(localModPath, symlinkPath, "junction")
}

export interface TestDirs {
  tempDir: string
  dataDir: string
}

export async function createTestDirs(prefix: string): Promise<TestDirs> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `factorio-test-${prefix}-`))
  const dataDir = path.join(tempDir, "data")
  await symlinkLocalFactorioTest(path.join(dataDir, "mods"))
  return { tempDir, dataDir }
}

export async function removeTestDirs(dirs: TestDirs): Promise<void> {
  await fs.promises.rm(dirs.tempDir, { recursive: true, force: true })
}

export interface RunCliOptions {
  modPath?: string
  dataDir: string
  extraArgs?: string[]
}

const defaultModPath = "../integration-tests/fixtures/usage-test-mod"

function buildCliArgs(options: RunCliOptions): string[] {
  const modPath = options.modPath ?? defaultModPath
  return [
    "run",
    "cli",
    "--workspace=cli",
    "--",
    "run",
    `--mod-path=${modPath}`,
    `--data-directory=${options.dataDir}`,
    ...(options.extraArgs ?? []),
  ]
}

const collectedStdio: child_process.StdioOptions = ["inherit", "pipe", "pipe"]

function spawnInRoot(command: string, args: string[], stdio: child_process.StdioOptions): child_process.ChildProcess {
  return child_process.spawn(command, args, { stdio, cwd: root })
}

export function spawnCli(
  options: RunCliOptions,
  stdio: child_process.StdioOptions = collectedStdio,
): child_process.ChildProcess {
  return spawnInRoot("npm", buildCliArgs(options), stdio)
}

interface CliOutput {
  stdout: string
  stderr: string
  code: number
}

function collectOutput(child: child_process.ChildProcess): Promise<CliOutput> {
  return new Promise((resolve) => {
    let stdout = ""
    let stderr = ""

    child.stdout?.on("data", (data) => (stdout += data.toString()))
    child.stderr?.on("data", (data) => (stderr += data.toString()))
    child.on("exit", (code) => resolve({ stdout, stderr, code: code ?? 1 }))
  })
}

export function runCli(options: RunCliOptions): Promise<CliOutput> {
  return collectOutput(spawnCli(options))
}

export function runCliWithTimeout(options: RunCliOptions, timeoutSeconds: number): Promise<CliOutput> {
  return collectOutput(
    spawnInRoot("timeout", [String(timeoutSeconds), "npm", ...buildCliArgs(options)], collectedStdio),
  )
}

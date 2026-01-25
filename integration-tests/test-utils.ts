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
  await fs.promises.symlink(localModPath, symlinkPath, "junction")
}

export interface TestResult {
  name: string
  passed: boolean
  messages: string[]
}

export interface TestContext {
  tempDir: string
  dataDir: string
  modsDir: string
  log: (msg: string) => void
  messages: string[]
}

export interface TestDefinition {
  name: string
  run: (ctx: TestContext) => Promise<boolean>
}

export async function createTestContext(prefix: string): Promise<TestContext> {
  const tempDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), `factorio-test-${prefix}-`))
  const dataDir = path.join(tempDir, "data")
  const modsDir = path.join(dataDir, "mods")
  const messages: string[] = []
  await symlinkLocalFactorioTest(modsDir)
  return {
    tempDir,
    dataDir,
    modsDir,
    messages,
    log: (msg: string) => messages.push(msg),
  }
}

export async function cleanupTestContext(ctx: TestContext): Promise<void> {
  await fs.promises.rm(ctx.tempDir, { recursive: true, force: true })
}

export async function runWithConcurrencyLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T, index: number) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length)
  let nextIndex = 0

  async function worker() {
    while (nextIndex < items.length) {
      const index = nextIndex++
      results[index] = await fn(items[index], index)
    }
  }

  const workers = Array.from({ length: Math.min(limit, items.length) }, worker)
  await Promise.all(workers)
  return results
}

export interface RunCliOptions {
  modPath?: string
  dataDir: string
  extraArgs?: string[]
}

const defaultModPath = "../integration-tests/fixtures/usage-test-mod"

export function runCli(options: RunCliOptions): Promise<{ stdout: string; stderr: string; code: number }> {
  return new Promise((resolve) => {
    const modPath = options.modPath ?? defaultModPath
    const args = [
      "run",
      "cli",
      "--workspace=cli",
      "--",
      "run",
      `--mod-path=${modPath}`,
      `--data-directory=${options.dataDir}`,
      ...(options.extraArgs ?? []),
    ]

    const child = child_process.spawn("npm", args, {
      stdio: ["inherit", "pipe", "pipe"],
      cwd: root,
    })

    let stdout = ""
    let stderr = ""

    child.stdout.on("data", (data) => (stdout += data.toString()))
    child.stderr.on("data", (data) => (stderr += data.toString()))
    child.on("exit", (code) => resolve({ stdout, stderr, code: code ?? 1 }))
  })
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export async function waitForOutput(output: { value: string }, pattern: string, timeoutMs: number): Promise<boolean> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    if (output.value.includes(pattern)) return true
    await sleep(100)
  }
  return false
}

export async function runTestsDirectly(tests: TestDefinition[]): Promise<void> {
  const concurrency = Math.max(1, Math.floor(os.cpus().length / 2))
  console.log(`Running ${tests.length} tests with concurrency ${concurrency}...`)

  const results = await runWithConcurrencyLimit(tests, concurrency, async (test) => {
    const ctx = await createTestContext(test.name.replace(/\s+/g, "-").slice(0, 20))
    try {
      const passed = await test.run(ctx)
      return { name: test.name, passed, messages: ctx.messages }
    } finally {
      await cleanupTestContext(ctx)
    }
  })

  let passed = 0
  let failed = 0

  for (const result of results) {
    console.log(`\n=== ${result.name} ===`)
    for (const msg of result.messages) {
      console.log(`  ${msg}`)
    }
    if (result.passed) {
      passed++
    } else {
      failed++
    }
  }

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===`)
  process.exit(failed > 0 ? 1 : 0)
}

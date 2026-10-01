import * as fs from "fs"
import * as path from "path"
import { autoDetectFactorioPath } from "../cli/factorio-process.js"
import { cleanupTestContext, createTestContext, root, runCli } from "./test-utils.js"

const transcriptPath = path.join(root, "cli/test-fixtures/usage-test-mod.stdout")

function teeWrapperScript(factorioPath: string, rawOutputPath: string): string {
  return `#!/usr/bin/env node
import { spawn } from "child_process"
import { appendFileSync } from "fs"

const args = process.argv.slice(2)
const record = args.includes("--benchmark")
const child = spawn(${JSON.stringify(factorioPath)}, args, { stdio: ["inherit", "pipe", "pipe"] })
for (const [source, target] of [[child.stdout, process.stdout], [child.stderr, process.stderr]]) {
  source.on("data", (chunk) => {
    if (record) appendFileSync(${JSON.stringify(rawOutputPath)}, chunk)
    target.write(chunk)
  })
}
child.on("exit", (code, signal) => (signal ? process.kill(process.pid, signal) : process.exit(code ?? 1)))
`
}

function extractTestRun(raw: string, dataDir: string): string {
  const lines = raw.split(/\r?\n/)
  const first = lines.findIndex((line) => line.startsWith("FACTORIO-TEST-"))
  const last = lines.map((line) => line.startsWith("FACTORIO-TEST-RESULT:")).lastIndexOf(true)
  if (first === -1 || last === -1) throw new Error("No test run found in Factorio output")
  return (
    lines
      .slice(first, last + 1)
      .map((line) => line.replaceAll(dataDir, "<data-dir>"))
      .join("\n") + "\n"
  )
}

async function main() {
  const ctx = await createTestContext("record")
  try {
    const rawOutputPath = path.join(ctx.tempDir, "raw.stdout")
    const wrapperPath = path.join(ctx.tempDir, "factorio-tee.mjs")
    await fs.promises.writeFile(wrapperPath, teeWrapperScript(autoDetectFactorioPath(), rawOutputPath), { mode: 0o755 })

    const { code } = await runCli({ dataDir: ctx.dataDir, extraArgs: ["--factorio-path", wrapperPath] })
    console.log(`CLI exited with code ${code}`)

    const raw = await fs.promises.readFile(rawOutputPath, "utf8")
    await fs.promises.mkdir(path.dirname(transcriptPath), { recursive: true })
    await fs.promises.writeFile(transcriptPath, extractTestRun(raw, ctx.dataDir))
    console.log(`Wrote ${path.relative(root, transcriptPath)}`)
  } finally {
    await cleanupTestContext(ctx)
  }
}

main()

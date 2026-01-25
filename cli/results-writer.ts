import * as fsp from "fs/promises"
import * as path from "path"
import type { TestRunData } from "./test-run-collector.js"

export interface ResultsFileContent {
  timestamp: string
  modName: string
  summary: TestRunData["summary"]
  tests: {
    path: string
    result: "passed" | "failed" | "skipped" | "todo"
    durationMs?: number
    errors?: string[]
  }[]
}

export async function writeResultsFile(outputPath: string, modName: string, data: TestRunData): Promise<void> {
  const content: ResultsFileContent = {
    timestamp: new Date().toISOString(),
    modName,
    summary: data.summary,
    tests: data.tests.map((t) => ({
      path: t.path,
      result: t.result,
      ...(t.durationMs !== undefined && { durationMs: t.durationMs }),
      ...(t.errors.length > 0 && { errors: t.errors }),
    })),
  }
  await fsp.mkdir(path.dirname(outputPath), { recursive: true })
  await fsp.writeFile(outputPath, JSON.stringify(content, null, 2))
}

export async function readPreviousFailedTests(outputPath: string): Promise<string[]> {
  try {
    const content = await fsp.readFile(outputPath, "utf-8")
    const parsed = JSON.parse(content) as ResultsFileContent
    return parsed.tests.filter((t) => t.result === "failed").map((t) => t.path)
  } catch {
    return []
  }
}

export function getDefaultOutputPath(dataDir: string): string {
  return path.join(dataDir, "test-results.json")
}

import * as fs from "fs"
import * as fsp from "fs/promises"
import * as os from "os"
import * as path from "path"
import { stripVTControlCharacters } from "util"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createOutputComponents, type FactorioTestOptions, parseResultMessage } from "./factorio-process.js"
import { OutputFormatter } from "./test-output.js"
import { type TestRunData, writeResultsFile } from "./test-results.js"

// Recorded from integration-tests/fixtures/usage-test-mod; regenerate with `npm run record-transcript`
const transcript = fs
  .readFileSync(path.join(import.meta.dirname, "test-fixtures/usage-test-mod.stdout"), "utf8")
  .split("\n")
  .filter((line) => line !== "")

interface Replay {
  output: string
  data: TestRunData
  resultMessage: string | undefined
}

function replay(options: FactorioTestOptions = {}): Replay {
  const printed: string[] = []
  vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => void printed.push(args.join(" ")))
  const { handler, collector } = createOutputComponents(options)
  for (const line of transcript) handler.handleLine(line)
  const data = collector.getData()
  new OutputFormatter({ quiet: options.quiet }).formatSummary(data)
  return { output: stripVTControlCharacters(printed.join("\n")), data, resultMessage: handler.getResultMessage() }
}

const summaryLine = "Tests: 1 failed, 2 errors, 1 todo, 2 skipped, 7 passed (11 total)"
const perTestLines = ["PASS test1 > Pass", "FAIL test1 > each 2", "TODO test1 > TODO"]

afterEach(() => {
  vi.restoreAllMocks()
})

describe("usage-test-mod transcript replay", () => {
  it.each<[string, FactorioTestOptions, string[], string[]]>([
    ["default", {}, [...perTestLines, summaryLine], ["SKIP test1 > Skip", "Step: "]],
    ["quiet", { quiet: true }, [summaryLine], [...perTestLines, "SKIP test1 > Skip", "Step: "]],
    [
      "verbose",
      { verbose: true },
      [...perTestLines, "Starting: test1 > Pass", "Step: test1 > Steps > captioned step", summaryLine],
      ['"type":"testStarted"', "SKIP test1 > Skip"],
    ],
  ])("%s output", (_, options, expected, unexpected) => {
    const { output } = replay(options)
    for (const line of expected) expect(output).toContain(line)
    for (const line of unexpected) expect(output).not.toContain(line)
  })

  it("recaps failures and describe block errors separately", () => {
    const { output } = replay()
    const recap = output.slice(output.indexOf("Failures:"))
    expect(recap).toMatch(/Failures:[\s\S]*FAIL test1 > each 2[\s\S]*Describe block errors:/)
    expect(recap).toContain("ERROR test1 > fail in describe block")
    expect(recap).toContain("ERROR test1 > Failing after_all hook")
    expect(recap).toContain("Oh no")
  })

  it("prints mod messages", () => {
    expect(replay().output).toContain("Usage test mod result: passed")
  })

  it("parses the final result", () => {
    const { resultMessage } = replay()
    expect(parseResultMessage(resultMessage!)).toEqual({ status: "failed", hasFocusedTests: false })
  })

  it("writes a results file with every captured test", async () => {
    const { data } = replay()
    const dir = await fsp.mkdtemp(path.join(os.tmpdir(), "factorio-test-transcript-"))
    try {
      const resultsPath = path.join(dir, "test-results.json")
      await writeResultsFile(resultsPath, "usage-test-mod", data)
      const content = JSON.parse(await fsp.readFile(resultsPath, "utf8"))
      expect(content.summary).toMatchObject({
        failed: 1,
        passed: 7,
        skipped: 2,
        todo: 1,
        describeBlockErrors: 2,
        status: "failed",
      })
      expect(content.tests).toHaveLength(13)
    } finally {
      await fsp.rm(dir, { recursive: true, force: true })
    }
  })
})

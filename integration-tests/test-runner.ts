import * as os from "os"
import {
  createTestContext,
  cleanupTestContext,
  runWithConcurrencyLimit,
  TestDefinition,
  TestResult,
} from "./test-utils.js"

import { tests as usageTests } from "./tests/usage-test-mod.js"
import { tests as configTests } from "./tests/config-options.js"
import { tests as resultsTests } from "./tests/results-file.js"
import { tests as watchTests } from "./tests/watch-mode.js"

const allTests: TestDefinition[] = [...watchTests, ...resultsTests, ...usageTests, ...configTests]

async function runTest(test: TestDefinition): Promise<TestResult> {
  const ctx = await createTestContext(test.name.replace(/\s+/g, "-").slice(0, 20))
  const start = Date.now()
  try {
    const passed = await test.run(ctx)
    return { name: test.name, passed, messages: ctx.messages, durationMs: Date.now() - start }
  } finally {
    await cleanupTestContext(ctx)
  }
}

async function main() {
  const filter = process.argv[2]
  const testsToRun = filter ? allTests.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase())) : allTests

  if (testsToRun.length === 0) {
    console.log(`No tests matching "${filter}"`)
    process.exit(1)
  }

  const concurrency = Math.max(1, Math.floor((os.cpus().length * 3) / 4))
  console.log(`Running ${testsToRun.length} tests with concurrency ${concurrency}...`)

  const results = await runWithConcurrencyLimit(testsToRun, concurrency, runTest)

  let passed = 0
  let failed = 0

  for (const result of results) {
    const duration = (result.durationMs / 1000).toFixed(1)
    console.log(`\n=== ${result.name} (${duration}s) ===`)
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

main()

import { runTests, TestDefinition } from "./test-utils.js"

import { tests as usageTests } from "./tests/usage-test-mod.js"
import { tests as configTests } from "./tests/config-options.js"
import { tests as resultsTests } from "./tests/results-file.js"
import { tests as watchTests } from "./tests/watch-mode.js"
import { tests as outputTimeoutTests } from "./tests/output-timeout.js"
import { tests as dlcModsTests } from "./tests/dlc-mods.js"

const allTests: TestDefinition[] = [
  ...watchTests,
  ...resultsTests,
  ...usageTests,
  ...configTests,
  ...outputTimeoutTests,
  ...dlcModsTests,
]

async function main() {
  const filter = process.argv[2]
  const testsToRun = filter ? allTests.filter((t) => t.name.toLowerCase().includes(filter.toLowerCase())) : allTests

  if (testsToRun.length === 0) {
    console.log(`No tests matching "${filter}"`)
    process.exit(1)
  }

  await runTests(testsToRun)
}

main()

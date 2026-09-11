import { getAutoStartConfig } from "./shared/auto-start-config"
import { testStorage } from "./storage"
import { TestEventListener } from "./test-events"

export function initializeFailedTestsFromConfig(): void {
  if (testStorage().lastFailedTests !== undefined) return

  const fromConfig = getAutoStartConfig().last_failed_tests
  if (fromConfig && fromConfig.length > 0) {
    const set = new LuaSet<string>()
    for (const path of fromConfig) {
      set.add(path)
    }
    testStorage().lastFailedTests = set
  }
}

export function getFailedTestsSet(): LuaSet<string> {
  return testStorage().lastFailedTests ?? new LuaSet<string>()
}

export function hasFailedTests(): boolean {
  const set = testStorage().lastFailedTests
  return set !== undefined && next(set)[0] !== undefined
}

/** Collects into the run's report, so that the set survives a mid-run reload. */
export const failedTestCollector: TestEventListener = (event, state) => {
  switch (event.type) {
    case "testFailed":
      state.report.failedTestPaths.add(event.test.path)
      break
    case "testRunFinished":
    case "testRunCancelled":
      testStorage().lastFailedTests = state.report.failedTestPaths
      break
  }
}

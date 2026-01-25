import { getAutoStartConfig } from "./auto-start-config"
import { TestEventListener } from "./test-events"

declare const storage: {
  __lastFailedTests?: LuaSet<string>
}

export function initializeFailedTestsFromConfig(): void {
  if (storage.__lastFailedTests !== undefined) return

  const fromConfig = getAutoStartConfig().last_failed_tests
  if (fromConfig && fromConfig.length > 0) {
    const set = new LuaSet<string>()
    for (const path of fromConfig) {
      set.add(path)
    }
    storage.__lastFailedTests = set
  }
}

export function getFailedTestsSet(): LuaSet<string> {
  return storage.__lastFailedTests ?? new LuaSet<string>()
}

export function hasFailedTests(): boolean {
  const set = storage.__lastFailedTests
  return set !== undefined && next(set)[0] !== undefined
}

let currentRunFailedPaths: LuaSet<string> | undefined

export const failedTestCollector: TestEventListener = (event) => {
  switch (event.type) {
    case "testRunStarted":
      currentRunFailedPaths = new LuaSet<string>()
      break
    case "testFailed":
      currentRunFailedPaths?.add(event.test.path)
      break
    case "testRunFinished":
    case "testRunCancelled":
      if (currentRunFailedPaths) {
        storage.__lastFailedTests = currentRunFailedPaths
        currentRunFailedPaths = undefined
      }
      break
  }
}

import { TestRunSummary } from "../../types/events"
import { TestEventListener } from "./test-events"

/** The wire summary, with `status` unset until the run finishes. */
export interface TestRunResults extends Omit<TestRunSummary, "status"> {
  status?: TestRunSummary["status"] | undefined
}

export function createEmptyRunResults(): TestRunResults {
  return {
    failed: 0,
    passed: 0,
    ran: 0,
    skipped: 0,
    todo: 0,
    cancelled: 0,
    describeBlockErrors: 0,
  }
}

export const resultCollector: TestEventListener = (event, state) => {
  if (event.type === "testRunStarted") {
    state.results = createEmptyRunResults()
    return
  }
  const results = state.results
  switch (event.type) {
    case "testPassed":
      results.ran++
      results.passed++
      break
    case "testFailed":
      results.ran++
      results.failed++
      break
    case "testSkipped":
      results.skipped++
      break
    case "testTodo":
      results.todo++
      break
    case "describeBlockFailed":
      results.describeBlockErrors += event.block.errors.length
      break
    case "testRunFinished":
      if (results.failed !== 0 || results.describeBlockErrors !== 0) {
        results.status = "failed"
      } else if (results.todo !== 0) {
        results.status = "todo"
      } else {
        results.status = "passed"
      }
      break
    case "testRunCancelled":
      results.status = "cancelled"
      break
  }
}

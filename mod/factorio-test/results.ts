import { TestEventListener } from "./test-events"

export interface TestRunResults {
  ran: number
  passed: number
  failed: number
  skipped: number
  todo: number
  cancelled: number
  describeBlockErrors: number

  status?: "passed" | "failed" | "todo" | "cancelled"
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
    case "testPassed": {
      results.ran++
      results.passed++
      // const { path, source, errors } = event.test
      // results.tests.push({
      //   path,
      //   source,
      //   errors,
      //   result: "passed",
      // })
      break
    }
    case "testFailed": {
      results.ran++
      results.failed++
      // const { path, source, errors } = event.test
      // results.tests.push({
      //   path,
      //   source,
      //   errors,
      //   result: "failed",
      // })
      break
    }
    case "testSkipped": {
      results.skipped++
      // const { path, source, errors } = event.test
      // results.tests.push({
      //   path,
      //   source,
      //   errors,
      //   result: "skipped",
      // })
      break
    }
    case "testTodo": {
      results.todo++
      // const { path, source, errors } = event.test
      // results.tests.push({
      //   path,
      //   source,
      //   errors,
      //   result: "todo",
      // })
      break
    }
    case "describeBlockFailed": {
      results.describeBlockErrors += event.block.errors.length
      break
    }
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

import { TestEventListener } from "./test-events"
import { DescribeBlock, Source, Test } from "./tests"
import { TestInfo, BlockInfo, SourceLocation, TestRunnerEvent } from "../../types/events"

const EVENT_PREFIX = "FACTORIO-TEST-EVENT:"

function emitEvent(event: TestRunnerEvent): void {
  print(EVENT_PREFIX + helpers.table_to_json(event))
}

function sourceToLocation(source: Source): SourceLocation | undefined {
  if (!source.file) return undefined
  const result: SourceLocation = { file: source.file }
  if (source.line !== undefined) result.line = source.line
  return result
}

function testToInfo(test: Test): TestInfo {
  const result: TestInfo = { path: test.path }
  const source = sourceToLocation(test.source)
  if (source) result.source = source
  return result
}

function blockToInfo(block: DescribeBlock): BlockInfo {
  const result: BlockInfo = { path: block.path }
  const source = sourceToLocation(block.source)
  if (source) result.source = source
  return result
}

export const cliEventEmitter: TestEventListener = (event, state) => {
  switch (event.type) {
    case "testRunStarted":
      emitEvent({ type: "testRunStarted" })
      break
    case "testStarted":
      emitEvent({ type: "testStarted", test: testToInfo(event.test) })
      break
    case "testPassed":
      emitEvent({ type: "testPassed", test: testToInfo(event.test) })
      break
    case "testFailed":
      emitEvent({
        type: "testFailed",
        test: testToInfo(event.test),
        errors: [...event.test.errors],
      })
      break
    case "testSkipped":
      emitEvent({ type: "testSkipped", test: testToInfo(event.test) })
      break
    case "testTodo":
      emitEvent({ type: "testTodo", test: testToInfo(event.test) })
      break
    case "describeBlockEntered":
      emitEvent({ type: "describeBlockEntered", block: blockToInfo(event.block) })
      break
    case "describeBlockFinished":
      emitEvent({ type: "describeBlockFinished", block: blockToInfo(event.block) })
      break
    case "describeBlockFailed":
      emitEvent({
        type: "describeBlockFailed",
        block: blockToInfo(event.block),
        errors: [...event.block.errors],
      })
      break
    case "testRunFinished": {
      const results = {
        ...state.results,
        status: state.results.status!,
      }
      emitEvent({ type: "testRunFinished", results })
      break
    }
    case "testRunCancelled":
      emitEvent({ type: "testRunCancelled" })
      break
    case "loadError":
      emitEvent({
        type: "loadError",
        error: state.rootBlock.errors[0] ?? "Unknown error",
      })
      break
  }
}

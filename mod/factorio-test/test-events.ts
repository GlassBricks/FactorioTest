import { TestState } from "./state"
import { DescribeBlock, Test } from "./tests"

interface BaseTestEvent {
  type: string
}
export interface TestRunStarted extends BaseTestEvent {
  type: "testRunStarted"
}
export interface DescribeBlockEntered extends BaseTestEvent {
  type: "describeBlockEntered"
  block: DescribeBlock
}
export interface TestEntered extends BaseTestEvent {
  type: "testEntered"
  test: Test
}
export interface TestStarted extends BaseTestEvent {
  type: "testStarted"
  test: Test
}
export interface TestPassed extends BaseTestEvent {
  type: "testPassed"
  test: Test
}
export interface TestFailed extends BaseTestEvent {
  type: "testFailed"
  test: Test
}
export interface TestSkipped extends BaseTestEvent {
  type: "testSkipped"
  test: Test
}
export interface TestTodo extends BaseTestEvent {
  type: "testTodo"
  test: Test
}
export interface DescribeBlockFinished extends BaseTestEvent {
  type: "describeBlockFinished"
  block: DescribeBlock
}
export interface DescribeBlockFailed extends BaseTestEvent {
  type: "describeBlockFailed"
  block: DescribeBlock
}
export interface TestRunFinished extends BaseTestEvent {
  type: "testRunFinished"
}
export interface TestRunCancelled extends BaseTestEvent {
  type: "testRunCancelled"
}
export interface LoadError extends BaseTestEvent {
  type: "loadError"
}
/** Raised when a part with a caption starts running, whether or not step mode is on. */
export interface StepStarted extends BaseTestEvent {
  type: "stepStarted"
  caption: string
}
/** Raised when the run pauses at a step, in step mode. */
export interface StepPaused extends BaseTestEvent {
  type: "stepPaused"
  caption: string
}
/** Raised when a paused run continues, whichever action the user chose. */
export interface StepResumed extends BaseTestEvent {
  type: "stepResumed"
}
export interface CustomEvent extends BaseTestEvent {
  type: "customEvent"
  name: string
  data?: unknown
}

export type TestEvent =
  | TestRunStarted
  | DescribeBlockEntered
  | TestEntered
  | TestStarted
  | TestPassed
  | TestFailed
  | TestSkipped
  | TestTodo
  | DescribeBlockFinished
  | DescribeBlockFailed
  | TestRunFinished
  | TestRunCancelled
  | LoadError
  | StepStarted
  | StepPaused
  | StepResumed
  | CustomEvent

export type TestEventListener = (event: TestEvent, state: TestState) => void

let testListeners: TestEventListener[] = []
export function clearTestListeners() {
  testListeners = []
}

export function addTestListener(this: unknown, listener: TestEventListener): void {
  testListeners.push(listener)
}

export function _raiseTestEvent(state: TestState, event: TestEvent) {
  for (const handler of testListeners) {
    handler(event, state)
  }
}

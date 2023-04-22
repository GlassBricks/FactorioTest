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
export interface LoadError extends BaseTestEvent {
  type: "loadError"
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
  | LoadError
  | CustomEvent

export type TesteEventListener = (event: TestEvent, state: TestState) => void

let testListeners: TesteEventListener[] = []
export function clearTestListeners() {
  testListeners = []
}

export function addTestListener(this: unknown, listener: TesteEventListener): void {
  testListeners.push(listener)
}

export function _raiseTestEvent(state: TestState, event: TestEvent) {
  for (const handler of testListeners) {
    handler(event, state)
  }
}

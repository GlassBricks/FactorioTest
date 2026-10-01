import type { ReadonlyRunReport } from "./results"
import { DescribeBlock, Test, TestSelection } from "./tests"

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

export type StepAction = "continue" | "runRest" | "skipTest"

export interface StepPaused extends BaseTestEvent {
  type: "stepPaused"
  test: Test
  /** The step label; undefined when paused before the test starts. */
  step: string | undefined
}
export interface StepResumed extends BaseTestEvent {
  type: "stepResumed"
  action: StepAction | "cancel"
}
export interface StepStarted extends BaseTestEvent {
  type: "stepStarted"
  test: Test
  step: string
}
export interface TestSkippedByUser extends BaseTestEvent {
  type: "testSkippedByUser"
  test: Test
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
  | StepPaused
  | StepResumed
  | StepStarted
  | TestSkippedByUser

/**
 * What a listener may see: the suite being run and what the run has produced so far,
 * already updated for the event. Deliberately excludes execution state.
 */
export interface TestEventContext extends TestSelection {
  readonly report: ReadonlyRunReport
}

export type TestEventListener = (event: TestEvent, context: TestEventContext) => void

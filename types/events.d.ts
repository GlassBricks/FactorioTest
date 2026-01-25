export interface SourceLocation {
  file?: string
  line?: number
}

export interface TestInfo {
  path: string
  source?: SourceLocation
  duration?: string
}

export interface BlockInfo {
  path: string
  source?: SourceLocation
}

export interface TestRunSummary {
  ran: number
  passed: number
  failed: number
  skipped: number
  todo: number
  cancelled: number
  describeBlockErrors: number
  status: "passed" | "failed" | "todo" | "cancelled"
  duration?: string
}

export type TestRunnerEvent =
  | { type: "testRunStarted" }
  | { type: "testStarted"; test: TestInfo }
  | { type: "testPassed"; test: TestInfo }
  | { type: "testFailed"; test: TestInfo; errors: string[] }
  | { type: "testSkipped"; test: TestInfo }
  | { type: "testTodo"; test: TestInfo }
  | { type: "describeBlockEntered"; block: BlockInfo }
  | { type: "describeBlockFinished"; block: BlockInfo }
  | { type: "describeBlockFailed"; block: BlockInfo; errors: string[] }
  | { type: "testRunFinished"; results: TestRunSummary }
  | { type: "testRunCancelled" }
  | { type: "loadError"; error: string }

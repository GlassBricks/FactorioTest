/** @noSelfInFile */
import { TestStage } from "../constants"
import { __factorio_test__pcallWithStacktrace } from "./pcall-with-stacktrace"
import { prepareReload, resumeAfterReload } from "./reload-resume"
import { createRunReport, recordEvent } from "./results"
import { assertNever } from "./shared/util"
import { PartRun, TestRun, TestState, setToLoadErrorState } from "./state"
import { StepAction, TestEvent, TestEventListener, TestRunCancelled, TestRunFinished } from "./test-events"
import { reorderFailedFirst, shouldReorderFailedFirst } from "./test-reordering"
import {
  DescribeBlock,
  ReloadKind,
  Test,
  collectAfterEachHooks,
  collectBeforeEachHooks,
  formatSource,
  formatStepError,
  isSkippedTest,
  stepLabel,
} from "./tests"

/** A point the run can pause before in step mode. */
type StepPoint = { kind: "testStart"; test: Test } | { kind: "stepPart"; testRun: TestRun; partIndex: number }

/** The points at which the test runner can suspend/resume across a tick. */
type Resumption =
  | { kind: "beforeTest"; test: Test; ticksLeft: number }
  | { kind: "asyncPart"; testRun: TestRun; part: PartRun }
  | { kind: "startStepPoint"; point: StepPoint }
  | { kind: "skipTest"; point: StepPoint }
  | { kind: "awaitingReload" }

/**
 * Position in the test tree. `block` has already been entered (its
 * describeBlockEntered raised and its beforeAll run), and `block.children[index]`
 * is the next thing to consider. Ancestor cursors are not materialized; the
 * return position is recomputed as `child.indexInParent + 1` on the way up.
 */
interface Cursor {
  block: DescribeBlock
  index: number
}

function newPartRun(partIndex: number): PartRun {
  return {
    partIndex,
    async: false,
    timeout: 0,
    asyncDone: false,
    ticksElapsed: 0,
    onTickFuncs: new LuaSet(),
  }
}

function stepPartLabel(test: Test, partIndex: number): string {
  return stepLabel(test.parts[partIndex]!.step!)
}

function stepPointTest(point: StepPoint): Test {
  return point.kind === "testStart" ? point.test : point.testRun.test
}

function pushPartError(test: Test, part: PartRun, message: string): void {
  const { step } = test.parts[part.partIndex]!
  test.errors.push(step ? formatStepError(step, message) : message)
}

function runBlockHooks(block: DescribeBlock, type: "beforeAll" | "afterAll", recordErrors: boolean): void {
  for (const hook of block.hooks) {
    if (hook.type !== type) continue
    const [success, message] = __factorio_test__pcallWithStacktrace(hook.func)
    if (!success && recordErrors) {
      block.errors.push(`Error running ${type}: ${message}`)
    }
  }
}

function runAfterEachHooks(testRun: TestRun, recordErrors: boolean): void {
  const { test, afterTestFuncs } = testRun
  const hooks = [...afterTestFuncs, ...collectAfterEachHooks(test.parent)]
  for (const hook of hooks) {
    const [success, message] = __factorio_test__pcallWithStacktrace(hook)
    if (!success && recordErrors) {
      test.errors.push(message as string)
    }
  }
}

function isPartComplete(test: Test, part: PartRun): boolean {
  return (
    test.errors.length !== 0 ||
    !part.async ||
    part.asyncDone ||
    (!part.explicitAsync && next(part.onTickFuncs)[0] === undefined)
  )
}

export class TestRunner {
  constructor(
    private state: TestState,
    private listeners: readonly TestEventListener[],
  ) {
    // A runner owns exactly one run; a previous one may have been abandoned mid-test.
    state.currentTestRun = undefined
  }

  private status: "notStarted" | "running" | "done" = "notStarted"
  private cursor: Cursor | undefined
  private resumePoint: Resumption | undefined
  private cancelRequested = false
  private failureCount = 0
  private stepping = false
  private stepPause: StepPoint | undefined

  private emit(event: TestEvent): void {
    recordEvent(this.state.report, event)
    for (const listener of this.listeners) {
      listener(event, this.state)
    }
  }

  tick(): void {
    if (this.status === "done" || this.stepPause) return
    if (this.cancelRequested) {
      this.cancelRun()
      return
    }
    if (this.status === "notStarted") {
      this.begin()
      return
    }
    const resumePoint = this.resumePoint
    this.resumePoint = undefined
    if (!resumePoint || !this.resume(resumePoint)) {
      this.advance()
    }
  }

  isDone(): boolean {
    return this.status === "done"
  }

  isStepPaused(): boolean {
    return this.stepPause !== undefined
  }

  requestCancel(): void {
    this.cancelRequested = true
    if (!this.stepPause) return
    this.stepPause = undefined
    this.emit({ type: "stepResumed", action: "cancel" })
  }

  stepAction(action: StepAction): void {
    const point = this.stepPause
    if (!point) return
    this.stepPause = undefined
    if (action === "runRest") this.stepping = false
    this.resumePoint = { kind: action === "skipTest" ? "skipTest" : "startStepPoint", point }
    this.emit({ type: "stepResumed", action })
  }

  /** Returns true if the runner suspended again. */
  private resume(resumePoint: Resumption): boolean {
    switch (resumePoint.kind) {
      case "beforeTest":
        resumePoint.ticksLeft--
        if (resumePoint.ticksLeft > 0) {
          this.resumePoint = resumePoint
          return true
        }
        return this.reachTest(resumePoint.test)
      case "asyncPart":
        return this.pollAsyncPart(resumePoint.testRun, resumePoint.part)
      case "startStepPoint":
        return this.startStepPoint(resumePoint.point)
      case "skipTest":
        this.skipTest(resumePoint.point)
        return false
      case "awaitingReload":
        this.setLoadError(`Reload was requested but did not happen. Aborting test run.`)
        return true
      default:
        assertNever(resumePoint)
    }
  }

  private begin(): void {
    if (game.is_multiplayer()) {
      error("Tests cannot be in run in multiplayer")
    }
    this.status = "running"
    const stage = this.state.store.stage.get()
    if (stage === TestStage.NotRun || stage === TestStage.Ready) {
      this.startTestRun(false)
    } else if (stage === TestStage.ReloadingMods) {
      this.resumeAfterReload()
    } else if (stage === TestStage.Running) {
      this.setLoadError(
        `Save was unexpectedly reloaded while tests were running. This will cause tests to break. Aborting test run.`,
      )
    } else if (stage === TestStage.Finished || stage === TestStage.LoadError) {
      this.startTestRun(true)
    } else {
      assertNever(stage)
    }
  }

  private startTestRun(isRerun: boolean): void {
    const { state } = this
    state.isRerun = isRerun
    this.stepping = state.config.step
    state.report = createRunReport()
    state.report.profiler = helpers.create_profiler()
    state.store.stage.set(TestStage.Running)
    const { lastFailedTests } = state.store.persisted()
    if (shouldReorderFailedFirst(state.config, lastFailedTests)) {
      reorderFailedFirst(state.suite.rootBlock, lastFailedTests)
    }
    this.emit({ type: "testRunStarted" })

    this.enterBlock(state.suite.rootBlock)
    this.cursor = { block: state.suite.rootBlock, index: 0 }
    this.advance()
  }

  private resumeAfterReload(): void {
    const resumePoint = resumeAfterReload(this.state)
    if (!resumePoint) {
      this.setLoadError(`Mod files were changed after reload. Aborting test run.`)
      return
    }
    const { test, partIndex } = resumePoint
    this.stepping = resumePoint.stepping
    this.state.store.stage.set(TestStage.Running)
    // the cursor must point *past* the resumed test, or it would be re-run forever
    this.cursor = { block: test.parent, index: test.indexInParent + 1 }

    const testRun: TestRun = { test, afterTestFuncs: [] }
    if (!this.advanceParts(testRun, this.startPart(testRun, partIndex))) {
      this.advance()
    }
  }

  private setLoadError(message: string): void {
    this.status = "done"
    setToLoadErrorState(this.state, message)
    this.emit({ type: "loadError" })
  }

  /** The flat driver: pull the next test out of the walk and run it, until suspended or done. */
  private advance(): void {
    while (!this.cancelRequested) {
      const test = this.nextTest()
      // a cancel during the final ascent must not be mistaken for "suite finished"
      if (this.cancelRequested) return
      if (!test) {
        this.endRun({ type: "testRunFinished" })
        return
      }
      // the pause takes the place of the last tick before the test, so it starts on the same tick it would otherwise
      const ticksBefore = this.stepping ? math.max(test.ticksBefore - 1, 0) : test.ticksBefore
      if (ticksBefore > 0) {
        this.resumePoint = { kind: "beforeTest", test, ticksLeft: ticksBefore }
        return
      }
      if (this.reachTest(test)) return
    }
  }

  /**
   * Walks the tree from the cursor to the next runnable test, entering and leaving
   * describe blocks and consuming skipped tests on the way. Returns undefined once
   * the walk pops past the root.
   *
   * Every iteration must descend, ascend, or advance the index, or advance() spins
   * forever within a single tick.
   */
  private nextTest(): Test | undefined {
    while (true) {
      // a cancel from a before_all/after_all hook must stop the walk here
      if (this.cancelRequested) return undefined

      const cursor = this.cursor!
      const { block } = cursor

      if (block.errors.length > 0 || cursor.index >= block.children.length) {
        this.leaveBlock(block)
        if (!block.parent) {
          this.cursor = undefined
          return undefined
        }
        this.cursor = { block: block.parent, index: block.indexInParent + 1 }
        continue
      }

      const child = block.children[cursor.index]!
      if (child.type === "describeBlock") {
        this.enterBlock(child)
        this.cursor = { block: child, index: 0 }
        continue
      }

      cursor.index++
      this.emit({ type: "testEntered", test: child })
      if (!isSkippedTest(child, this.state)) return child
      this.emit(child.mode === "todo" ? { type: "testTodo", test: child } : { type: "testSkipped", test: child })
    }
  }

  private enterBlock(block: DescribeBlock): void {
    this.emit({ type: "describeBlockEntered", block })
    if (block.errors.length !== 0) return

    if (block.children.length === 0) {
      block.errors.push("No tests defined")
    }
    if (this.hasAnyTest(block)) {
      runBlockHooks(block, "beforeAll", true)
    }
  }

  private leaveBlock(block: DescribeBlock): void {
    if (this.hasAnyTest(block)) {
      runBlockHooks(block, "afterAll", true)
    }
    this.emit(
      block.errors.length > 0 ? { type: "describeBlockFailed", block } : { type: "describeBlockFinished", block },
    )
  }

  /** Returns true if the runner suspended or paused. */
  private reachTest(test: Test): boolean {
    if (this.stepping) {
      this.pause({ kind: "testStart", test })
      return true
    }
    return this.startAndRunTest(test)
  }

  private pause(point: StepPoint): void {
    this.stepPause = point
    this.emit({
      type: "stepPaused",
      test: stepPointTest(point),
      step: point.kind === "stepPart" ? stepPartLabel(point.testRun.test, point.partIndex) : undefined,
    })
  }

  /** Returns true if the runner suspended. */
  private startStepPoint(point: StepPoint): boolean {
    return point.kind === "testStart"
      ? this.startAndRunTest(point.test)
      : this.startStepPart(point.testRun, point.partIndex)
  }

  private skipTest(point: StepPoint): void {
    if (point.kind === "stepPart") {
      this.closeTestRun(point.testRun, false)
    }
    this.emit({ type: "testSkippedByUser", test: stepPointTest(point) })
  }

  /** Returns true if the runner suspended on an async part. */
  private startAndRunTest(test: Test): boolean {
    test.profiler = helpers.create_profiler()
    const part = newPartRun(0)
    const testRun: TestRun = { test, afterTestFuncs: [], part }
    this.state.currentTestRun = testRun
    this.emit({ type: "testStarted", test })

    const beforeEach = collectBeforeEachHooks(test.parent)
    for (const hook of beforeEach) {
      if (test.errors.length !== 0) break
      const [success, message] = __factorio_test__pcallWithStacktrace(hook)
      if (!success) {
        test.errors.push(message as string)
      }
    }

    this.runPart(testRun, part)
    return this.advanceParts(testRun, part)
  }

  /** Returns true if the runner suspended. */
  private startStepPart(testRun: TestRun, partIndex: number): boolean {
    this.emit({ type: "stepStarted", test: testRun.test, step: stepPartLabel(testRun.test, partIndex) })
    return this.advanceParts(testRun, this.startPart(testRun, partIndex))
  }

  /** Returns true if the runner is still suspended on the part. */
  private pollAsyncPart(testRun: TestRun, part: PartRun): boolean {
    const { test } = testRun
    const tickNumber = ++part.ticksElapsed
    const timeout = part.timeout
    if (tickNumber > timeout) {
      pushPartError(
        test,
        part,
        `Test timed out after ${timeout} ticks:\n${formatSource(test.parts[part.partIndex]!.source)}`,
      )
    }

    if (test.errors.length === 0) {
      // snapshot: a handler registered during this tick must not run until the next
      for (const func of Object.keys(part.onTickFuncs)) {
        const [success, result] = __factorio_test__pcallWithStacktrace(func, tickNumber)
        if (!success) {
          pushPartError(test, part, result as string)
          break
        } else if (result === false) {
          part.onTickFuncs.delete(func)
        }
      }
    }
    return this.advanceParts(testRun, part)
  }

  private startPart(testRun: TestRun, partIndex: number): PartRun {
    const part = newPartRun(partIndex)
    testRun.part = part
    this.runPart(testRun, part)
    return part
  }

  private runPart(testRun: TestRun, part: PartRun): void {
    const { test } = testRun
    this.state.currentTestRun = testRun
    if (test.errors.length === 0) {
      const [success, message] = __factorio_test__pcallWithStacktrace(test.parts[part.partIndex]!.func)
      if (!success) {
        pushPartError(test, part, message as string)
      }
    }
  }

  /**
   * Called after a part has run or been polled: runs any following parts, then either
   * suspends on an unfinished part or a step boundary, or leaves the test. Returns true if suspended.
   */
  private advanceParts(testRun: TestRun, part: PartRun): boolean {
    const { test } = testRun
    while (isPartComplete(test, part)) {
      const nextIndex = part.partIndex + 1
      if (nextIndex >= test.parts.length) {
        // A cancel raised from the test body must not emit testPassed/testFailed.
        // Leave currentTestRun set, so the next tick's cancelRun runs afterEach.
        if (this.cancelRequested) return true
        this.leaveTest(testRun)
        return false
      }
      const { reloadBefore, step } = test.parts[nextIndex]!
      if (test.errors.length === 0) {
        if (reloadBefore) {
          if (testRun.afterTestFuncs.length === 0) {
            this.beginReload(test, nextIndex, reloadBefore)
            return true
          }
          test.errors.push(`after_test cannot be used before a reload (after_reload_${reloadBefore})`)
        } else if (step) {
          this.reachStepPart(testRun, nextIndex)
          return true
        }
      }
      part = this.startPart(testRun, nextIndex)
    }
    this.resumePoint = { kind: "asyncPart", testRun, part }
    return true
  }

  private reachStepPart(testRun: TestRun, partIndex: number): void {
    testRun.part = undefined
    const point: StepPoint = { kind: "stepPart", testRun, partIndex }
    // a cancel from the completed part must not pause: the paused runner would never tick into cancelRun
    if (this.stepping && !this.cancelRequested) {
      this.pause(point)
    } else {
      this.resumePoint = { kind: "startStepPoint", point }
    }
  }

  private beginReload(test: Test, resumePartIndex: number, kind: ReloadKind): void {
    prepareReload(this.state, { test, partIndex: resumePartIndex, stepping: this.stepping })
    this.resumePoint = { kind: "awaitingReload" }
    if (kind === "mods") {
      game.reload_mods()
    } else {
      game.reload_script()
    }
  }

  private closeTestRun(testRun: TestRun, recordErrors: boolean): void {
    runAfterEachHooks(testRun, recordErrors)
    this.state.currentTestRun = undefined
    testRun.test.profiler?.stop()
  }

  private leaveTest(testRun: TestRun): void {
    const { test } = testRun
    this.closeTestRun(testRun, true)

    if (test.errors.length === 0) {
      this.emit({ type: "testPassed", test })
      return
    }
    this.emit({ type: "testFailed", test })
    const { bail } = this.state.config
    if (bail !== undefined) {
      this.failureCount++
      if (this.failureCount >= bail) {
        this.state.report.bailedOut = true
        this.requestCancel()
      }
    }
  }

  private endRun(event: TestRunFinished | TestRunCancelled): void {
    this.status = "done"
    const { state } = this
    state.report.profiler?.stop()
    state.store.persisted().lastFailedTests = state.report.failedTestPaths
    state.store.stage.set(TestStage.Finished)
    this.emit(event)
  }

  private cancelRun(): void {
    const { state } = this
    let block: DescribeBlock | undefined
    if (state.currentTestRun) {
      block = state.currentTestRun.test.parent
      this.closeTestRun(state.currentTestRun, false)
    } else {
      block = this.cursor?.block
    }

    block ??= state.suite.rootBlock
    while (block) {
      // beforeAll only runs for blocks with active tests, so afterAll must match
      if (this.hasAnyTest(block)) {
        runBlockHooks(block, "afterAll", false)
      }
      this.emit({ type: "describeBlockFinished", block })
      block = block.parent
    }

    this.endRun(state.report.bailedOut ? { type: "testRunFinished" } : { type: "testRunCancelled" })
  }

  private hasAnyTest(block: DescribeBlock): boolean {
    return block.children.some((child) =>
      child.type === "test" ? !isSkippedTest(child, this.state) : this.hasAnyTest(child),
    )
  }
}

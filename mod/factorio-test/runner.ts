/** @noSelfInFile */
import { TestStage } from "../constants"
import { __factorio_test__pcallWithStacktrace } from "./pcall-with-stacktrace"
import { assertNever } from "./shared/util"
import { resumeAfterReload } from "./reload-resume"
import { TestRun, TestState, createRunState, setToLoadErrorState } from "./state"
import { markFailedTestsAndDescendants, reorderChildren, shouldReorderFailedFirst } from "./test-reordering"
import {
  DescribeBlock,
  Test,
  collectAfterEachHooks,
  collectBeforeEachHooks,
  formatSource,
  isSkippedTest,
} from "./tests"

export interface TestRunner {
  tick(): void
  isDone(): boolean
  requestCancel(): void
}

export function createTestRunner(state: TestState): TestRunner {
  return new TestRunnerImpl(state)
}

/** The points at which the test runner can suspend/resume across a tick. */
type Resumption = { kind: "beforeTest"; test: Test; ticksLeft: number } | { kind: "asyncPart"; testRun: TestRun }

/**
 * Position in the test tree: `block` has already been entered (its
 * describeBlockEntered raised and its beforeAll run), and `block.children[index]`
 * is the next thing to consider. Ancestor cursors are not materialized; the
 * return position is recomputed as `child.indexInParent + 1` on the way up.
 */
interface Cursor {
  block: DescribeBlock
  index: number
}

function newTestRun(test: Test, partIndex: number): TestRun {
  return {
    test,
    async: false,
    timeout: 0,
    asyncDone: false,
    tickStarted: game.tick,
    onTickFuncs: new LuaSet(),
    afterTestFuncs: [],
    partIndex,
  }
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

function isPartComplete(testRun: TestRun): boolean {
  return (
    testRun.test.errors.length !== 0 ||
    !testRun.async ||
    testRun.asyncDone ||
    (!testRun.explicitAsync && next(testRun.onTickFuncs)[0] === undefined)
  )
}

class TestRunnerImpl implements TestRunner {
  constructor(private state: TestState) {
    // A runner owns exactly one run. Reset state between runs.
    state.run = createRunState()
  }

  private status: "notStarted" | "running" | "done" = "notStarted"
  private cursor: Cursor | undefined
  private resumePoint: Resumption | undefined

  tick(): void {
    if (this.status === "done") return
    if (this.state.run.cancelRequested) {
      this.cancelRun()
      return
    }
    if (this.status === "notStarted") {
      this.begin()
      return
    }
    const resumePoint = this.resumePoint
    this.resumePoint = undefined
    if (!resumePoint) {
      this.advance()
    } else if (resumePoint.kind === "beforeTest") {
      resumePoint.ticksLeft--
      if (resumePoint.ticksLeft > 0) {
        this.resumePoint = resumePoint
      } else if (!this.startAndRunTest(resumePoint.test)) {
        this.advance()
      }
    } else if (!this.pollAsyncPart(resumePoint.testRun)) {
      this.advance()
    }
  }

  isDone(): boolean {
    return this.status === "done"
  }

  requestCancel(): void {
    this.state.run.cancelRequested = true
  }

  private begin(): void {
    if (game.is_multiplayer()) {
      error("Tests cannot be in run in multiplayer")
    }
    this.status = "running"
    const stage = this.state.env.getTestStage()
    if (stage === TestStage.NotRun || stage === TestStage.Ready) {
      this.startTestRun()
    } else if (stage === TestStage.ReloadingMods) {
      this.resumeAfterReload()
    } else if (stage === TestStage.Running) {
      this.setLoadError(
        `Save was unexpectedly reloaded while tests were running. This will cause tests to break. Aborting test run.`,
      )
    } else if (stage === TestStage.Finished || stage === TestStage.LoadError) {
      this.rerun()
    } else {
      assertNever(stage)
    }
  }

  private startTestRun(): void {
    const { state } = this
    state.run.profiler = helpers.create_profiler()
    state.env.setTestStage(TestStage.Running)
    if (shouldReorderFailedFirst(state)) {
      markFailedTestsAndDescendants(state.rootBlock)
    }
    state.env.emit({ type: "testRunStarted" })

    this.enterBlock(state.rootBlock)
    this.cursor = { block: state.rootBlock, index: 0 }
    this.advance()
  }

  private rerun(): void {
    const tagBlacklist = (this.state.config.tag_blacklist ??= [])
    if (tagBlacklist.indexOf("no_rerun") === -1) {
      tagBlacklist.push("no_rerun")
    }
    this.startTestRun()
  }

  private resumeAfterReload(): void {
    const resumePoint = resumeAfterReload(this.state)
    if (!resumePoint) {
      this.setLoadError(`Mod files were changed after reload. Aborting test run.`)
      return
    }
    const { test, partIndex } = resumePoint
    this.state.env.setTestStage(TestStage.Running)
    // the cursor must point *past* the resumed test, or it would be re-run forever
    this.cursor = { block: test.parent, index: test.indexInParent + 1 }

    const testRun = newTestRun(test, partIndex)
    this.runPart(testRun)
    if (!this.advanceParts(testRun)) {
      this.advance()
    }
  }

  private setLoadError(message: string): void {
    this.status = "done"
    setToLoadErrorState(this.state, message)
    this.state.env.emit({ type: "loadError" })
  }

  /** The flat driver: pull the next test out of the walk and run it, until suspended or done. */
  private advance(): void {
    while (!this.state.run.cancelRequested) {
      const test = this.nextTest()
      // a cancel during the final ascent must not be mistaken for "suite finished"
      if (this.state.run.cancelRequested) return
      if (!test) {
        this.finishRun()
        return
      }
      if (test.ticksBefore > 0) {
        this.resumePoint = { kind: "beforeTest", test, ticksLeft: test.ticksBefore }
        return
      }
      if (this.startAndRunTest(test)) return
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
      if (this.state.run.cancelRequested) return undefined

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

      // reorderChildren rewrites indexInParent, so advance the cursor directly
      cursor.index++
      this.state.env.emit({ type: "testEntered", test: child })
      if (!isSkippedTest(child, this.state)) return child
      this.state.env.emit(
        child.mode === "todo" ? { type: "testTodo", test: child } : { type: "testSkipped", test: child },
      )
    }
  }

  private enterBlock(block: DescribeBlock): void {
    this.state.env.emit({ type: "describeBlockEntered", block })
    if (block.errors.length !== 0) return

    if (block.children.length === 0) {
      block.errors.push("No tests defined")
    }
    if (shouldReorderFailedFirst(this.state)) {
      reorderChildren(block)
    }
    if (this.hasAnyTest(block)) {
      runBlockHooks(block, "beforeAll", true)
    }
  }

  private leaveBlock(block: DescribeBlock): void {
    if (this.hasAnyTest(block)) {
      runBlockHooks(block, "afterAll", true)
    }
    this.state.env.emit(
      block.errors.length > 0 ? { type: "describeBlockFailed", block } : { type: "describeBlockFinished", block },
    )
  }

  /** Returns true if the runner suspended on an async part. */
  private startAndRunTest(test: Test): boolean {
    test.profiler = helpers.create_profiler()
    const testRun = newTestRun(test, 0)
    this.state.run.currentTestRun = testRun
    this.state.env.emit({ type: "testStarted", test })

    const beforeEach = collectBeforeEachHooks(test.parent)
    for (const hook of beforeEach) {
      if (test.errors.length !== 0) break
      const [success, message] = __factorio_test__pcallWithStacktrace(hook)
      if (!success) {
        test.errors.push(message as string)
      }
    }

    this.runPart(testRun)
    return this.advanceParts(testRun)
  }

  /** Returns true if the runner is still suspended on the part. */
  private pollAsyncPart(testRun: TestRun): boolean {
    const { test, partIndex } = testRun
    const tickNumber = game.tick - testRun.tickStarted
    const timeout = testRun.timeout
    if (tickNumber > timeout) {
      test.errors.push(`Test timed out after ${timeout} ticks:\n${formatSource(test.parts[partIndex]!.source)}`)
    }

    if (test.errors.length === 0) {
      // snapshot: a handler registered during this tick must not run until the next
      for (const func of Object.keys(testRun.onTickFuncs)) {
        const [success, result] = __factorio_test__pcallWithStacktrace(func, tickNumber)
        if (!success) {
          test.errors.push(result as string)
          break
        } else if (result === false) {
          testRun.onTickFuncs.delete(func)
        }
      }
    }
    return this.advanceParts(testRun)
  }

  private runPart(testRun: TestRun): void {
    const { test, partIndex } = testRun
    this.state.run.currentTestRun = testRun
    if (test.errors.length === 0) {
      const [success, message] = __factorio_test__pcallWithStacktrace(test.parts[partIndex]!.func)
      if (!success) {
        test.errors.push(message as string)
      }
    }
  }

  /**
   * Called after a part has run or been polled: runs any following parts, then either
   * suspends on an unfinished part or leaves the test. Returns true if suspended.
   */
  private advanceParts(testRun: TestRun): boolean {
    let current = testRun
    while (isPartComplete(current)) {
      const { test, partIndex } = current
      if (partIndex + 1 >= test.parts.length) {
        // A cancel raised from the test body must not emit testPassed/testFailed.
        // Leave currentTestRun set, so the next tick's cancelRun runs afterEach.
        if (this.state.run.cancelRequested) return true
        this.leaveTest(current)
        return false
      }
      current = newTestRun(test, partIndex + 1)
      this.runPart(current)
    }
    this.resumePoint = { kind: "asyncPart", testRun: current }
    return true
  }

  private leaveTest(testRun: TestRun): void {
    const { test } = testRun
    runAfterEachHooks(testRun, true)
    this.state.run.currentTestRun = undefined
    test.profiler!.stop()

    if (test.errors.length === 0) {
      this.state.env.emit({ type: "testPassed", test })
      return
    }
    this.state.env.emit({ type: "testFailed", test })
    const { bail } = this.state.config
    if (bail !== undefined) {
      this.state.run.failureCount++
      if (this.state.run.failureCount >= bail) {
        this.state.run.bailedOut = true
        this.requestCancel()
      }
    }
  }

  private finishRun(): void {
    this.status = "done"
    const { state } = this
    state.run.profiler?.stop()
    state.env.setTestStage(TestStage.Finished)
    state.env.emit({ type: "testRunFinished" })
  }

  private cancelRun(): void {
    const { state } = this
    let block: DescribeBlock | undefined
    if (state.run.currentTestRun) {
      const { test } = state.run.currentTestRun
      block = test.parent
      runAfterEachHooks(state.run.currentTestRun, false)
      test.profiler?.stop()
      state.run.currentTestRun = undefined
    } else {
      block = this.cursor?.block
    }

    block ??= state.rootBlock
    while (block) {
      // beforeAll only runs for blocks with active tests, so afterAll must match
      if (this.hasAnyTest(block)) {
        runBlockHooks(block, "afterAll", false)
      }
      state.env.emit({ type: "describeBlockFinished", block })
      block = block.parent
    }

    this.status = "done"
    state.run.profiler?.stop()
    state.env.setTestStage(TestStage.Finished)
    state.env.emit(state.run.bailedOut ? { type: "testRunFinished" } : { type: "testRunCancelled" })
  }

  private hasAnyTest(block: DescribeBlock): boolean {
    return block.children.some((child) =>
      child.type === "test" ? !isSkippedTest(child, this.state) : this.hasAnyTest(child),
    )
  }
}

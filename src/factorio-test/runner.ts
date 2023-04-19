/** @noSelfInFile */
import { TestStage } from "../constants"
import { __factorio_test__pcallWithStacktrace, assertNever } from "./_util"
import { resumeAfterReload } from "./reload-resume"
import { setToLoadErrorState, TestRun, TestState } from "./state"
import { DescribeBlock, formatSource, Hook, isSkippedTest, Test } from "./tests"
import TestFn = FactorioTest.TestFn

export interface TestRunner {
  tick(): void

  isDone(): boolean
}

interface TestTasks {
  init(): void
  enterDescribe(block: DescribeBlock): void
  enterTest(test: Test): void
  startTest(test: Test): void
  runTestPart(testRun: TestRun): void
  waitForTestPart(testRun: TestRun): void
  leaveTest(testRun: TestRun): void
  leaveDescribeBlock(block: DescribeBlock): void
  finishTestRun(): void
}
type Task =
  | {
      [K in keyof TestTasks]: TestTasks[K] extends () => void
        ? {
            task: K
            data?: never
            waitTicks?: number
          }
        : TestTasks[K] extends (arg: infer A) => void
        ? {
            task: K
            data: A
            waitTicks?: number
          }
        : never
    }[keyof TestTasks]

type TestTaskRunner = {
  [K in keyof TestTasks]: TestTasks[K] extends (...args: infer T) => void ? (...args: T) => Task | undefined : never
}

export function createTestRunner(state: TestState): TestRunner {
  return new TestRunnerImpl(state)
}

// noinspection JSUnusedGlobalSymbols
class TestRunnerImpl implements TestTaskRunner, TestRunner {
  constructor(private state: TestState) {}
  ticksToWait = 0
  nextTask: Task | undefined = { task: "init" }

  tick(): void {
    if (this.ticksToWait > 0) {
      if (--this.ticksToWait > 0) return
    }
    while (this.nextTask) {
      this.nextTask = this.runTask(this.nextTask)
      if (this.nextTask) {
        this.ticksToWait = this.nextTask.waitTicks ?? 0
      }
      if (this.ticksToWait > 0) return
    }
  }

  isDone() {
    return this.nextTask === undefined
  }

  private runTask(task: Task): Task | undefined {
    const self = this as any
    const nextTask = self[task.task](task.data)
    if (nextTask) {
      this.ticksToWait = nextTask.waitTicks ?? 0
    }
    return nextTask
  }

  init(): Task | undefined {
    if (game.is_multiplayer()) {
      error("Tests cannot be in run in multiplayer")
    }
    const stage = this.state.getTestStage()
    if (stage === TestStage.NotRun || stage === TestStage.Ready) {
      return this.startTestRun()
    } else if (stage === TestStage.ReloadingMods) {
      return this.attemptResumeAfterReload()
    } else if (stage === TestStage.Running) {
      return this.createLoadError(
        `Save was unexpectedly reloaded while tests were running. This will cause tests to break. Aborting test run.`,
      )
    } else if (stage === TestStage.Finished || stage === TestStage.LoadError) {
      return this.rerun()
    }
    assertNever(stage)
  }

  private startTestRun(): Task {
    const { state } = this
    state.profiler = game.create_profiler()
    state.setTestStage(TestStage.Running)
    state.raiseTestEvent({ type: "testRunStarted" })
    return { task: "enterDescribe", data: state.rootBlock }
  }

  private attemptResumeAfterReload(): Task | undefined {
    const resumePoint = resumeAfterReload(this.state)
    if (!resumePoint) {
      return this.createLoadError(`Mod files were changed after reload. Aborting test run.`)
    }
    const { test, partIndex } = resumePoint
    this.state.setTestStage(TestStage.Running)
    return {
      task: "runTestPart",
      data: TestRunnerImpl.newTestRun(test!, partIndex),
    }
  }
  private rerun(): Task {
    const { state } = this
    const tagBlacklist = (state.config.tag_blacklist ??= [])
    if (tagBlacklist.indexOf("no_rerun") === -1) {
      tagBlacklist.push("no_rerun")
    }
    state.isRerun = true
    return this.startTestRun()
  }

  enterDescribe(block: DescribeBlock): Task {
    this.state.raiseTestEvent({
      type: "describeBlockEntered",
      block,
    })

    if (block.errors.length !== 0) {
      return {
        task: "leaveDescribeBlock",
        data: block,
      }
    }
    if (block.children.length === 0) {
      block.errors.push("No tests defined")
    }

    if (this.hasAnyTest(block)) {
      const hooks = block.hooks.filter((x) => x.type === "beforeAll")
      for (const hook of hooks) {
        const [success, message] = __factorio_test__pcallWithStacktrace(hook.func)
        if (!success) {
          block.errors.push(`Error running ${hook.type}: ${message}`)
        }
      }
    }
    return TestRunnerImpl.getNextDescribeBlockTask(block, 0)
  }

  enterTest(test: Test): Task {
    this.state.raiseTestEvent({
      type: "testEntered",
      test,
    })
    if (isSkippedTest(test, this.state)) {
      if (test.mode === "todo") {
        this.state.raiseTestEvent({
          type: "testTodo",
          test,
        })
      } else {
        this.state.raiseTestEvent({
          type: "testSkipped",
          test,
        })
      }
      return TestRunnerImpl.getNextDescribeBlockTask(test.parent, test.indexInParent + 1)
    }

    return {
      task: "startTest",
      data: test,
      waitTicks: test.ticksBefore,
    }
  }

  startTest(test: Test): Task {
    test.profiler = game.create_profiler()
    const testRun = TestRunnerImpl.newTestRun(test, 0)
    this.state.currentTestRun = testRun
    this.state.raiseTestEvent({
      type: "testStarted",
      test,
    })

    function collectHooks(block: DescribeBlock, hooks: Hook[]) {
      if (block.parent) collectHooks(block.parent, hooks)
      hooks.push(...block.hooks.filter((x) => x.type === "beforeEach"))
      return hooks
    }

    const beforeEach = collectHooks(test.parent, [])
    for (const hook of beforeEach) {
      if (test.errors.length !== 0) break
      const [success, error] = __factorio_test__pcallWithStacktrace(hook.func)
      if (!success) {
        test.errors.push(error as string)
      }
    }
    return {
      task: "runTestPart",
      data: testRun,
    }
  }

  runTestPart(testRun: TestRun): Task {
    const { test, partIndex } = testRun
    const part = test.parts[partIndex]!
    this.state.currentTestRun = testRun
    if (test.errors.length === 0) {
      const [success, error] = __factorio_test__pcallWithStacktrace(part.func)
      if (!success) {
        test.errors.push(error as string)
      }
    }
    return TestRunnerImpl.nextTestTask(testRun)
  }

  waitForTestPart(testRun: TestRun): Task {
    // run on tick events
    const { test, partIndex } = testRun
    const tickNumber = game.tick - testRun.tickStarted
    const timeout = testRun.timeout
    if (tickNumber > timeout) {
      test.errors.push(`Test timed out after ${timeout} ticks:\n${formatSource(test.parts[partIndex]!.source)}`)
    }

    if (test.errors.length === 0) {
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
    return TestRunnerImpl.nextTestTask(testRun)
  }

  leaveTest(testRun: TestRun): Task {
    const { test, afterTestFuncs } = testRun

    function collectHooks(block: DescribeBlock, hooks: TestFn[]) {
      hooks.push(...block.hooks.filter((x) => x.type === "afterEach").map((x) => x.func))
      if (block.parent) collectHooks(block.parent, hooks)
      return hooks
    }
    const afterEach = collectHooks(test.parent, [...afterTestFuncs])

    for (const hook of afterEach) {
      const [success, error] = __factorio_test__pcallWithStacktrace(hook)
      if (!success) {
        test.errors.push(error as string)
      }
    }
    this.state.currentTestRun = undefined
    test.profiler!.stop()
    if (test.errors.length > 0) {
      this.state.raiseTestEvent({
        type: "testFailed",
        test,
      })
    } else {
      this.state.raiseTestEvent({
        type: "testPassed",
        test,
      })
    }

    return TestRunnerImpl.getNextDescribeBlockTask(test.parent, test.indexInParent + 1)
  }

  leaveDescribeBlock(block: DescribeBlock): Task | undefined {
    const hasTests = this.hasAnyTest(block)
    if (hasTests) {
      const hooks = block.hooks.filter((x) => x.type === "afterAll")
      for (const hook of hooks) {
        const [success, message] = __factorio_test__pcallWithStacktrace(hook.func)
        if (!success) {
          block.errors.push(`Error running ${hook.type}: ${message}`)
        }
      }
    }
    if (block.errors.length > 0) {
      this.state.raiseTestEvent({
        type: "describeBlockFailed",
        block,
      })
    } else {
      this.state.raiseTestEvent({
        type: "describeBlockFinished",
        block,
      })
    }
    return block.parent
      ? TestRunnerImpl.getNextDescribeBlockTask(block.parent, block.indexInParent + 1)
      : {
          task: "finishTestRun",
        }
  }

  finishTestRun() {
    const { state } = this
    state.profiler?.stop()
    state.setTestStage(TestStage.Finished)
    state.raiseTestEvent({
      type: "testRunFinished",
    })
    return undefined
  }

  private static getNextDescribeBlockTask(block: DescribeBlock, index: number): Task {
    if (block.errors.length > 0) {
      return {
        task: "leaveDescribeBlock",
        data: block,
      }
    }

    const item = block.children[index]
    if (item) {
      return item.type === "describeBlock"
        ? {
            task: "enterDescribe",
            data: item,
          }
        : {
            task: "enterTest",
            data: item,
          }
    }
    return {
      task: "leaveDescribeBlock",
      data: block,
    }
  }

  private hasAnyTest(block: DescribeBlock): boolean {
    return block.children.some((child) =>
      child.type === "test" ? !isSkippedTest(child, this.state) : this.hasAnyTest(child),
    )
  }

  private createLoadError(message: string) {
    setToLoadErrorState(this.state, message)
    this.state.raiseTestEvent({ type: "loadError" })
    return undefined
  }

  private static nextTestTask(testRun: TestRun): Task {
    const { test, partIndex } = testRun
    if (
      test.errors.length !== 0 ||
      !testRun.async ||
      testRun.asyncDone ||
      (!testRun.explicitAsync && next(testRun.onTickFuncs)[0] === undefined)
    ) {
      if (partIndex + 1 < test.parts.length) {
        return {
          task: "runTestPart",
          data: TestRunnerImpl.newTestRun(test, partIndex + 1),
        }
      }
      return {
        task: "leaveTest",
        data: testRun,
      }
    }
    return {
      task: "waitForTestPart",
      data: testRun,
      waitTicks: 1,
    }
  }
  private static newTestRun(test: Test, partIndex: number): TestRun {
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
}

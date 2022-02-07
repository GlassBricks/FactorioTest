/** @noSelfInFile */
import { Remote, TestStage } from "../shared-constants"
import { __testorio__pcallWithStacktrace, assertNever } from "./_util"
import { resumeAfterReload } from "./resume"
import { makeLoadError, TestRun, TestState } from "./state"
import { DescribeBlock, formatSource, Hook, isSkippedTest, Test } from "./tests"
import OnTickFn = Testorio.OnTickFn
import TestFn = Testorio.TestFn

interface TestRunStarted {
  type: "testRunStarted"
}

interface EnterDescribe {
  type: "enterDescribe"
  block: DescribeBlock
}

interface EnterTest {
  type: "enterTest"
  test: Test
}

interface StartTest {
  type: "startTest"
  test: Test
  waitTicks: number
}

interface RunTestPart {
  type: "runTestPart"
  testRun: TestRun
}

interface WaitForTestPart {
  type: "waitForTestPart"
  testRun: TestRun
  waitTicks: 1
}

interface LeaveTest {
  type: "leaveTest"
  testRun: TestRun
}

interface LeaveDescribe {
  type: "leaveDescribe"
  block: DescribeBlock
}

interface TestRunFinished {
  type: "testRunFinished"
}

interface ReportLoadError {
  type: "reportLoadError"
}

type Task =
  | TestRunStarted
  | EnterDescribe
  | EnterTest
  | StartTest
  | RunTestPart
  | WaitForTestPart
  | LeaveTest
  | LeaveDescribe
  | TestRunFinished
  | ReportLoadError

export interface TestRunner {
  tick(): void

  isDone(): boolean
}

const enum LoadResult {
  FirstLoad,
  ResumeAfterReload,
  ConfigChangedAfterReload,
  AlreadyRunning,
  AlreadyRan,
}

function onLoad(state: TestState):
  | {
      result: LoadResult.FirstLoad
    }
  | {
      result: LoadResult.ResumeAfterReload
      test: Test
      partIndex: number
    }
  | {
      result: LoadResult.ConfigChangedAfterReload
      test: Test
    }
  | {
      result: LoadResult.AlreadyRunning
    }
  | {
      result: LoadResult.AlreadyRan
    } {
  if (game.is_multiplayer()) {
    error("Tests cannot be in run in multiplayer")
  }
  const stage = state.getTestStage()
  switch (stage) {
    case TestStage.NotRun:
      return remote.interfaces[Remote.RunTests]
        ? { result: LoadResult.FirstLoad }
        : error("Test runner trying to be created when tests not loaded")
    case TestStage.ToReload: {
      const { test, partIndex } = resumeAfterReload(state)
      return partIndex
        ? {
            result: LoadResult.ResumeAfterReload,
            test,
            partIndex,
          }
        : {
            result: LoadResult.ConfigChangedAfterReload,
            test,
          }
    }
    case TestStage.Running:
      return { result: LoadResult.AlreadyRunning }
    case TestStage.Completed:
      return { result: LoadResult.AlreadyRan }
    case TestStage.LoadError:
      return error("Unexpected reload state when test runner loaded: " + stage)
    default:
      assertNever(stage)
      break
  }
}

export function createTestRunner(state: TestState): TestRunner {
  function hasAnyTest(block: DescribeBlock): boolean {
    return block.children.some((child) => (child.type === "test" ? !isSkippedTest(child, state) : hasAnyTest(child)))
  }

  function testRunStarted(): Task {
    state.profiler = game.create_profiler()
    state.raiseTestEvent({
      type: "testRunStarted",
    })
    return {
      type: "enterDescribe",
      block: state.rootBlock,
    }
  }

  function testRunFinished(): undefined {
    state.profiler!.stop()
    state.raiseTestEvent({
      type: "testRunFinished",
    })
    return
  }

  function reportLoadError(): undefined {
    state.raiseTestEvent({
      type: "loadError",
    })
    return
  }

  function nextDescribeBlockItem(block: DescribeBlock, index: number): Task {
    if (block.errors.length > 0) {
      return {
        type: "leaveDescribe",
        block,
      }
    }

    const item = block.children[index]
    if (item) {
      return item.type === "describeBlock"
        ? {
            type: "enterDescribe",
            block: item,
          }
        : {
            type: "enterTest",
            test: item,
          }
    }
    return {
      type: "leaveDescribe",
      block,
    }
  }

  function newTestRun(test: Test, partIndex: number): TestRun {
    return {
      test,
      async: false,
      timeout: 0,
      asyncDone: false,
      tickStarted: game.tick,
      onTickFuncs: new LuaTable(),
      partIndex,
    }
  }

  function nextTestTask({ testRun }: RunTestPart | WaitForTestPart): Task {
    const { test, partIndex } = testRun
    if (test.errors.length !== 0 || !testRun.async || testRun.asyncDone) {
      if (partIndex + 1 < test.parts.length) {
        return {
          type: "runTestPart",
          testRun: newTestRun(test, partIndex + 1),
        }
      }
      return {
        type: "leaveTest",
        testRun,
      }
    }
    return {
      type: "waitForTestPart",
      testRun,
      waitTicks: 1,
    }
  }

  function enterDescribe({ block }: EnterDescribe): Task {
    state.raiseTestEvent({
      type: "describeBlockEntered",
      block,
    })

    if (block.errors.length !== 0) {
      return {
        type: "leaveDescribe",
        block,
      }
    }
    if (block.children.length === 0) {
      block.errors.push("No tests defined")
    }

    if (hasAnyTest(block)) {
      const hooks = block.hooks.filter((x) => x.type === "beforeAll")
      for (const hook of hooks) {
        const [success, message] = __testorio__pcallWithStacktrace(hook.func)
        if (!success) {
          block.errors.push(`Error running ${hook.type}: ${message}`)
        }
      }
    }
    return nextDescribeBlockItem(block, 0)
  }

  function enterTest({ test }: EnterTest): Task {
    state.raiseTestEvent({
      type: "testEntered",
      test,
    })
    if (isSkippedTest(test, state)) {
      if (test.mode === "todo") {
        state.raiseTestEvent({
          type: "testTodo",
          test,
        })
      } else {
        state.raiseTestEvent({
          type: "testSkipped",
          test,
        })
      }
      return nextDescribeBlockItem(test.parent, test.indexInParent + 1)
    }

    return {
      type: "startTest",
      test,
      waitTicks: test.ticksBefore,
    }
  }

  function startTest({ test }: StartTest): Task {
    // set testRun now, no errors in hooks
    test.profiler = game.create_profiler()
    const testRun = newTestRun(test, 0)
    state.currentTestRun = testRun
    state.raiseTestEvent({
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
      const [success, error] = __testorio__pcallWithStacktrace(hook.func)
      if (!success) {
        test.errors.push(error as string)
      }
    }
    return {
      type: "runTestPart",
      testRun,
    }
  }

  function runTestPart(task: RunTestPart): Task {
    const { testRun } = task
    const { test, partIndex } = testRun
    const part = test.parts[partIndex]
    state.currentTestRun = testRun
    if (test.errors.length === 0) {
      const [success, error] = __testorio__pcallWithStacktrace(part.func)
      if (!success) {
        test.errors.push(error as string)
      }
    }
    return nextTestTask(task)
  }

  function waitForTestPart(task: WaitForTestPart): Task {
    // run on tick events
    const { testRun } = task
    const { test, partIndex } = testRun
    const tickNumber = game.tick - testRun.tickStarted
    if (tickNumber > testRun.timeout) {
      test.errors.push(`Test timed out after ${testRun.timeout} ticks:\n${formatSource(test.parts[partIndex].source)}`)
    }

    if (test.errors.length === 0) {
      for (const func of Object.keys(testRun.onTickFuncs) as unknown as OnTickFn[]) {
        const [success, result] = __testorio__pcallWithStacktrace(func, tickNumber)
        if (!success) {
          test.errors.push(result as string)
          break
        } else if (result === false) {
          testRun.onTickFuncs.delete(func)
        }
      }
    }
    return nextTestTask(task)
  }

  function leaveTest({ testRun }: LeaveTest): Task {
    const { test } = testRun

    function collectHooks(block: DescribeBlock, hooks: TestFn[]) {
      hooks.push(...block.hooks.filter((x) => x.type === "afterEach").map((x) => x.func))
      if (block.parent) collectHooks(block.parent, hooks)
      return hooks
    }

    const afterEach = collectHooks(test.parent, [])

    for (const hook of afterEach) {
      const [success, error] = __testorio__pcallWithStacktrace(hook)
      if (!success) {
        test.errors.push(error as string)
      }
    }
    state.currentTestRun = undefined
    test.profiler!.stop()
    if (test.errors.length > 0) {
      state.raiseTestEvent({
        type: "testFailed",
        test,
      })
    } else {
      state.raiseTestEvent({
        type: "testPassed",
        test,
      })
    }

    return nextDescribeBlockItem(test.parent, test.indexInParent + 1)
  }

  function leaveDescribe({ block }: LeaveDescribe): Task | undefined {
    const hasTests = hasAnyTest(block)
    if (hasTests) {
      const hooks = block.hooks.filter((x) => x.type === "afterAll")
      for (const hook of hooks) {
        const [success, message] = __testorio__pcallWithStacktrace(hook.func)
        if (!success) {
          block.errors.push(`Error running ${hook.type}: ${message}`)
        }
      }
    }
    if (block.errors.length > 0) {
      state.raiseTestEvent({
        type: "describeBlockFailed",
        block,
      })
    } else {
      state.raiseTestEvent({
        type: "describeBlockFinished",
        block,
      })
    }
    return block.parent
      ? nextDescribeBlockItem(block.parent, block.indexInParent + 1)
      : {
          type: "testRunFinished",
        }
  }

  function runTask(task: Task): Task | undefined {
    switch (task.type) {
      case "testRunStarted":
        return testRunStarted()
      case "enterDescribe":
        return enterDescribe(task)
      case "enterTest":
        return enterTest(task)
      case "startTest":
        return startTest(task)
      case "runTestPart":
        return runTestPart(task)
      case "waitForTestPart":
        return waitForTestPart(task)
      case "leaveTest":
        return leaveTest(task)
      case "leaveDescribe":
        return leaveDescribe(task)
      case "testRunFinished":
        return testRunFinished()
      case "reportLoadError":
        return reportLoadError()
      default:
        assertNever(task)
    }
  }

  let ticksToWait = 0
  let nextTask: Task | undefined

  function createLoadError(message: string) {
    makeLoadError(state, message)
    nextTask = {
      type: "reportLoadError",
    }
  }

  const resume = onLoad(state)
  if (resume.result === LoadResult.FirstLoad) {
    nextTask = {
      type: "testRunStarted",
    }
    state.setTestStage(TestStage.Running)
  } else if (resume.result === LoadResult.ResumeAfterReload) {
    nextTask = {
      type: "runTestPart",
      testRun: newTestRun(resume.test, resume.partIndex),
    }
    state.setTestStage(TestStage.Running)
  } else if (resume.result === LoadResult.ConfigChangedAfterReload) {
    createLoadError(`Mod files/tests changed after reloading. Aborting test run.`)
  } else if (resume.result === LoadResult.AlreadyRunning) {
    createLoadError(
      `Save was unexpectedly reloaded while tests were running. This will cause tests to break. Aborting test run`,
    )
  } else if (resume.result === LoadResult.AlreadyRan) {
    game.print("Tests already ran. Aborting run...")
    nextTask = undefined
  } else {
    assertNever(resume)
  }

  return {
    tick(): void {
      if (ticksToWait > 0) {
        ticksToWait--
        if (ticksToWait > 0) return
      }
      while (nextTask) {
        nextTask = runTask(nextTask)
        if (!nextTask) {
          if (state.getTestStage() !== "LoadError") state.setTestStage(TestStage.Completed)
          return
        }
        const waitTicks = (nextTask as WaitForTestPart).waitTicks
        if (waitTicks && waitTicks > 0) {
          ticksToWait = waitTicks
          return
        }
      }
    },
    isDone() {
      return nextTask === undefined
    },
  }
}

import * as util from "util"
import { TestStage } from "../../constants"
import { withDefaultConfig } from "../config"
import { prepareReload } from "../reload-resume"
import { TestRunner } from "../runner"
import { createTestApi } from "../setup-globals"
import { PersistedRunData, TestContext, TestState } from "../state"
import { StepAction, TestEvent, TestEventListener } from "../test-events"
import { DescribeBlock, stepLabel, Test } from "../tests"
import {
  assertDeepEquals,
  assertEqual,
  assertFalse,
  assertMatches,
  assertNotDeepEquals,
  assertNotNil,
  assertThrows,
  assertThrowsWith,
  assertTrue,
} from "./test-util"
import Config = FactorioTest.Config

let actions: unknown[] = []
let events: TestEvent[] = []
let mockTestStage: TestStage
let mockPersisted: PersistedRunData

function mockConfig(config: Partial<Config> = {}): Config {
  return withDefaultConfig({ default_ticks_between_tests: 0, ...config })
}

const mockContext = new TestContext({
  stage: {
    get: () => mockTestStage,
    set: (stage) => {
      mockTestStage = stage
    },
  },
  persisted: () => mockPersisted,
})
const api = createTestApi(mockContext)

before_each(() => {
  actions = []
  events = []
  mockTestStage = TestStage.NotRun
  mockPersisted = {}
  mockContext.beginDefinition(mockConfig())
})

after_each(() => {
  const unfinished = mockContext.state
  mockContext.state = undefined
  if (unfinished?.kind === "definition" && unfinished.rootBlock.children.length > 0) {
    error("Simulated test defined but not run")
  }
})

/** Restarts the simulated definition phase with a config; must come before anything is defined. */
function useMockConfig(config: Partial<Config>): void {
  if (mockContext.definition().rootBlock.children.length > 0) error("useMockConfig called after defining tests")
  mockContext.beginDefinition(mockConfig(config))
}

const recordEvent: TestEventListener = (event) => {
  events.push(event)
}

function newRunner(state: TestState): TestRunner {
  return new TestRunner(state, [recordEvent])
}

/** Ends the simulated definition phase, and returns the state its suite is run with. */
function finishDefining(): TestState {
  return mockContext.endDefinition()
}

function isDefinitionFinished(): boolean {
  return mockContext.state?.kind === "test"
}

/** Ends the simulated definition phase on first use; a rerun reuses the installed state. */
function stateToRun(): TestState {
  return isDefinitionFinished() ? mockContext.testState() : finishDefining()
}

function getFirst<T extends Test | DescribeBlock = Test>(): T {
  return mockContext.testState().suite.rootBlock.children[0] as T
}

function runTestSync<T extends Test | DescribeBlock = Test>(): T {
  const runner = newRunner(stateToRun())
  runner.tick()
  if (!runner.isDone()) {
    error("Tests not completed in one tick")
  }
  return getFirst()
}

function runTestAsyncWithRunner<T extends Test | DescribeBlock = Test>(
  beforeTick: (runner: TestRunner, tickNumber: number) => void,
  callback: (item: T) => void,
): void {
  if (isDefinitionFinished()) error("duplicate call to runTestAsync/cannot re-run mock test async")
  const runner = newRunner(finishDefining())
  async()
  let tickNumber = 0
  on_tick(() => {
    beforeTick(runner, ++tickNumber)
    runner.tick()
    if (runner.isDone()) {
      callback(getFirst())
      done()
    }
  })
}

function runTestAsync<T extends Test | DescribeBlock = Test>(callback: (item: T) => void): void {
  runTestAsyncWithRunner<T>(() => {}, callback)
}

describe("setup", () => {
  test("a test", () => {
    api.test("Hello", () => {
      // noop
    })
    const result = runTestSync()
    assertNotNil(result)
    assertEqual("Hello", result.name)
    assertMatches(result.path, "Hello")
    assertDeepEquals(mockContext.testState().suite.rootBlock, result.parent)
    assertEqual(0, result.indexInParent)
    assertDeepEquals([], result.errors)
  })

  test("a describe block", () => {
    api.describe("Block", () => {
      api.test("Hello", () => {
        // noop
      })
    })
    const result = runTestSync<DescribeBlock>()
    assertNotNil(result)
    assertEqual("Block", result.name)
    assertMatches(result.path, "Block")
    assertDeepEquals(mockContext.testState().suite.rootBlock, result.parent)
    assertEqual(0, result.indexInParent)

    assertEqual(1, result.children.length)
    const child = result.children[0]!
    assertDeepEquals(result, child.parent)
    assertMatches(child.path, "Block > Hello")
  })

  it("should run tests in order by default", () => {
    api.describe("Block", () => {
      api.test("first", () => {
        actions.push(1)
      })
      api.test("second", () => {
        actions.push(2)
      })
    })

    runTestSync()
    assertDeepEquals([1, 2], actions)
  })

  test("cannot nest tests", () => {
    api.test("Some test", () => {
      api.test("Nested", () => {
        // noop
      })
    })
    const errors = runTestSync().errors
    assertEqual(1, errors.length)
    assertMatches(errors[0]!, "cannot be nested")
  })

  test("cannot nest describe in test", () => {
    api.test("Some test", () => {
      api.describe("Nested", () => {
        // noop
      })
    })
    const errors = runTestSync().errors
    assertEqual(1, errors.length)
    assertMatches(errors[0]!, "cannot be nested")
  })

  test("empty describe is error", () => {
    api.describe("empty", () => {
      // nothing
    })
    const block = runTestSync<DescribeBlock>()
    assertNotDeepEquals([], block.errors)
  })

  test("Failing describe does not report empty describe", () => {
    api.describe("empty", () => {
      error("fail")
    })
    const block = runTestSync<DescribeBlock>()
    assertNotDeepEquals([], block.errors)
    assertEqual(1, block.errors.length)
  })
})

describe("hooks", () => {
  test("beforeAll, afterAll", () => {
    api.before_all(() => {
      actions.push("beforeAll")
    })
    api.after_all(() => {
      actions.push("afterAll")
    })
    api.test("test", () => {
      actions.push("test")
    })
    runTestSync()
    assertDeepEquals(["beforeAll", "test", "afterAll"], actions)
  })

  test("beforeEach, afterEach", () => {
    api.before_each(() => {
      actions.push("beforeEach")
    })
    api.after_each(() => {
      actions.push("afterEach")
    })
    api.test("test", () => {
      actions.push("test")
    })
    runTestSync()
    assertDeepEquals(["beforeEach", "test", "afterEach"], actions)
  })

  test("nested", () => {
    api.before_all(() => actions.push("1 - beforeAll"))
    api.after_all(() => actions.push("1 - afterAll"))
    api.before_each(() => actions.push("1 - beforeEach"))
    api.after_each(() => actions.push("1 - afterEach"))
    api.test("test1", () => {
      actions.push("1 - test")
    })
    api.describe("Scoped / Nested scope", () => {
      api.before_all(() => actions.push("2 - beforeAll"))
      api.after_all(() => actions.push("2 - afterAll"))
      api.before_each(() => actions.push("2 - beforeEach"))
      api.after_each(() => actions.push("2 - afterEach"))
      api.test("test2", () => actions.push("2 - test"))
    })
    runTestSync()
    assertDeepEquals(
      [
        "1 - beforeAll",
        "1 - beforeEach",
        "1 - test",
        "1 - afterEach",
        "2 - beforeAll",
        "1 - beforeEach",
        "2 - beforeEach",
        "2 - test",
        "2 - afterEach",
        "1 - afterEach",
        "2 - afterAll",
        "1 - afterAll",
      ],
      actions,
    )
  })
})

test("passing test", () => {
  function foo(this: void) {
    assertEqual(1, 1)
  }

  api.before_all(foo)
  api.before_each(foo)
  api.after_all(foo)
  api.after_each(foo)
  api.test("pass", foo)

  const result = runTestSync()
  assertDeepEquals([], result.errors)
})

describe("failing tests", () => {
  const failMessage = "FAIL: 238472"

  function fail(this: void) {
    error(failMessage)
  }

  test("test", () => {
    api.test("fail", fail)
    const theTest = runTestSync()
    assertEqual(1, theTest.errors.length)
    assertMatches(theTest.errors[0]!, failMessage)
  })

  test("beforeEach", () => {
    api.before_each(fail)
    api.test("test", () => {
      error("Should not run")
    })
    const theTest = runTestSync()
    assertEqual(1, theTest.errors.length)
    assertMatches(theTest.errors[0]!, failMessage)
  })

  test("beforeAll", () => {
    api.before_all(fail)
    api.test("test", () => {
      error("Should not run")
    })
    const theTest = runTestSync()
    assertDeepEquals([], theTest.errors)
    assertMatches(mockContext.testState().suite.rootBlock.errors[0]!, failMessage)
  })

  test("afterEach", () => {
    api.after_each(fail)
    api.test("test", () => {
      error("first error")
    })
    const theTest = runTestSync()
    assertEqual(2, theTest.errors.length)
    assertMatches(theTest.errors[1]!, failMessage)
  })

  test("afterAll", () => {
    api.after_all(fail)
    api.test("test", () => {
      error("first error")
    })
    const theTest = runTestSync()
    assertEqual(1, theTest.errors.length)
    assertMatches(mockContext.testState().suite.rootBlock.errors[0]!, failMessage)
  })

  test("failure in describe definition", () => {
    api.describe("foo", () => {
      api.test("foo", () => {
        error("should not run")
      })

      error("fail")
    })
    const block = runTestSync<DescribeBlock>()
    assertNotDeepEquals([], block.errors)
    assertDeepEquals([], block.children[0]!.errors)
  })

  test("Error stacktrace is clean", () => {
    api.test("foo", () => {
      error("oh no")
    })
    const t = runTestSync()
    assertEqual(1, t.errors.length)
    const errorMsg = t.errors[0]!
    const frames = errorMsg.split("\n\t").length - 1
    if (frames !== 2) {
      error("Not two stack frames:\n" + errorMsg + "\n")
    }
  })
})

describe("skipped tests", () => {
  function setupActionHooks() {
    api.before_all(() => actions.push("beforeAll"))
    api.after_all(() => actions.push("afterAll"))
    api.before_each(() => actions.push("beforeEach"))
    api.after_each(() => actions.push("afterEach"))
  }

  test("skipped test", () => {
    setupActionHooks()
    api.test.skip("skipped test", () => {
      actions.push("run")
    })
    const first = runTestSync()
    assertDeepEquals([], first.errors)
    assertDeepEquals([], actions, "no actions should be taken on skipped test")
  })

  test("skipped describe", () => {
    setupActionHooks()
    api.describe.skip("skipped describe", () => {
      api.test("skipped test", () => {
        actions.push("run")
      })
    })
    const first = runTestSync<DescribeBlock>().children[0] as Test
    assertDeepEquals([], first.errors)
    assertDeepEquals([], actions, "no actions should be taken on skipped test")
  })

  test("todo", () => {
    setupActionHooks()
    api.test.todo("skipped test")
    const first = runTestSync()
    assertDeepEquals([], first.errors)
  })

  it("only skips skipped tests", () => {
    api.test.skip("skipped test", () => {
      actions.push("no")
    })
    api.test("not skipped test", () => {
      actions.push("yes")
    })
    runTestSync()
    assertDeepEquals(["yes"], actions)
  })
})

describe("focused tests", () => {
  test("focused test", () => {
    api.test.only("should run", () => {
      actions.push("yes")
    })
    api.test("should not run", () => {
      actions.push("no")
    })
    runTestSync()
    assertTrue(mockContext.testState().suite.hasFocusedTests)
    assertDeepEquals(["yes"], actions)
  })

  test("focused describe", () => {
    api.describe.only("should run", () => {
      api.test("", () => {
        actions.push("yes")
      })
    })
    api.describe("should not run", () => {
      api.test("", () => {
        actions.push("no")
      })
    })
    runTestSync()
    assertTrue(mockContext.testState().suite.hasFocusedTests)
    assertDeepEquals(["yes"], actions)
  })

  it("should still respect skip", () => {
    api.describe.only("should run", () => {
      api.test.skip("", () => {
        actions.push("no")
      })
      api.test("", () => {
        actions.push("yes")
      })
    })
    api.describe("should not run", () => {
      api.test("", () => {
        actions.push("no")
      })
    })
    runTestSync()
    assertTrue(mockContext.testState().suite.hasFocusedTests)
    assertDeepEquals(["yes"], actions)
  })

  test("shallow nested focus", () => {
    api.describe.only("should run", () => {
      api.test.only("", () => {
        actions.push("yes1")
      })
      api.test("", () => {
        actions.push("no2")
      })
    })
    api.describe("should not run", () => {
      api.test("", () => {
        actions.push("no2")
      })
    })
    runTestSync()
    assertDeepEquals(["yes1"], actions)
  })

  test("skipped describes do not focus", () => {
    api.describe.skip("func", () => {
      api.test.only("", () => {
        actions.push("no")
      })
    })
    api.test("", () => {
      actions.push("yes")
    })
    runTestSync()
    assertFalse(mockContext.testState().suite.hasFocusedTests, "should not have focused tests if skipped")
    assertDeepEquals(["yes"], actions)
  })
})

describe("async tests", () => {
  test("immediately finished async test", () => {
    api.test("an async", () => {
      api.async()
      actions.push("hello")
      api.done()
    })
    runTestSync()
    assertDeepEquals(["hello"], actions)
  })

  describe("timeout", () => {
    test("Test can timeout", () => {
      let tick = 0
      let failedToTimeOut = false
      api.test("left to timeout", () => {
        api.async(30)
        api.on_tick((t) => {
          tick = t
          if (tick > 40) {
            failedToTimeOut = true
            api.done()
          }
        })
      })
      runTestAsync((test) => {
        assertFalse(failedToTimeOut, "Test failed to time out.")
        assertNotDeepEquals([], test.errors)
        assertEqual(30, tick)
      })
    })

    it.each([0, -1])("does not accept invalid timeout", (value) => {
      api.test("Something", () => {
        api.async(value)
        api.done()
      })
      runTestAsync((test) => {
        assertNotDeepEquals([], test.errors)
      })
    })
  })

  test("async and done can only used during test", () => {
    finishDefining()
    assertThrows(api.async)
    assertThrows(api.done)
  })

  test("done when not async fails", () => {
    api.test("should fail", () => {
      api.done()
    })
    assertNotDeepEquals([], runTestSync().errors)
  })

  test("double async does not fail", () => {
    api.test("test", () => {
      api.async()
      api.async()
      api.done()
    })
    assertDeepEquals([], runTestSync().errors)
  })

  test("double done does not fail", () => {
    api.test("test", () => {
      api.async()
      api.done()
      api.done()
    })
    runTestAsync((test) => {
      assertDeepEquals([], test.errors)
    })
  })
})

describe("on_tick", () => {
  test("simple", () => {
    api.test("an async", () => {
      api.async()
      api.on_tick((tick) => {
        actions.push(tick)
        if (tick === 2) {
          api.done()
        }
      })
    })
    runTestAsync(() => {
      assertDeepEquals([1, 2], actions)
    })
  })

  it("automatically sets async", () => {
    api.test("some thing", () => {
      api.on_tick((t) => {
        if (t === 10) api.done()
      })
    })
    runTestAsync((test) => {
      assertDeepEquals([], test.errors)
    })
  })

  it("only runs on the next tick", () => {
    api.test("an async", () => {
      api.async()
      api.on_tick((tick) => {
        actions.push(tick)
      })
      api.done()
    })
    runTestAsync(() => {
      assertDeepEquals([], actions)
    })
  })

  it("stops test on error", () => {
    api.test("an async", () => {
      api.async()
      api.on_tick(() => {
        actions.push("tick")
        error("uh oh")
      })
    })
    runTestAsync((item) => {
      assertDeepEquals(["tick"], actions)
      assertEqual(1, item.errors.length)
    })
  })

  it("runs in order registered", () => {
    api.test("an async", () => {
      api.async()
      api.on_tick(() => {
        actions.push(1)
      })
      api.on_tick((tick) => {
        actions.push(2)
        if (tick === 2) {
          api.done()
        }
      })
    })
    runTestAsync(() => {
      assertDeepEquals([1, 2, 1, 2], actions)
    })
  })

  it("runs even if done", () => {
    api.test("an async", () => {
      api.async()
      api.on_tick(() => {
        api.done()
      })
      api.on_tick((tick) => {
        actions.push(tick)
      })
    })
    runTestAsync(() => {
      assertDeepEquals([1], actions)
    })
  })

  it("can deregister themselves", () => {
    api.test("an async", () => {
      api.async()
      api.on_tick((tick) => {
        actions.push(tick)
        if (tick === 2) {
          return false
        }
      })
      api.on_tick((tick) => {
        if (tick === 3) api.done()
      })
    })
    runTestAsync(() => {
      assertDeepEquals([1, 2], actions)
    })
  })

  it("can be added at a later time and not immediately run", () => {
    api.test("an async", () => {
      api.async()
      api.on_tick((t) => {
        if (t === 2) {
          api.on_tick((t) => {
            actions.push(t)
            if (t === 4) {
              api.done()
            }
          })
        }
      })
    })
    runTestAsync(() => {
      assertDeepEquals([3, 4], actions)
    })
  })
})

describe("after_ticks", () => {
  test("simple", () => {
    let tick: number
    api.test("an async", () => {
      api.async()
      api.on_tick((t) => {
        tick = t
      })
      api.after_ticks(5, () => {
        api.done()
      })
    })

    runTestAsync(() => {
      assertEqual(5, tick!)
    })
  })

  it("is relative", () => {
    let tick: number
    api.test("an async", () => {
      api.async()
      api.on_tick((t) => {
        tick = t
      })
      api.after_ticks(2, () => {
        api.after_ticks(2, () => {
          api.done()
        })
      })
    })

    runTestAsync(() => {
      assertEqual(4, tick!)
    })
  })

  it("automatically sets async, and ends test when done", () => {
    api.test("an async", () => {
      api.after_ticks(2, () => {
        // do nothing
      })
    })
    runTestAsync((test) => {
      assertDeepEquals([], test.errors)
    })
  })

  test("does not automatically end test if custom timeout given", () => {
    api.test("an async", () => {
      api.async(10)
      api.after_ticks(2, () => {
        // do nothing
      })
    })

    runTestAsync((test) => {
      assertNotDeepEquals([], test.errors)
    })
  })

  it("only accepts valid arguments", () => {
    api.test("Some test", () => {
      api.async()
      api.after_ticks(-1, () => {
        // noop
      })
    })
    runTestAsync((test) => {
      assertNotDeepEquals([], test.errors)
    })
  })
})

describe("ticks between tests", () => {
  test("simple", () => {
    let tick1 = 0
    let tick2 = 0
    let tick3 = 0
    api.ticks_between_tests(2)
    api.test("1", () => {
      tick1 = game.tick
    })

    api.test("2", () => {
      tick2 = game.tick
    })

    api.test("3", () => {
      tick3 = game.tick
    })
    runTestAsync(() => {
      assertEqual(2, tick2 - tick1)
      assertEqual(2, tick3 - tick2)
    })
  })

  it("is local and inherited", () => {
    let tick1 = 0
    let tick2 = 0
    let tick3 = 0
    let tick4 = 0
    let tick5 = 0
    api.ticks_between_tests(2)
    api.describe("nested", () => {
      api.test("1", () => {
        tick1 = game.tick
      })

      api.test("2", () => {
        tick2 = game.tick
      })

      api.ticks_between_tests(3)

      api.test("3", () => {
        tick3 = game.tick
      })
    })

    api.test("4", () => {
      tick4 = game.tick
    })

    api.ticks_between_tests(0)
    api.test("5", () => {
      tick5 = game.tick
    })

    runTestAsync(() => {
      assertEqual(2, tick2 - tick1)
      assertEqual(3, tick3 - tick2)
      assertEqual(2, tick4 - tick3)
      assertEqual(0, tick5 - tick4)
    })
  })

  it("does not wait for skipped tests", () => {
    api.test("1", () => 0)
    api.ticks_between_tests(2)
    api.test.skip("1", () => 0)
    runTestSync()
  })

  it("does not accept negative value", () => {
    assertThrows(() => {
      api.ticks_between_tests(-1)
    })
  })
})

describe.each(["test", "describe"])("%s.each", (funcName) => {
  const creator = funcName === "test" ? api.test : api.describe
  test("single values", () => {
    const values = [1, 2, 3, 4]
    creator.each(values)("an each test", (value) => {
      actions.push(value)
    })
    runTestSync()
    assertDeepEquals(values, actions)
  })

  test("many values", () => {
    const values = [
      [1, 2, "corn"],
      [4, "3", 2],
      [3, { table: "thing" }, 4],
    ]
    creator.each(values)("an each test", (...values) => {
      actions.push(values)
    })
    runTestSync()
    assertDeepEquals(values, actions)
  })

  test("number title format", () => {
    const values = [
      [1, 2, 3],
      [4, 3, 2],
      [3, 3, 4],
    ]
    const title = "%d, %d, %d"
    creator.each(values)(title, (...values) => {
      actions.push(values)
    })
    runTestSync()
    assertDeepEquals(values, actions)
    const titles = mockContext.testState().suite.rootBlock.children.map((x) => x.name)
    assertDeepEquals(
      values.map((v) => string.format(title, ...v)),
      titles,
    )
  })

  test("object title format", () => {
    creator.each([{ prop: "value" }])("%s", () => {
      // nothing
    })
    const item = runTestSync()
    assertEqual('{prop = "value"}', item.name)
  })

  test("$property template syntax", () => {
    creator.each([
      { id: 1, name: "first" },
      { id: 2, name: "second" },
    ])("test $id: $name", () => {})
    runTestSync()
    const names = mockContext.testState().suite.rootBlock.children.map((x) => x.name)
    assertDeepEquals(["test 1: first", "test 2: second"], names)
  })

  test("nested $property.path syntax", () => {
    creator.each([{ meta: { type: "unit" } }])("$meta.type test", () => {})
    const item = runTestSync()
    assertEqual("unit test", item.name)
  })

  test("%# index specifier", () => {
    creator.each([1, 2, 3])("test %#", () => {})
    runTestSync()
    const names = mockContext.testState().suite.rootBlock.children.map((x) => x.name)
    assertDeepEquals(["test 0", "test 1", "test 2"], names)
  })

  test("%$ 1-indexed specifier", () => {
    creator.each([1, 2])("test %$", () => {})
    runTestSync()
    const names = mockContext.testState().suite.rootBlock.children.map((x) => x.name)
    assertDeepEquals(["test 1", "test 2"], names)
  })

  test("%p pretty format", () => {
    creator.each([[{ a: 1 }]])("%p", () => {})
    const item = runTestSync()
    assertMatches(item.name, "a = 1")
  })
})

describe("reload state", () => {
  function reloadAndTick(): void {
    const runner = newRunner(mockContext.testState())
    runner.tick()
  }

  test("Reload state lifecycle", () => {
    api.test("", () => {
      // empty
    })
    api.ticks_between_tests(1)
    api.test("", () => {
      // empty
    })
    const state = finishDefining()
    assertEqual(TestStage.NotRun, mockTestStage)
    const runner = newRunner(state)
    runner.tick()
    assertEqual(TestStage.Running, mockTestStage)
    runner.tick()
    assertEqual(TestStage.Finished, mockTestStage)
  })

  test("Cannot reload while testing", () => {
    api.test("Test 1", () => {
      api.async()
    })
    finishDefining()
    reloadAndTick()
    assertDeepEquals([], mockContext.testState().suite.rootBlock.errors)
    reloadAndTick()
    assertNotDeepEquals([], mockContext.testState().suite.rootBlock.errors)
    assertEqual(TestStage.LoadError, mockTestStage)
  })

  test("can reload after load error", () => {
    api.test("Test 1", () => {
      actions.push("test 1")
    })
    finishDefining()
    mockTestStage = TestStage.LoadError
    reloadAndTick()
    assertDeepEquals([], mockContext.testState().suite.rootBlock.errors)
    assertEqual(TestStage.Finished, mockTestStage)
    assertDeepEquals(["test 1"], actions)
  })
})

describe("test events", () => {
  test("Full lifecycle", () => {
    api.describe("block", () => {
      api.test("test", () => {
        //noop
      })
    })
    runTestSync()
    const expected: TestEvent["type"][] = [
      "testRunStarted",
      "describeBlockEntered",
      "describeBlockEntered",
      "testEntered",
      "testStarted",
      "testPassed",
      "describeBlockFinished",
      "describeBlockFinished",
      "testRunFinished",
    ]
    assertDeepEquals(
      expected,
      events.map((x) => x.type),
    )
  })
  test("failing", () => {
    api.test("test", () => {
      error("on no")
    })
    runTestSync()
    const expected: TestEvent["type"][] = [
      "testRunStarted",
      "describeBlockEntered",
      "testEntered",
      "testStarted",
      "testFailed",
      "describeBlockFinished",
      "testRunFinished",
    ]
    assertDeepEquals(
      expected,
      events.map((x) => x.type),
    )
  })
  test("skipped", () => {
    api.test.skip("test", () => {
      // noop
    })
    runTestSync()
    const expected: TestEvent["type"][] = [
      "testRunStarted",
      "describeBlockEntered",
      "testEntered",
      "testSkipped",
      "describeBlockFinished",
      "testRunFinished",
    ]
    assertDeepEquals(
      expected,
      events.map((x) => x.type),
    )
  })
  test("todo", () => {
    api.test.todo("todo")
    runTestSync()
    const expected: TestEvent["type"][] = [
      "testRunStarted",
      "describeBlockEntered",
      "testEntered",
      "testTodo",
      "describeBlockFinished",
      "testRunFinished",
    ]
    assertDeepEquals(
      expected,
      events.map((x) => x.type),
    )
  })

  test("failing describe block", () => {
    api.describe("describe", () => {
      error("error")
    })
    runTestSync()
    const expected: TestEvent["type"][] = [
      "testRunStarted",
      "describeBlockEntered",
      "describeBlockEntered",
      "describeBlockFailed",
      "describeBlockFinished",
      "testRunFinished",
    ]
    assertDeepEquals(
      expected,
      events.map((x) => x.type),
    )
  })

  test("Failing before_all hook", () => {
    api.describe("describe", () => {
      api.before_all(() => {
        error("error")
      })
      api.test("test", () => {
        // noop
      })
    })
    runTestSync()
    const expected: TestEvent["type"][] = [
      "testRunStarted",
      "describeBlockEntered",
      "describeBlockEntered",
      "describeBlockFailed",
      "describeBlockFinished",
      "testRunFinished",
    ]
    assertDeepEquals(
      expected,
      events.map((x) => x.type),
    )
  })

  test("Failing after_all hook", () => {
    api.describe("describe", () => {
      api.after_all(() => {
        error("error")
      })
      api.test("test", () => {
        // noop
      })
    })
    runTestSync()
    const expected: TestEvent["type"][] = [
      "testRunStarted",
      "describeBlockEntered",
      "describeBlockEntered",
      "testEntered",
      "testStarted",
      "testPassed",
      "describeBlockFailed",
      "describeBlockFinished",
      "testRunFinished",
    ]
    assertDeepEquals(
      expected,
      events.map((x) => x.type),
    )
  })
})

test("the run report outlives the run", () => {
  api.test("foo", () => {
    // noop
  })
  runTestSync()
  const { report } = mockContext.testState()
  assertEqual("passed", report.results.status)
  // the getResults remote and the finished-run duration output both read this after the run ends
  assertNotNil(report.profiler)
})

test("Test pattern", () => {
  useMockConfig({ test_pattern: "foo" })
  api.test("bar", () => {
    actions.push("no")
  })
  api.test("a foo test", () => {
    actions.push("yes1")
  })
  api.describe("foo", () => {
    api.test("yes", () => {
      actions.push("yes2")
    })
  })
  runTestSync()
  assertDeepEquals(["yes1", "yes2"], actions)
})

test("Test pattern list matches any pattern", () => {
  useMockConfig({ test_pattern: ["foo", "baz"] })
  api.test("bar", () => {
    actions.push("no")
  })
  api.test("foo", () => {
    actions.push("yes1")
  })
  api.test("baz", () => {
    actions.push("yes2")
  })
  runTestSync()
  assertDeepEquals(["yes1", "yes2"], actions)
})

describe("tags", () => {
  test("Can add tag to describe block", () => {
    api.tags("foo", "bar")
    api.describe("block", () => {
      // noop
    })
    const result = runTestSync<DescribeBlock>()
    assertDeepEquals(util.list_to_map(["foo", "bar"]), result.tags)
  })

  test("Can add tag to test", () => {
    api.tags("foo", "bar")
    api.test("Some test", () => 0)
    api.test("Some other test", () => 0)
    const result = runTestSync()
    assertDeepEquals(util.list_to_map(["foo", "bar"]), result.tags)
    assertDeepEquals([], mockContext.testState().suite.rootBlock.children[1]!.tags)
  })

  test("Lonely tag call is error", () => {
    api.describe("", () => {
      api.tags("foo", "bar")
    })
    const block = runTestSync<DescribeBlock>()
    assertNotDeepEquals([], block.errors)
  })

  test("double tag call is error", () => {
    api.tags("foo", "bar")
    api.tags("foo", "bar")
    api.test("some test", () => 0)
    runTestSync()
    assertNotDeepEquals([], mockContext.testState().suite.rootBlock.errors)
  })

  test("automatic after_reload_mods tag", () => {
    api.tags("tag1")
    api.test("foo", () => 0).after_reload_mods(() => 0)
    finishDefining()
    assertDeepEquals(util.list_to_map(["tag1", "after_reload_mods"]), getFirst().tags)
  })

  test("automatic after_reload_script tag", () => {
    api.tags("tag1")
    api.test("foo", () => 0).after_reload_script(() => 0)
    finishDefining()
    assertDeepEquals(util.list_to_map(["tag1", "after_reload_script"]), getFirst().tags)
  })

  test("tag whitelist", () => {
    useMockConfig({ tag_whitelist: ["yes"] })
    api.tags("yes")
    api.test("", () => {
      actions.push("yes1")
    })

    api.tags("yes")
    api.describe("", () => {
      api.test("", () => {
        actions.push("yes2")
      })
    })

    api.tags("no")
    api.test("", () => {
      actions.push("no")
    })
    runTestSync()
    assertDeepEquals(["yes1", "yes2"], actions)
  })

  test("tag blacklist", () => {
    useMockConfig({ tag_blacklist: ["no"] })
    api.tags("yes")
    api.test("", () => {
      actions.push("yes")
    })

    api.tags("no")
    api.describe("", () => {
      api.test("", () => {
        actions.push("no")
      })
    })

    api.tags("no")
    api.test("Goodbye", () => {
      actions.push("no")
    })

    runTestSync()
    assertDeepEquals(["yes"], actions)
  })

  test("tag whitelist and blacklist", () => {
    useMockConfig({ tag_whitelist: ["yes"], tag_blacklist: ["no"] })
    api.tags("yes")
    api.test("Hello", () => {
      actions.push("yes")
    })

    api.tags("yes", "no")
    api.test("Hello", () => {
      actions.push("no")
    })

    api.tags("no")
    api.test("Goodbye", () => {
      actions.push("no")
    })

    api.tags("yes")
    api.describe("", () => {
      api.tags("no")
      api.test("", () => {
        actions.push("no")
      })
    })

    runTestSync()
    assertDeepEquals(["yes"], actions)
  })
})

describe("rerun", () => {
  test("rerun", () => {
    api.test("foo", () => {
      actions.push("foo")
    })
    runTestSync()
    assertDeepEquals(["foo"], actions)
    runTestSync()
    assertDeepEquals(["foo", "foo"], actions)
  })

  test("rerun resets test results", () => {
    api.test("foo", () => {
      // noop
    })
    runTestSync()
    assertEqual(1, mockContext.testState().report.results.passed)
    runTestSync()
    assertEqual(1, mockContext.testState().report.results.passed)
  })

  test("rerun after a cancelled run resets the run state", () => {
    api.test("1", () => {
      actions.push("1")
    })
    api.ticks_between_tests(2)
    api.test("2", () => {
      actions.push("2")
    })
    runTestAsyncWithRunner(
      (runner, tickNumber) => {
        if (tickNumber === 2) runner.requestCancel()
      },
      () => {
        assertDeepEquals(["1"], actions, "cancelled before test 2 ran")
        actions = []

        const runner = newRunner(mockContext.testState())
        for (let i = 0; i < 10 && !runner.isDone(); i++) runner.tick()
        assertTrue(runner.isDone(), "rerun must not inherit the cancel request")
        assertDeepEquals(["1", "2"], actions)
      },
    )
  })

  test("rerun skips tests with no_rerun tag", () => {
    useMockConfig({ tag_blacklist: ["no"] })
    api.test("run both", () => {
      actions.push("run both")
    })
    api.tags("no_rerun")
    api.test("run one", () => {
      actions.push("run one")
    })
    api.tags("no")
    api.test("run never", () => {
      actions.push("run never")
    })

    runTestSync()
    assertDeepEquals(["run both", "run one"], actions)
    runTestSync()
    assertDeepEquals(["run both", "run one", "run both"], actions)
    assertDeepEquals(["no"], mockContext.testState().config.tag_blacklist, "rerun must not modify the config")
  })
})

describe("failed tests", () => {
  test("are persisted when the run ends", () => {
    api.test("passes", () => {})
    api.test("fails", () => {
      error("oh no")
    })
    runTestSync()
    assertDeepEquals(util.list_to_map(["fails"]), mockPersisted.lastFailedTests)
  })

  test("run first on the next run", () => {
    useMockConfig({ reorder_failed_first: true })
    mockPersisted.lastFailedTests = util.list_to_map(["second"])
    api.test("first", () => {
      actions.push("first")
    })
    api.test("second", () => {
      actions.push("second")
    })
    runTestSync()
    assertDeepEquals(["second", "first"], actions)
  })
})

describe("cancellation", () => {
  function setupHooks(prefix: string) {
    api.before_all(() => actions.push(prefix + "beforeAll"))
    api.after_all(() => actions.push(prefix + "afterAll"))
    api.before_each(() => actions.push(prefix + "beforeEach"))
    api.after_each(() => actions.push(prefix + "afterEach"))
  }

  function assertLastEvents(expected: TestEvent["type"][]) {
    const types = events.map((x) => x.type)
    assertDeepEquals(expected, types.slice(types.length - expected.length))
  }

  test("cancel during a test runs after hooks up the tree", () => {
    setupHooks("root ")
    api.describe("block", () => {
      setupHooks("block ")
      api.test("async test", () => {
        api.after_test(() => actions.push("afterTest"))
        actions.push("test")
        api.async(100)
        api.on_tick(() => {
          actions.push("tick")
        })
      })
    })
    runTestAsyncWithRunner(
      (runner, tickNumber) => {
        if (tickNumber === 2) runner.requestCancel()
      },
      () => {
        assertDeepEquals(
          [
            "root beforeAll",
            "block beforeAll",
            "root beforeEach",
            "block beforeEach",
            "test",
            "afterTest",
            "block afterEach",
            "root afterEach",
            "block afterAll",
            "root afterAll",
          ],
          actions,
        )
        assertLastEvents(["describeBlockFinished", "describeBlockFinished", "testRunCancelled"])
        assertEqual("cancelled", mockContext.testState().report.results.status)
      },
    )
  })

  test("cancel between tests", () => {
    setupHooks("root ")
    api.test("1", () => actions.push("1"))
    api.ticks_between_tests(2)
    api.test("2", () => actions.push("2"))
    runTestAsyncWithRunner(
      (runner, tickNumber) => {
        if (tickNumber === 2) runner.requestCancel()
      },
      () => {
        assertDeepEquals(["root beforeAll", "root beforeEach", "1", "root afterEach", "root afterAll"], actions)
        assertLastEvents(["describeBlockFinished", "testRunCancelled"])
        assertEqual("cancelled", mockContext.testState().report.results.status)
      },
    )
  })

  test("bail finishes the run instead of cancelling it", () => {
    useMockConfig({ bail: 1 })
    api.after_all(() => actions.push("afterAll"))
    api.test("fail", () => {
      actions.push("fail")
      error("oh no")
    })
    api.test("not run", () => actions.push("not run"))
    runTestAsync(() => {
      assertDeepEquals(["fail", "afterAll"], actions)
      assertTrue(mockContext.testState().report.bailedOut)
      assertLastEvents(["describeBlockFinished", "testRunFinished"])
      assertEqual("failed", mockContext.testState().report.results.status)
    })
  })

  test("cancel does not run after_all for a block whose before_all never ran", () => {
    useMockConfig({ bail: 1 })
    api.test("fail", () => {
      error("oh no")
    })
    api.describe("no active tests", () => {
      api.before_all(() => actions.push("beforeAll"))
      api.after_all(() => actions.push("afterAll"))
      api.test.skip("x", () => {})
    })
    runTestAsync(() => {
      assertDeepEquals([], actions)
    })
  })
})

describe("after_test", () => {
  test("simple", () => {
    api.test("foo", () => {
      api.after_test(() => {
        actions.push("after_foo")
      })
      actions.push("foo")
    })
    runTestSync()
    assertDeepEquals(["foo", "after_foo"], actions)
  })

  test("registered in an earlier part still runs", () => {
    // the error skips the remaining parts, so no reload actually happens
    api
      .test("foo", () => {
        api.after_test(() => {
          actions.push("after_foo")
        })
        error("oh no")
      })
      .after_reload_mods(() => {
        actions.push("continuation")
      })
    runTestSync()
    assertDeepEquals(["after_foo"], actions)
  })

  test("cannot be used before a reload", () => {
    api
      .test("foo", () => {
        api.after_test(() => {
          actions.push("after_foo")
        })
      })
      .after_reload_mods(() => {
        actions.push("continuation")
      })
    const errors = runTestSync().errors
    assertEqual(1, errors.length)
    assertMatches(errors[0]!, "after_test cannot be used before a reload")
    assertDeepEquals(["after_foo"], actions)
  })

  test("called even if test failed", () => {
    api.test("foo", () => {
      api.after_test(() => {
        actions.push("after_foo")
      })
      error("oh no")
    })
    runTestSync()
    assertDeepEquals(["after_foo"], actions)
  })

  test("called in async", () => {
    api.test("foo", () => {
      api.after_test(() => {
        actions.push("after_foo")
      })
      api.async(2)
      api.on_tick(() => {
        actions.push("foo")
      })
    })
    runTestAsync(() => {
      assertDeepEquals(["foo", "foo", "after_foo"], actions)
    })
  })

  test("called in order", () => {
    api.test("foo", () => {
      api.after_test(() => {
        actions.push("after_foo")
      })
      api.after_test(() => {
        actions.push("after_foo2")
      })
      actions.push("foo")
    })
    runTestSync()
    assertDeepEquals(["foo", "after_foo", "after_foo2"], actions)
  })
})

describe("step mode", () => {
  type LogEntry = [tick: number, what: string]

  /** Events and test code, each with the runner tick that ran it; step actions log at the paused tick. */
  let log: LogEntry[]
  let at: number

  before_each(() => {
    log = []
    at = 0
  })

  function mark(what: string): void {
    log.push([at, what])
  }

  function describeEvent(event: TestEvent): string | undefined {
    switch (event.type) {
      case "describeBlockEntered":
      case "describeBlockFinished":
      case "describeBlockFailed":
        return undefined
      case "stepPaused":
        return event.step ? `stepPaused ${event.test.name} > ${event.step}` : `stepPaused ${event.test.name}`
      case "stepResumed":
        return `stepResumed ${event.action}`
      case "stepStarted":
        return `stepStarted ${event.test.name} > ${event.step}`
      default:
        return "test" in event ? `${event.type} ${event.test.name}` : event.type
    }
  }

  const logEvent: TestEventListener = (event) => {
    const what = describeEvent(event)
    if (what) mark(what)
  }

  function newLoggingRunner(state: TestState): TestRunner {
    return new TestRunner(state, [logEvent])
  }

  /**
   * Ticks until done; `onPause` must act on the pause, or return false to stop. `whileRunning` is called after each
   * unpaused tick. Ticks are numbered as runner ticks.
   */
  function drive(
    runner: TestRunner,
    onPause: (runner: TestRunner) => boolean | void = continueAt,
    whileRunning?: (runner: TestRunner) => void,
  ): void {
    let runnerTick = 0
    while (!runner.isDone()) {
      runnerTick++
      if (runnerTick > 100) error("run did not finish")
      at = runnerTick
      runner.tick()
      if (!runner.isStepPaused()) {
        whileRunning?.(runner)
      } else if (onPause(runner) === false) {
        return
      }
    }
  }

  function continueAt(runner: TestRunner): void {
    runner.stepAction("continue")
  }

  function tickWhilePaused(runner: TestRunner, ticks: number): void {
    const logged = log.length
    for (let i = 0; i < ticks; i++) runner.tick()
    assertEqual(logged, log.length, "paused ticks must not emit events or run test code")
  }

  function isPauseOrResume([, what]: LogEntry): boolean {
    return what.startsWith("stepPaused") || what.startsWith("stepResumed")
  }

  function pausedAt(): string[] {
    return log.filter(([, what]) => what.startsWith("stepPaused")).map(([, what]) => what)
  }

  function defineTimeline(ticksBetweenTests: number): void {
    api.ticks_between_tests(ticksBetweenTests)
    api.before_each(() => mark("before_each"))
    api
      .test("A", () => {
        mark("A body")
        api.after_test(() => mark("A after_test"))
      })
      .step("place", () => mark("A place"))
      .step(() => {
        mark("A step 2")
        api.async(2)
        api.after_ticks(2, () => {
          mark("A step 2 done")
          api.done()
        })
      })
    api.test("B", () => mark("B body"))
  }

  const timelineLog: LogEntry[] = [
    [1, "testRunStarted"],
    [1, "testEntered A"],
    [2, "testStarted A"],
    [2, "before_each"],
    [2, "A body"],
    [3, "stepStarted A > place"],
    [3, "A place"],
    [4, "stepStarted A > step 2"],
    [4, "A step 2"],
    [6, "A step 2 done"],
    [6, "A after_test"],
    [6, "testPassed A"],
    [6, "testEntered B"],
    [7, "testStarted B"],
    [7, "before_each"],
    [7, "B body"],
    [7, "testPassed B"],
    [7, "testRunFinished"],
  ]

  test("step mode off: each step part starts on the tick after the previous part completes", () => {
    defineTimeline(1)
    drive(newLoggingRunner(finishDefining()))
    assertDeepEquals(timelineLog, log)
  })

  function assertSteppedTimeline(): void {
    assertDeepEquals(
      [
        [1, "stepPaused A"],
        [1, "stepResumed continue"],
        [2, "stepPaused A > place"],
        [2, "stepResumed continue"],
        [3, "stepPaused A > step 2"],
        [3, "stepResumed continue"],
        [6, "stepPaused B"],
        [6, "stepResumed continue"],
      ],
      log.filter((entry) => isPauseOrResume(entry)),
    )
    assertDeepEquals(
      timelineLog,
      log.filter((entry) => !isPauseOrResume(entry)),
    )
  }

  // ticks_between_tests(0) gains one tick before each test, which makes it match ticks_between_tests(1)
  test.each([
    [1, 0],
    [1, 5],
    [0, 0],
    [0, 5],
  ])("step mode on: pauses, then runs as with step mode off (ticks_between_tests %d, %d paused ticks)", (n, paused) => {
    useMockConfig({ step: true })
    defineTimeline(n)
    drive(newLoggingRunner(finishDefining()), (runner) => {
      tickWhilePaused(runner, paused)
      runner.stepAction("continue")
    })
    assertSteppedTimeline()
  })

  test.each<StepAction>(["skipTest", "runRest", "continue"])("stepAction(%s) while not paused is ignored", (action) => {
    useMockConfig({ step: true })
    defineTimeline(1)
    const runner = newLoggingRunner(finishDefining())
    runner.stepAction(action)
    drive(
      runner,
      (runner) => {
        runner.stepAction("continue")
        runner.stepAction(action)
      },
      (runner) => runner.stepAction(action),
    )
    assertSteppedTimeline()
  })

  test("cancel while not paused cancels without a step resume", () => {
    useMockConfig({ step: true })
    defineTimeline(1)
    drive(newLoggingRunner(finishDefining()), continueAt, (runner) => runner.requestCancel())
    assertDeepEquals(
      [
        [4, "stepStarted A > step 2"],
        [4, "A step 2"],
        [5, "A after_test"],
        [5, "testRunCancelled"],
      ],
      log.slice(-4),
    )
    assertFalse(log.some(([, what]) => what === "stepResumed cancel"))
  })

  describe("step actions", () => {
    function defineActionsFixture({ afterEachThrows = false } = {}): void {
      useMockConfig({ step: true })
      api.ticks_between_tests(1)
      api.after_each(() => {
        mark("after_each")
        if (afterEachThrows) error("after_each error")
      })
      api
        .test("A", () => {
          mark("A body")
          api.after_test(() => mark("A after_test"))
        })
        .step("place", () => mark("A place"))
      api.test("B", () => mark("B body"))
    }

    interface ActionCase {
      name: string
      pauseNumber: number
      act: (runner: TestRunner) => void
      afterEachThrows?: boolean
      expectedLog: LogEntry[]
      expectedResults: { ran: number; skipped: number }
    }

    // pauses: 1 before A, 2 before A > place, 3 before B
    test.each<ActionCase>([
      {
        name: "Skip test before the test",
        pauseNumber: 1,
        act: (runner) => runner.stepAction("skipTest"),
        expectedLog: [
          [1, "stepResumed skipTest"],
          [2, "testSkippedByUser A"],
          [2, "testEntered B"],
          [2, "stepPaused B"],
        ],
        expectedResults: { ran: 0, skipped: 1 },
      },
      {
        name: "Skip test before a step part: tears down, discarding teardown errors",
        pauseNumber: 2,
        act: (runner) => runner.stepAction("skipTest"),
        afterEachThrows: true,
        expectedLog: [
          [2, "stepResumed skipTest"],
          [3, "A after_test"],
          [3, "after_each"],
          [3, "testSkippedByUser A"],
          [3, "testEntered B"],
          [3, "stepPaused B"],
        ],
        expectedResults: { ran: 0, skipped: 1 },
      },
      {
        name: "Run to end",
        pauseNumber: 1,
        act: (runner) => runner.stepAction("runRest"),
        expectedLog: [
          [1, "stepResumed runRest"],
          [2, "testStarted A"],
          [2, "A body"],
          [3, "stepStarted A > place"],
          [3, "A place"],
          [3, "A after_test"],
          [3, "after_each"],
          [3, "testPassed A"],
          [3, "testEntered B"],
          [4, "testStarted B"],
          [4, "B body"],
          [4, "after_each"],
          [4, "testPassed B"],
          [4, "testRunFinished"],
        ],
        expectedResults: { ran: 2, skipped: 0 },
      },
      {
        name: "Cancel before a step part",
        pauseNumber: 2,
        act: (runner) => runner.requestCancel(),
        expectedLog: [
          [2, "stepResumed cancel"],
          [3, "A after_test"],
          [3, "after_each"],
          [3, "testRunCancelled"],
        ],
        expectedResults: { ran: 0, skipped: 0 },
      },
    ])("$name", ({ pauseNumber, act, afterEachThrows, expectedLog, expectedResults }) => {
      defineActionsFixture({ afterEachThrows })
      let pauses = 0
      let actionLogIndex = -1
      drive(newLoggingRunner(finishDefining()), (runner) => {
        pauses++
        if (pauses > pauseNumber) return false
        if (pauses < pauseNumber) return runner.stepAction("continue")
        actionLogIndex = log.length
        act(runner)
      })
      assertDeepEquals(expectedLog, log.slice(actionLogIndex))
      const { results } = mockContext.testState().report
      assertDeepEquals(expectedResults, { ran: results.ran, skipped: results.skipped })
      assertDeepEquals([], getFirst().errors)
    })

    test("Run to end lasts only for the current run", () => {
      defineActionsFixture()
      const state = finishDefining()
      drive(newLoggingRunner(state), (runner) => runner.stepAction("runRest"))
      assertEqual(1, pausedAt().length)

      const rerun = newLoggingRunner(state)
      rerun.tick()
      assertTrue(rerun.isStepPaused())
    })
  })

  test("does not pause before skipped tests, or before the remaining parts of a failed test", () => {
    useMockConfig({ step: true })
    api.test.skip("skipped", () => {})
    api
      .test("fails", () => {})
      .step(() => error("boom"))
      .step(() => mark("never"))
    api.test("next", () => {})
    drive(newLoggingRunner(finishDefining()))
    assertDeepEquals(["stepPaused fails", "stepPaused fails > step 1", "stepPaused next"], pausedAt())
    assertFalse(log.some(([, what]) => what === "never"))
  })

  test.each([
    {
      type: "sync",
      tick: 3,
      stepFunc: () => {
        mark("boom")
        error("boom")
      },
    },
    {
      type: "async",
      tick: 4,
      stepFunc: () =>
        api.after_ticks(1, () => {
          mark("boom")
          error("boom")
        }),
    },
  ])("an error in a $type step tears down on the same tick ($tick)", ({ tick, stepFunc }) => {
    useMockConfig({ step: true })
    api.after_each(() => mark("after_each"))
    api.test("A", () => api.after_test(() => mark("after_test"))).step(stepFunc)
    drive(newLoggingRunner(finishDefining()))
    assertDeepEquals(
      [
        [tick, "boom"],
        [tick, "after_test"],
        [tick, "after_each"],
        [tick, "testFailed A"],
        [tick, "testRunFinished"],
      ],
      log.slice(-5),
    )
  })

  test.each([
    {
      name: "a captioned step",
      defineTest: () => api.test("A", () => {}).step("explodes", () => error("boom")),
      expectedPrefix: 'In step "explodes": ',
      expectedMessage: "boom",
    },
    {
      name: "an uncaptioned step",
      defineTest: () => api.test("A", () => {}).step(() => error("boom")),
      expectedPrefix: "In step 1: ",
      expectedMessage: "boom",
    },
    {
      name: "an async step",
      defineTest: () => api.test("A", () => {}).step(() => api.after_ticks(1, () => error("boom"))),
      expectedPrefix: "In step 1: ",
      expectedMessage: "boom",
    },
    {
      name: "a timed out step",
      defineTest: () => api.test("A", () => {}).step(() => api.async(1)),
      expectedPrefix: "In step 1: ",
      expectedMessage: "Test timed out",
    },
  ])("errors in $name name the step", ({ defineTest, expectedPrefix, expectedMessage }) => {
    defineTest()
    drive(newLoggingRunner(finishDefining()))
    const { errors } = getFirst()
    assertEqual(1, errors.length)
    assertTrue(errors[0]!.startsWith(expectedPrefix), errors[0])
    assertMatches(errors[0]!, expectedMessage)
  })

  test("step parts are declared in order, with step labels and each-row args", () => {
    api.test
      .each([[1, 2]])("each", () => {})
      .step("a", (a, b) => mark(`a ${a} ${b}`))
      .after_reload_mods(() => {})
      .step((a, b) => mark(`step ${a} ${b}`))
    finishDefining()

    const { parts } = getFirst()
    assertEqual(4, parts.length)
    assertEqual("mods", parts[2]!.reloadBefore)
    assertEqual(undefined, parts[2]!.step)
    assertDeepEquals(["a", "step 2"], [stepLabel(parts[1]!.step!), stepLabel(parts[3]!.step!)])
    parts[1]!.func()
    parts[3]!.func()
    assertDeepEquals(
      [
        [0, "a 1 2"],
        [0, "step 1 2"],
      ],
      log,
    )
  })

  test("step() accepts an optional caption and a function, and rejects anything else", () => {
    const message = `step() takes an optional caption and a function: test(...).step("caption", func) or test(...).step(func)`
    const builder = api.test("test", () => {})
    builder.step(() => {})
    builder.step("caption", () => {})
    const looseStep = builder.step as unknown as (this: void, ...args: unknown[]) => void
    const func = () => {}
    // a Lua `:step(...)` call passes the builder first
    assertThrowsWith(() => looseStep(builder, func), message)
    assertThrowsWith(() => looseStep(builder, "caption", func), message)
    assertThrowsWith(() => looseStep(1, func), message)
    assertThrowsWith(() => looseStep("caption", "not a function"), message)
    assertThrowsWith(() => looseStep(func, func), message)
    finishDefining()
    assertEqual(3, getFirst().parts.length)
  })

  test("async scoping: a part's on_tick handlers stop when the next step starts", () => {
    api
      .test("A", () => {
        api.async()
        api.on_tick((tick) => mark(`body tick ${tick}`))
        api.after_ticks(3, () => api.done())
      })
      .step(() => {
        api.async(1)
        api.after_ticks(1, () => api.done())
      })
    const state = finishDefining()
    drive(newLoggingRunner(state))
    assertDeepEquals(
      [
        [2, "body tick 1"],
        [3, "body tick 2"],
        [4, "body tick 3"],
      ],
      log.filter(([, what]) => what.startsWith("body tick")),
    )
    assertDeepEquals([], getFirst().errors)
  })

  const betweenPartsCalls: [name: string, call: () => void][] = [
    ["async", () => api.async()],
    ["done", () => api.done()],
    ["on_tick", () => api.on_tick(() => {})],
    ["after_ticks", () => api.after_ticks(1, () => {})],
  ]
  test.each(
    betweenPartsCalls.flatMap(([name, call]) => [false, true].map((stepping) => [name, stepping, call] as const)),
  )("%s() between parts throws (step mode %s)", (name, stepping, call) => {
    useMockConfig({ step: stepping })
    api.test("A", () => {}).step(() => {})
    const runner = newLoggingRunner(finishDefining())
    runner.tick()
    if (stepping) {
      runner.stepAction("continue")
      runner.tick()
      assertTrue(runner.isStepPaused())
    }
    assertThrowsWith(call, `${name}() cannot be called between test parts`)
    drive(runner)
  })

  test.each([
    [true, false],
    [false, true],
  ])("a reload carries stepping (%s), not config.step (%s)", (stepping, configStep) => {
    function defineReloadingTest() {
      api
        .test("A", () => {})
        .after_reload_mods(() => {})
        .step(() => {})
    }
    defineReloadingTest()
    prepareReload(finishDefining(), { test: getFirst(), partIndex: 1, stepping })

    mockContext.beginDefinition(mockConfig({ step: configStep }))
    defineReloadingTest()
    const runner = newLoggingRunner(finishDefining())
    runner.tick()
    assertEqual(stepping, runner.isStepPaused())
    drive(runner)
  })
})

test("a test with a really, really, incredibly long name such that it might extend pass the length of the output window, and this text needs to be even longer for that to happen", () => {
  assertTrue(true)
})

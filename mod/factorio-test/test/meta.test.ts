import * as util from "util"
import { TestStage } from "../../constants"
import { fillConfig } from "../config"
import { resultCollector } from "../results"
import { TestRunner } from "../runner"
import { createTestApi } from "../setup-globals"
import { TestContext, TestState } from "../state"
import { TestEvent, TestEventListener } from "../test-events"
import { propagateTestMode } from "../test-mode"
import { DescribeBlock, Test } from "../tests"
import {
  assertDeepEquals,
  assertEqual,
  assertFalse,
  assertMatches,
  assertNotDeepEquals,
  assertNotNil,
  assertThrows,
  assertTrue,
} from "./test-util"
import Config = FactorioTest.Config

let actions: unknown[] = []
let events: TestEvent[] = []
let mockTestStage: TestStage

function defaultMockConfig(): Config {
  return fillConfig({ default_ticks_between_tests: 0 })
}

const mockContext = new TestContext(defaultMockConfig(), {
  get: () => mockTestStage,
  set: (stage) => {
    mockTestStage = stage
  },
})
const api = createTestApi(mockContext)

before_each(() => {
  actions = []
  events = []
  mockTestStage = TestStage.NotRun
  mockContext.config = defaultMockConfig()
  mockContext.beginDefinition()
})

after_each(() => {
  const unfinished = mockContext.state
  mockContext.state = undefined
  if (unfinished?.kind === "definition" && unfinished.rootBlock.children.length > 0) {
    error("Simulated test defined but not run")
  }
})

function setMockConfig(config: Config): void {
  mockContext.config = config
}

const mockListeners: TestEventListener[] = [
  (event) => {
    events.push(event)
  },
  resultCollector,
]

function newRunner(state: TestState): TestRunner {
  return new TestRunner(state, mockListeners)
}

/** Ends the simulated definition phase, and returns the state its suite is run with. */
function finishDefining(): TestState {
  const definition = mockContext.definition()
  propagateTestMode(definition, definition.rootBlock, undefined)
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

function skipRun() {
  finishDefining()
  mockTestStage = TestStage.Finished
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
    assertEqual(TestStage.NotRun, state.stage.get())
    const runner = newRunner(state)
    runner.tick()
    assertEqual(TestStage.Running, mockContext.testState().stage.get())
    runner.tick()
    assertEqual(TestStage.Finished, mockContext.testState().stage.get())
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
    assertEqual(TestStage.LoadError, mockContext.testState().stage.get())
  })

  test("can reload after load error", () => {
    api.test("Test 1", () => {
      actions.push("test 1")
    })
    finishDefining()
    mockContext.testState().stage.set(TestStage.LoadError)
    reloadAndTick()
    assertDeepEquals([], mockContext.testState().suite.rootBlock.errors)
    assertEqual(TestStage.Finished, mockContext.testState().stage.get())
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
  setMockConfig(
    fillConfig({
      test_pattern: "foo",
    }),
  )
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
  setMockConfig(
    fillConfig({
      test_pattern: ["foo", "baz"],
    }),
  )
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
    skipRun()
    assertDeepEquals(util.list_to_map(["tag1", "after_reload_mods"]), getFirst().tags)
  })

  test("automatic after_reload_script tag", () => {
    api.tags("tag1")
    api.test("foo", () => 0).after_reload_script(() => 0)
    skipRun()
    assertDeepEquals(util.list_to_map(["tag1", "after_reload_script"]), getFirst().tags)
  })

  test("tag whitelist", () => {
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
    setMockConfig(fillConfig({ tag_whitelist: ["yes"] }))
    runTestSync()
    assertDeepEquals(["yes1", "yes2"], actions)
  })

  test("tag blacklist", () => {
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

    setMockConfig(fillConfig({ tag_blacklist: ["no"] }))
    runTestSync()
    assertDeepEquals(["yes"], actions)
  })

  test("tag whitelist and blacklist", () => {
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

    setMockConfig(fillConfig({ tag_whitelist: ["yes"], tag_blacklist: ["no"] }))
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

  test("rerun blacklists tests with no_rerun tag", () => {
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

    setMockConfig(fillConfig({ tag_blacklist: ["no"] }))

    runTestSync()
    assertDeepEquals(["run both", "run one"], actions)
    runTestSync()
    assertDeepEquals(["run both", "run one", "run both"], actions)
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
    setMockConfig(fillConfig({ bail: 1 }))
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
    setMockConfig(fillConfig({ bail: 1 }))
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

test("a test with a really, really, incredibly long name such that it might extend pass the length of the output window, and this text needs to be even longer for that to happen", () => {
  assertTrue(true)
})

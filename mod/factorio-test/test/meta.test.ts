import * as util from "util"
import { TestStage } from "../../constants"
import { fillConfig } from "../config"
import { resultCollector } from "../results"
import { createTestRunner, TestRunner } from "../runner"
import { _clearDefinition, beginDefinition, endDefinition, getDefinitionState } from "../definition"
import { _setTestState, getTestState, TestState } from "../state"
import Config = FactorioTest.Config
import { TestEvent } from "../test-events"
import { DescribeBlock, Test } from "../tests"
import { propagateTestMode } from "../test-mode"
import {
  assertEqual,
  assertNotNil,
  assertDeepEquals,
  assertNotDeepEquals,
  assertMatches,
  assertTrue,
  assertFalse,
  assertThrows,
} from "./test-util"

let actions: unknown[] = []
let events: TestEvent[] = []
let mockTestState: TestState
let originalTestState: TestState
let mockTestStage: TestStage

before_each(() => {
  actions = []
  events = []
  mockTestStage = TestStage.NotRun
  originalTestState = getTestState()
  mockTestState = undefined!
  beginDefinition(
    fillConfig({
      default_ticks_between_tests: 0,
    }),
  )
})

after_each(() => {
  _setTestState(originalTestState)
  const unfinished = _clearDefinition()
  if (unfinished && unfinished.suite.rootBlock.children.length > 0) {
    error("Simulated test defined but not run")
  }
})

function setMockConfig(config: Config): void {
  getDefinitionState().config = config
}

/** Ends the simulated definition phase, and installs the state its suite is run with. */
function finishDefining(): TestState {
  const definition = getDefinitionState()
  propagateTestMode(definition.suite, definition.suite.rootBlock, undefined)
  mockTestState = endDefinition()
  mockTestState.env = {
    getTestStage: () => mockTestStage,
    setTestStage: (stage) => {
      mockTestStage = stage
    },
    emit: (event) => {
      events.push(event)
      resultCollector(event, mockTestState)
    },
  }
  return mockTestState
}

/** Ends the simulated definition phase on first use; a rerun reuses the installed state. */
function stateToRun(): TestState {
  return mockTestState ?? finishDefining()
}

function getFirst<T extends Test | DescribeBlock = Test>(): T {
  return mockTestState.suite.rootBlock.children[0] as T
}

function runTestSync<T extends Test | DescribeBlock = Test>(): T {
  const runner = createTestRunner(stateToRun())
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
  if (mockTestState) error("duplicate call to runTestAsync/cannot re-run mock test async")
  const runner = createTestRunner(finishDefining())
  _setTestState(originalTestState)
  async()
  let tickNumber = 0
  on_tick(() => {
    beforeTick(runner, ++tickNumber)
    runner.tick()
    if (runner.isDone()) {
      callback(getFirst())
      _setTestState(originalTestState)
      done()
    }
  })
  _setTestState(mockTestState)
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
    test("Hello", () => {
      // noop
    })
    const result = runTestSync()
    assertNotNil(result)
    assertEqual("Hello", result.name)
    assertMatches(result.path, "Hello")
    assertDeepEquals(mockTestState.suite.rootBlock, result.parent)
    assertEqual(0, result.indexInParent)
    assertDeepEquals([], result.errors)
  })

  test("a describe block", () => {
    describe("Block", () => {
      test("Hello", () => {
        // noop
      })
    })
    const result = runTestSync<DescribeBlock>()
    assertNotNil(result)
    assertEqual("Block", result.name)
    assertMatches(result.path, "Block")
    assertDeepEquals(mockTestState.suite.rootBlock, result.parent)
    assertEqual(0, result.indexInParent)

    assertEqual(1, result.children.length)
    const child = result.children[0]!
    assertDeepEquals(result, child.parent)
    assertMatches(child.path, "Block > Hello")
  })

  it("should run tests in order by default", () => {
    describe("Block", () => {
      test("first", () => {
        actions.push(1)
      })
      test("second", () => {
        actions.push(2)
      })
    })

    runTestSync()
    assertDeepEquals([1, 2], actions)
  })

  test("cannot nest tests", () => {
    test("Some test", () => {
      test("Nested", () => {
        // noop
      })
    })
    const errors = runTestSync().errors
    assertEqual(1, errors.length)
    assertMatches(errors[0]!, "cannot be nested")
  })

  test("cannot nest describe in test", () => {
    test("Some test", () => {
      describe("Nested", () => {
        // noop
      })
    })
    const errors = runTestSync().errors
    assertEqual(1, errors.length)
    assertMatches(errors[0]!, "cannot be nested")
  })

  test("empty describe is error", () => {
    describe("empty", () => {
      // nothing
    })
    const block = runTestSync<DescribeBlock>()
    assertNotDeepEquals([], block.errors)
  })

  test("Failing describe does not report empty describe", () => {
    describe("empty", () => {
      error("fail")
    })
    const block = runTestSync<DescribeBlock>()
    assertNotDeepEquals([], block.errors)
    assertEqual(1, block.errors.length)
  })
})

describe("hooks", () => {
  test("beforeAll, afterAll", () => {
    before_all(() => {
      actions.push("beforeAll")
    })
    after_all(() => {
      actions.push("afterAll")
    })
    test("test", () => {
      actions.push("test")
    })
    runTestSync()
    assertDeepEquals(["beforeAll", "test", "afterAll"], actions)
  })

  test("beforeEach, afterEach", () => {
    before_each(() => {
      actions.push("beforeEach")
    })
    after_each(() => {
      actions.push("afterEach")
    })
    test("test", () => {
      actions.push("test")
    })
    runTestSync()
    assertDeepEquals(["beforeEach", "test", "afterEach"], actions)
  })

  test("nested", () => {
    before_all(() => actions.push("1 - beforeAll"))
    after_all(() => actions.push("1 - afterAll"))
    before_each(() => actions.push("1 - beforeEach"))
    after_each(() => actions.push("1 - afterEach"))
    test("test1", () => {
      actions.push("1 - test")
    })
    describe("Scoped / Nested scope", () => {
      before_all(() => actions.push("2 - beforeAll"))
      after_all(() => actions.push("2 - afterAll"))
      before_each(() => actions.push("2 - beforeEach"))
      after_each(() => actions.push("2 - afterEach"))
      test("test2", () => actions.push("2 - test"))
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

  before_all(foo)
  before_each(foo)
  after_all(foo)
  after_each(foo)
  test("pass", foo)

  const result = runTestSync()
  assertDeepEquals([], result.errors)
})

describe("failing tests", () => {
  const failMessage = "FAIL: 238472"

  function fail(this: void) {
    error(failMessage)
  }

  test("test", () => {
    test("fail", fail)
    const theTest = runTestSync()
    assertEqual(1, theTest.errors.length)
    assertMatches(theTest.errors[0]!, failMessage)
  })

  test("beforeEach", () => {
    before_each(fail)
    test("test", () => {
      error("Should not run")
    })
    const theTest = runTestSync()
    assertEqual(1, theTest.errors.length)
    assertMatches(theTest.errors[0]!, failMessage)
  })

  test("beforeAll", () => {
    before_all(fail)
    test("test", () => {
      error("Should not run")
    })
    const theTest = runTestSync()
    assertDeepEquals([], theTest.errors)
    assertMatches(mockTestState.suite.rootBlock.errors[0]!, failMessage)
  })

  test("afterEach", () => {
    after_each(fail)
    test("test", () => {
      error("first error")
    })
    const theTest = runTestSync()
    assertEqual(2, theTest.errors.length)
    assertMatches(theTest.errors[1]!, failMessage)
  })

  test("afterAll", () => {
    after_all(fail)
    test("test", () => {
      error("first error")
    })
    const theTest = runTestSync()
    assertEqual(1, theTest.errors.length)
    assertMatches(mockTestState.suite.rootBlock.errors[0]!, failMessage)
  })

  test("failure in describe definition", () => {
    describe("foo", () => {
      test("foo", () => {
        error("should not run")
      })

      error("fail")
    })
    const block = runTestSync<DescribeBlock>()
    assertNotDeepEquals([], block.errors)
    assertDeepEquals([], block.children[0]!.errors)
  })

  test("Error stacktrace is clean", () => {
    test("foo", () => {
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
    before_all(() => actions.push("beforeAll"))
    after_all(() => actions.push("afterAll"))
    before_each(() => actions.push("beforeEach"))
    after_each(() => actions.push("afterEach"))
  }

  test("skipped test", () => {
    setupActionHooks()
    test.skip("skipped test", () => {
      actions.push("run")
    })
    const first = runTestSync()
    assertDeepEquals([], first.errors)
    assertDeepEquals([], actions, "no actions should be taken on skipped test")
  })

  test("skipped describe", () => {
    setupActionHooks()
    describe.skip("skipped describe", () => {
      test("skipped test", () => {
        actions.push("run")
      })
    })
    const first = runTestSync<DescribeBlock>().children[0] as Test
    assertDeepEquals([], first.errors)
    assertDeepEquals([], actions, "no actions should be taken on skipped test")
  })

  test("todo", () => {
    setupActionHooks()
    test.todo("skipped test")
    const first = runTestSync()
    assertDeepEquals([], first.errors)
  })

  it("only skips skipped tests", () => {
    test.skip("skipped test", () => {
      actions.push("no")
    })
    test("not skipped test", () => {
      actions.push("yes")
    })
    runTestSync()
    assertDeepEquals(["yes"], actions)
  })
})

describe("focused tests", () => {
  test("focused test", () => {
    test.only("should run", () => {
      actions.push("yes")
    })
    test("should not run", () => {
      actions.push("no")
    })
    runTestSync()
    assertTrue(mockTestState.suite.hasFocusedTests)
    assertDeepEquals(["yes"], actions)
  })

  test("focused describe", () => {
    describe.only("should run", () => {
      test("", () => {
        actions.push("yes")
      })
    })
    describe("should not run", () => {
      test("", () => {
        actions.push("no")
      })
    })
    runTestSync()
    assertTrue(mockTestState.suite.hasFocusedTests)
    assertDeepEquals(["yes"], actions)
  })

  it("should still respect skip", () => {
    describe.only("should run", () => {
      test.skip("", () => {
        actions.push("no")
      })
      test("", () => {
        actions.push("yes")
      })
    })
    describe("should not run", () => {
      test("", () => {
        actions.push("no")
      })
    })
    runTestSync()
    assertTrue(mockTestState.suite.hasFocusedTests)
    assertDeepEquals(["yes"], actions)
  })

  test("shallow nested focus", () => {
    describe.only("should run", () => {
      test.only("", () => {
        actions.push("yes1")
      })
      test("", () => {
        actions.push("no2")
      })
    })
    describe("should not run", () => {
      test("", () => {
        actions.push("no2")
      })
    })
    runTestSync()
    assertDeepEquals(["yes1"], actions)
  })

  test("skipped describes do not focus", () => {
    describe.skip("func", () => {
      test.only("", () => {
        actions.push("no")
      })
    })
    test("", () => {
      actions.push("yes")
    })
    runTestSync()
    assertFalse(mockTestState.suite.hasFocusedTests, "should not have focused tests if skipped")
    assertDeepEquals(["yes"], actions)
  })
})

describe("async tests", () => {
  test("immediately finished async test", () => {
    test("an async", () => {
      async()
      actions.push("hello")
      done()
    })
    runTestSync()
    assertDeepEquals(["hello"], actions)
  })

  describe("timeout", () => {
    test("Test can timeout", () => {
      let tick = 0
      let failedToTimeOut = false
      test("left to timeout", () => {
        async(30)
        on_tick((t) => {
          tick = t
          if (tick > 40) {
            failedToTimeOut = true
            done()
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
      test("Something", () => {
        async(value)
        done()
      })
      runTestAsync((test) => {
        assertNotDeepEquals([], test.errors)
      })
    })
  })

  test("async and done can only used during test", () => {
    // a state that is not running a test: the mock, rather than the real run around it
    _setTestState(finishDefining())
    assertThrows(async)
    assertThrows(done)
    _setTestState(originalTestState)
  })

  test("done when not async fails", () => {
    test("should fail", () => {
      done()
    })
    assertNotDeepEquals([], runTestSync().errors)
  })

  test("double async does not fail", () => {
    test("test", () => {
      async()
      async()
      done()
    })
    assertDeepEquals([], runTestSync().errors)
  })

  test("double done does not fail", () => {
    test("test", () => {
      async()
      done()
      done()
    })
    runTestAsync((test) => {
      assertDeepEquals([], test.errors)
    })
  })
})

describe("on_tick", () => {
  test("simple", () => {
    test("an async", () => {
      async()
      on_tick((tick) => {
        actions.push(tick)
        if (tick === 2) {
          done()
        }
      })
    })
    runTestAsync(() => {
      assertDeepEquals([1, 2], actions)
    })
  })

  it("automatically sets async", () => {
    test("some thing", () => {
      on_tick((t) => {
        if (t === 10) done()
      })
    })
    runTestAsync((test) => {
      assertDeepEquals([], test.errors)
    })
  })

  it("only runs on the next tick", () => {
    test("an async", () => {
      async()
      on_tick((tick) => {
        actions.push(tick)
      })
      done()
    })
    runTestAsync(() => {
      assertDeepEquals([], actions)
    })
  })

  it("stops test on error", () => {
    test("an async", () => {
      async()
      on_tick(() => {
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
    test("an async", () => {
      async()
      on_tick(() => {
        actions.push(1)
      })
      on_tick((tick) => {
        actions.push(2)
        if (tick === 2) {
          done()
        }
      })
    })
    runTestAsync(() => {
      assertDeepEquals([1, 2, 1, 2], actions)
    })
  })

  it("runs even if done", () => {
    test("an async", () => {
      async()
      on_tick(() => {
        done()
      })
      on_tick((tick) => {
        actions.push(tick)
      })
    })
    runTestAsync(() => {
      assertDeepEquals([1], actions)
    })
  })

  it("can deregister themselves", () => {
    test("an async", () => {
      async()
      on_tick((tick) => {
        actions.push(tick)
        if (tick === 2) {
          return false
        }
      })
      on_tick((tick) => {
        if (tick === 3) done()
      })
    })
    runTestAsync(() => {
      assertDeepEquals([1, 2], actions)
    })
  })

  it("can be added at a later time and not immediately run", () => {
    test("an async", () => {
      async()
      on_tick((t) => {
        if (t === 2) {
          on_tick((t) => {
            actions.push(t)
            if (t === 4) {
              done()
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
    test("an async", () => {
      async()
      on_tick((t) => {
        tick = t
      })
      after_ticks(5, () => {
        done()
      })
    })

    runTestAsync(() => {
      assertEqual(5, tick!)
    })
  })

  it("is relative", () => {
    let tick: number
    test("an async", () => {
      async()
      on_tick((t) => {
        tick = t
      })
      after_ticks(2, () => {
        after_ticks(2, () => {
          done()
        })
      })
    })

    runTestAsync(() => {
      assertEqual(4, tick!)
    })
  })

  it("automatically sets async, and ends test when done", () => {
    test("an async", () => {
      after_ticks(2, () => {
        // do nothing
      })
    })
    runTestAsync((test) => {
      assertDeepEquals([], test.errors)
    })
  })

  test("does not automatically end test if custom timeout given", () => {
    test("an async", () => {
      async(10)
      after_ticks(2, () => {
        // do nothing
      })
    })

    runTestAsync((test) => {
      assertNotDeepEquals([], test.errors)
    })
  })

  it("only accepts valid arguments", () => {
    test("Some test", () => {
      async()
      after_ticks(-1, () => {
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
    ticks_between_tests(2)
    test("1", () => {
      tick1 = game.tick
    })

    test("2", () => {
      tick2 = game.tick
    })

    test("3", () => {
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
    ticks_between_tests(2)
    describe("nested", () => {
      test("1", () => {
        tick1 = game.tick
      })

      test("2", () => {
        tick2 = game.tick
      })

      ticks_between_tests(3)

      test("3", () => {
        tick3 = game.tick
      })
    })

    test("4", () => {
      tick4 = game.tick
    })

    ticks_between_tests(0)
    test("5", () => {
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
    test("1", () => 0)
    ticks_between_tests(2)
    test.skip("1", () => 0)
    runTestSync()
  })

  it("does not accept negative value", () => {
    assertThrows(() => {
      ticks_between_tests(-1)
    })
  })
})

describe.each(["test", "describe"])("%s.each", (funcName) => {
  const creator = funcName === "test" ? test : describe
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
    const titles = mockTestState.suite.rootBlock.children.map((x) => x.name)
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
    const names = mockTestState.suite.rootBlock.children.map((x) => x.name)
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
    const names = mockTestState.suite.rootBlock.children.map((x) => x.name)
    assertDeepEquals(["test 0", "test 1", "test 2"], names)
  })

  test("%$ 1-indexed specifier", () => {
    creator.each([1, 2])("test %$", () => {})
    runTestSync()
    const names = mockTestState.suite.rootBlock.children.map((x) => x.name)
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
    const runner = createTestRunner(mockTestState)
    runner.tick()
  }

  test("Reload state lifecycle", () => {
    test("", () => {
      // empty
    })
    ticks_between_tests(1)
    test("", () => {
      // empty
    })
    const state = finishDefining()
    assertEqual(TestStage.NotRun, state.env.getTestStage())
    const runner = createTestRunner(state)
    runner.tick()
    assertEqual(TestStage.Running, mockTestState.env.getTestStage())
    runner.tick()
    assertEqual(TestStage.Finished, mockTestState.env.getTestStage())
  })

  test("Cannot reload while testing", () => {
    test("Test 1", () => {
      async()
    })
    finishDefining()
    reloadAndTick()
    assertDeepEquals([], mockTestState.suite.rootBlock.errors)
    reloadAndTick()
    assertNotDeepEquals([], mockTestState.suite.rootBlock.errors)
    assertEqual(TestStage.LoadError, mockTestState.env.getTestStage())
  })

  test("can reload after load error", () => {
    test("Test 1", () => {
      actions.push("test 1")
    })
    finishDefining()
    mockTestState.env.setTestStage(TestStage.LoadError)
    reloadAndTick()
    assertDeepEquals([], mockTestState.suite.rootBlock.errors)
    assertEqual(TestStage.Finished, mockTestState.env.getTestStage())
    assertDeepEquals(["test 1"], actions)
  })
})

describe("test events", () => {
  test("Full lifecycle", () => {
    describe("block", () => {
      test("test", () => {
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
    test("test", () => {
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
    test.skip("test", () => {
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
    test.todo("todo")
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
    describe("describe", () => {
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
    describe("describe", () => {
      before_all(() => {
        error("error")
      })
      test("test", () => {
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
    describe("describe", () => {
      after_all(() => {
        error("error")
      })
      test("test", () => {
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
  test("foo", () => {
    // noop
  })
  runTestSync()
  const report = mockTestState.report
  assertNotNil(report)
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
  test("bar", () => {
    actions.push("no")
  })
  test("a foo test", () => {
    actions.push("yes1")
  })
  describe("foo", () => {
    test("yes", () => {
      actions.push("yes2")
    })
  })
  runTestSync()
  assertDeepEquals(["yes1", "yes2"], actions)
})

describe("tags", () => {
  test("Can add tag to describe block", () => {
    tags("foo", "bar")
    describe("block", () => {
      // noop
    })
    const result = runTestSync<DescribeBlock>()
    assertDeepEquals(util.list_to_map(["foo", "bar"]), result.tags)
  })

  test("Can add tag to test", () => {
    tags("foo", "bar")
    test("Some test", () => 0)
    test("Some other test", () => 0)
    const result = runTestSync()
    assertDeepEquals(util.list_to_map(["foo", "bar"]), result.tags)
    assertDeepEquals([], mockTestState.suite.rootBlock.children[1]!.tags)
  })

  test("Lonely tag call is error", () => {
    describe("", () => {
      tags("foo", "bar")
    })
    const block = runTestSync<DescribeBlock>()
    assertNotDeepEquals([], block.errors)
  })

  test("double tag call is error", () => {
    tags("foo", "bar")
    tags("foo", "bar")
    test("some test", () => 0)
    runTestSync()
    assertNotDeepEquals([], mockTestState.suite.rootBlock.errors)
  })

  test("automatic after_reload_mods tag", () => {
    tags("tag1")
    test("foo", () => 0).after_reload_mods(() => 0)
    skipRun()
    assertDeepEquals(util.list_to_map(["tag1", "after_reload_mods"]), getFirst().tags)
  })

  test("automatic after_reload_script tag", () => {
    tags("tag1")
    test("foo", () => 0).after_reload_script(() => 0)
    skipRun()
    assertDeepEquals(util.list_to_map(["tag1", "after_reload_script"]), getFirst().tags)
  })

  test("tag whitelist", () => {
    tags("yes")
    test("", () => {
      actions.push("yes1")
    })

    tags("yes")
    describe("", () => {
      test("", () => {
        actions.push("yes2")
      })
    })

    tags("no")
    test("", () => {
      actions.push("no")
    })
    setMockConfig(fillConfig({ tag_whitelist: ["yes"] }))
    runTestSync()
    assertDeepEquals(["yes1", "yes2"], actions)
  })

  test("tag blacklist", () => {
    tags("yes")
    test("", () => {
      actions.push("yes")
    })

    tags("no")
    describe("", () => {
      test("", () => {
        actions.push("no")
      })
    })

    tags("no")
    test("Goodbye", () => {
      actions.push("no")
    })

    setMockConfig(fillConfig({ tag_blacklist: ["no"] }))
    runTestSync()
    assertDeepEquals(["yes"], actions)
  })

  test("tag whitelist and blacklist", () => {
    tags("yes")
    test("Hello", () => {
      actions.push("yes")
    })

    tags("yes", "no")
    test("Hello", () => {
      actions.push("no")
    })

    tags("no")
    test("Goodbye", () => {
      actions.push("no")
    })

    tags("yes")
    describe("", () => {
      tags("no")
      test("", () => {
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
    test("foo", () => {
      actions.push("foo")
    })
    runTestSync()
    assertDeepEquals(["foo"], actions)
    runTestSync()
    assertDeepEquals(["foo", "foo"], actions)
  })

  test("rerun resets test results", () => {
    test("foo", () => {
      // noop
    })
    runTestSync()
    assertEqual(1, mockTestState.report!.results.passed)
    runTestSync()
    assertEqual(1, mockTestState.report!.results.passed)
  })

  test("rerun after a cancelled run resets the run state", () => {
    test("1", () => {
      actions.push("1")
    })
    ticks_between_tests(2)
    test("2", () => {
      actions.push("2")
    })
    runTestAsyncWithRunner(
      (runner, tickNumber) => {
        if (tickNumber === 2) runner.requestCancel()
      },
      () => {
        assertDeepEquals(["1"], actions, "cancelled before test 2 ran")
        actions = []

        const runner = createTestRunner(mockTestState)
        for (let i = 0; i < 10 && !runner.isDone(); i++) runner.tick()
        assertTrue(runner.isDone(), "rerun must not inherit the cancel request")
        assertDeepEquals(["1", "2"], actions)
      },
    )
  })

  test("rerun blacklists tests with no_rerun tag", () => {
    test("run both", () => {
      actions.push("run both")
    })
    tags("no_rerun")
    test("run one", () => {
      actions.push("run one")
    })
    tags("no")
    test("run never", () => {
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
    before_all(() => actions.push(prefix + "beforeAll"))
    after_all(() => actions.push(prefix + "afterAll"))
    before_each(() => actions.push(prefix + "beforeEach"))
    after_each(() => actions.push(prefix + "afterEach"))
  }

  function assertLastEvents(expected: TestEvent["type"][]) {
    const types = events.map((x) => x.type)
    assertDeepEquals(expected, types.slice(types.length - expected.length))
  }

  test("cancel during a test runs after hooks up the tree", () => {
    setupHooks("root ")
    describe("block", () => {
      setupHooks("block ")
      test("async test", () => {
        after_test(() => actions.push("afterTest"))
        actions.push("test")
        async(100)
        on_tick(() => {
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
        assertEqual("cancelled", mockTestState.report!.results.status)
      },
    )
  })

  test("cancel between tests", () => {
    setupHooks("root ")
    test("1", () => actions.push("1"))
    ticks_between_tests(2)
    test("2", () => actions.push("2"))
    runTestAsyncWithRunner(
      (runner, tickNumber) => {
        if (tickNumber === 2) runner.requestCancel()
      },
      () => {
        assertDeepEquals(["root beforeAll", "root beforeEach", "1", "root afterEach", "root afterAll"], actions)
        assertLastEvents(["describeBlockFinished", "testRunCancelled"])
        assertEqual("cancelled", mockTestState.report!.results.status)
      },
    )
  })

  test("bail finishes the run instead of cancelling it", () => {
    setMockConfig(fillConfig({ bail: 1 }))
    after_all(() => actions.push("afterAll"))
    test("fail", () => {
      actions.push("fail")
      error("oh no")
    })
    test("not run", () => actions.push("not run"))
    runTestAsync(() => {
      assertDeepEquals(["fail", "afterAll"], actions)
      assertTrue(mockTestState.report!.bailedOut)
      assertLastEvents(["describeBlockFinished", "testRunFinished"])
      assertEqual("failed", mockTestState.report!.results.status)
    })
  })

  test("cancel does not run after_all for a block whose before_all never ran", () => {
    setMockConfig(fillConfig({ bail: 1 }))
    test("fail", () => {
      error("oh no")
    })
    describe("no active tests", () => {
      before_all(() => actions.push("beforeAll"))
      after_all(() => actions.push("afterAll"))
      test.skip("x", () => {})
    })
    runTestAsync(() => {
      assertDeepEquals([], actions)
    })
  })
})

describe("after_test", () => {
  test("simple", () => {
    test("foo", () => {
      after_test(() => {
        actions.push("after_foo")
      })
      actions.push("foo")
    })
    runTestSync()
    assertDeepEquals(["foo", "after_foo"], actions)
  })

  test("registered in an earlier part still runs", () => {
    // the error skips the remaining parts, so no reload actually happens
    test("foo", () => {
      after_test(() => {
        actions.push("after_foo")
      })
      error("oh no")
    }).after_reload_mods(() => {
      actions.push("continuation")
    })
    runTestSync()
    assertDeepEquals(["after_foo"], actions)
  })

  test("called even if test failed", () => {
    test("foo", () => {
      after_test(() => {
        actions.push("after_foo")
      })
      error("oh no")
    })
    runTestSync()
    assertDeepEquals(["after_foo"], actions)
  })

  test("called in async", () => {
    test("foo", () => {
      after_test(() => {
        actions.push("after_foo")
      })
      async(2)
      on_tick(() => {
        actions.push("foo")
      })
    })
    runTestAsync(() => {
      assertDeepEquals(["foo", "foo", "after_foo"], actions)
    })
  })

  test("called in order", () => {
    test("foo", () => {
      after_test(() => {
        actions.push("after_foo")
      })
      after_test(() => {
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

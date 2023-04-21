import * as util from "util"
import { TestStage } from "../../constants"
import { fillConfig } from "../config"
import { resultCollector } from "../results"
import { createTestRunner } from "../runner"
import { _setTestState, getTestState, resetTestState, TestState } from "../state"
import { TestEvent } from "../test-events"
import { DescribeBlock, Test } from "../tests"
import { propagateTestMode } from "../setup-globals"

// simulated test environment
let actions: unknown[] = []
let events: TestEvent[] = []
let mockTestState: TestState
let originalTestState: TestState

before_each(() => {
  actions = []
  events = []
  originalTestState = getTestState()
  resetTestState(
    fillConfig({
      default_ticks_between_tests: 0,
    }),
  )
  mockTestState = getTestState()

  let testStage = TestStage.NotRun
  mockTestState.getTestStage = () => testStage
  mockTestState.setTestStage = (state) => {
    testStage = state
  }
  mockTestState.raiseTestEvent = (event) => {
    events.push(event)
    resultCollector(event, mockTestState)
  }
})

after_each(() => {
  _setTestState(originalTestState)
  const testStage = mockTestState.getTestStage()
  if (mockTestState.rootBlock.children.length > 0 && testStage === TestStage.NotRun) {
    error("Simulated test defined but not run")
  }
})

function getFirst<T extends Test | DescribeBlock = Test>(): T {
  return mockTestState.rootBlock.children[0] as T
}

function runTestSync<T extends Test | DescribeBlock = Test>(): T {
  propagateTestMode(mockTestState, mockTestState.rootBlock, undefined)
  const runner = createTestRunner(mockTestState)
  runner.tick()
  if (!runner.isDone()) {
    error("Tests not completed in one tick")
  }
  return getFirst()
}

function runTestAsync<T extends Test | DescribeBlock = Test>(callback: (item: T) => void): void {
  propagateTestMode(mockTestState, mockTestState.rootBlock, undefined)
  if (mockTestState.getTestStage() !== TestStage.NotRun) {
    error("duplicate call to runTestAsync/cannot re-run mock test async")
  }
  const runner = createTestRunner(mockTestState)
  _setTestState(originalTestState)
  async()
  on_tick(() => {
    runner.tick()
    if (runner.isDone()) {
      callback(getFirst())
      _setTestState(originalTestState)
      done()
    }
  })
  _setTestState(mockTestState)
}

function skipRun() {
  mockTestState.setTestStage(TestStage.Finished)
}

describe("setup", () => {
  test("a test", () => {
    test("Hello", () => {
      // noop
    })
    const result = runTestSync()
    assert.not_nil(result)
    assert.equal("Hello", result.name)
    assert.matches("Hello", result.path)
    assert.same(mockTestState.rootBlock, result.parent)
    assert.equal(0, result.indexInParent)
    assert.same([], result.errors)
  })

  test("a describe block", () => {
    describe("Block", () => {
      test("Hello", () => {
        // noop
      })
    })
    const result = runTestSync<DescribeBlock>()
    assert.not_nil(result)
    assert.equal("Block", result.name)
    assert.matches("Block", result.path)
    assert.same(mockTestState.rootBlock, result.parent)
    assert.equal(0, result.indexInParent)

    assert.equal(1, result.children.length)
    const child = result.children[0]!
    assert.same(result, child.parent)
    assert.matches("Block > Hello", child.path)
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
    assert.same([1, 2], actions)
  })

  test("cannot nest tests", () => {
    test("Some test", () => {
      test("Nested", () => {
        // noop
      })
    })
    const errors = runTestSync().errors
    assert.are_equal(1, errors.length)
    assert.matches("cannot be nested", errors[0])
  })

  test("cannot nest describe in test", () => {
    test("Some test", () => {
      describe("Nested", () => {
        // noop
      })
    })
    const errors = runTestSync().errors
    assert.are_equal(1, errors.length)
    assert.matches("cannot be nested", errors[0])
  })

  test("empty describe is error", () => {
    describe("empty", () => {
      // nothing
    })
    const block = runTestSync<DescribeBlock>()
    assert.not_same([], block.errors)
  })

  test("Failing describe does not report empty describe", () => {
    describe("empty", () => {
      error("fail")
    })
    const block = runTestSync<DescribeBlock>()
    assert.not_same([], block.errors)
    assert.same(1, block.errors.length)
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
    assert.are.same(["beforeAll", "test", "afterAll"], actions)
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
    assert.are_same(["beforeEach", "test", "afterEach"], actions)
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
    assert.are_same(
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
    assert.are_equal(1, 1)
  }

  before_all(foo)
  before_each(foo)
  after_all(foo)
  after_each(foo)
  test("pass", foo)

  const result = runTestSync()
  assert.are_same([], result.errors)
  // assert.are_equal("passed", mockTestState.results.tests[0].result)
})

describe("failing tests", () => {
  // after_each(() => {
  //   assert.are_equal("failed", mockTestState.results.tests[0].result)
  // })

  const failMessage = "FAIL: 238472"

  function fail(this: void) {
    error(failMessage)
  }

  test("test", () => {
    test("fail", fail)
    const theTest = runTestSync()
    assert.are_equal(1, theTest.errors.length)
    assert.matches(failMessage, theTest.errors[0], undefined, true)
  })

  test("beforeEach", () => {
    before_each(fail)
    test("test", () => {
      error("Should not run")
    })
    const theTest = runTestSync()
    assert.are_equal(1, theTest.errors.length)
    assert.matches(failMessage, theTest.errors[0], undefined, true)
  })

  test("beforeAll", () => {
    before_all(fail)
    test("test", () => {
      error("Should not run")
    })
    const theTest = runTestSync()
    assert.are_same([], theTest.errors)
    assert.matches(failMessage, mockTestState.rootBlock.errors[0], undefined, true)
  })

  test("afterEach", () => {
    after_each(fail)
    test("test", () => {
      error("first error")
    })
    const theTest = runTestSync()
    assert.are_equal(2, theTest.errors.length)
    assert.matches(failMessage, theTest.errors[1], undefined, true)
  })

  test("afterAll", () => {
    after_all(fail)
    test("test", () => {
      error("first error")
    })
    const theTest = runTestSync()
    assert.are_equal(1, theTest.errors.length)
    assert.matches(failMessage, mockTestState.rootBlock.errors[0], undefined, true)
  })

  test("failure in describe definition", () => {
    describe("foo", () => {
      test("foo", () => {
        error("should not run")
      })

      error("fail")
    })
    const block = runTestSync<DescribeBlock>()
    assert.not_same([], block.errors)
    assert.same([], block.children[0]!.errors)
  })

  test("Error stacktrace is clean", () => {
    test("foo", () => {
      error("oh no")
    })
    const t = runTestSync()
    assert.equals(1, t.errors.length)
    // 2 stack frames: the test function, error()
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
    // assert.are_equal("skipped", mockTestState.results.tests[0].result)
    assert.is_same([], first.errors)
    assert.same([], actions, "no actions should be taken on skipped test")
  })

  test("skipped describe", () => {
    setupActionHooks()
    describe.skip("skipped describe", () => {
      test("skipped test", () => {
        actions.push("run")
      })
    })
    const first = runTestSync<DescribeBlock>().children[0] as Test
    // assert.are_equal("skipped", mockTestState.results.tests[0].result)
    assert.is_same([], first.errors)
    assert.same([], actions, "no actions should be taken on skipped test")
  })

  test("todo", () => {
    setupActionHooks()
    test.todo("skipped test")
    const first = runTestSync()
    // assert.are_equal("todo", mockTestState.results.tests[0].result)
    assert.is_same([], first.errors)
  })

  it("only skips skipped tests", () => {
    test.skip("skipped test", () => {
      actions.push("no")
    })
    test("not skipped test", () => {
      actions.push("yes")
    })
    runTestSync()
    assert.same(["yes"], actions)
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
    assert.is_true(mockTestState.hasFocusedTests)
    assert.same(["yes"], actions)
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
    assert.is_true(mockTestState.hasFocusedTests)
    assert.same(["yes"], actions)
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
    assert.is_true(mockTestState.hasFocusedTests)
    assert.same(["yes"], actions)
  })

  test("shallow nested focus", () => {
    describe.only("should run", () => {
      test.only("", () => {
        actions.push("yes1")
      })
      test("", () => {
        actions.push("no2") // behavior changed since v1.5
      })
    })
    describe("should not run", () => {
      test("", () => {
        actions.push("no2")
      })
    })
    runTestSync()
    assert.same(["yes1"], actions)
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
    assert.is_false(mockTestState.hasFocusedTests, "should not have focused tests if skipped")
    assert.same(["yes"], actions)
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
    assert.same(["hello"], actions)
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
        assert.is_false(failedToTimeOut, "Test failed to time out.")
        assert.not_same([], test.errors)
        assert.equal(30, tick)
      })
    })

    it.each([0, -1])("does not accept invalid timeout", (value) => {
      test("Something", () => {
        async(value)
        done()
      })
      runTestAsync((test) => {
        assert.not_same([], test.errors)
      })
    })
  })

  test("async and done can only used during test", () => {
    // already in mock test env
    assert.error(async)
    assert.error(done)
  })

  test("done when not async fails", () => {
    test("should fail", () => {
      done()
    })
    assert.not_same([], runTestSync().errors)
  })

  test("double async does not fail", () => {
    test("test", () => {
      async()
      async()
      done()
    })
    assert.same([], runTestSync().errors)
  })

  test("double done does not fail", () => {
    test("test", () => {
      async()
      done()
      done()
    })
    runTestAsync((test) => {
      assert.same([], test.errors)
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
      assert.same([1, 2], actions)
    })
  })

  it("automatically sets async", () => {
    test("some thing", () => {
      on_tick((t) => {
        if (t === 10) done()
      })
    })
    runTestAsync((test) => {
      assert.same(test.errors, [])
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
      assert.same([], actions)
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
      assert.same(["tick"], actions)
      assert.equals(1, item.errors.length)
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
      assert.same([1, 2, 1, 2], actions)
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
      assert.same([1], actions)
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
      assert.same([1, 2], actions)
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
      assert.same([3, 4], actions)
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
      assert.equal(5, tick)
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
      assert.equal(4, tick)
    })
  })

  it("automatically sets async, and ends test when done", () => {
    test("an async", () => {
      after_ticks(2, () => {
        // do nothing
      })
    })
    runTestAsync((test) => {
      assert.same([], test.errors)
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
      assert.not_same([], test.errors)
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
      assert.not_same([], test.errors)
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
      assert.equals(2, tick2 - tick1)
      assert.equals(2, tick3 - tick2)
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
      assert.equals(2, tick2 - tick1)
      assert.equals(3, tick3 - tick2)
      assert.equals(2, tick4 - tick3)
      assert.equals(0, tick5 - tick4)
    })
  })

  it("does not wait for skipped tests", () => {
    test("1", () => 0)
    ticks_between_tests(2)
    test.skip("1", () => 0)
    runTestSync() // gives error if not run in 1 tick
  })

  it("does not accept negative value", () => {
    assert.error(() => {
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
    assert.same(values, actions)
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
    assert.same(values, actions)
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
    assert.same(values, actions)
    const titles = mockTestState.rootBlock.children.map((x) => x.name)
    assert.same(
      values.map((v) => string.format(title, ...v)),
      titles,
    )
  })

  test("object title format", () => {
    creator.each([{ prop: "value" }])("%s", () => {
      // nothing
    })
    const item = runTestSync()
    assert.equals('{prop = "value"}', item.name)
  })
})

describe("reload state", () => {
  function reloadAndTick(): void {
    const runner = createTestRunner(mockTestState)
    runner.tick()
  }

  // would also check for uninitialized, but that requires too deep a level of meta

  test("Reload state lifecycle", () => {
    test("", () => {
      // empty
    })
    ticks_between_tests(1)
    test("", () => {
      // empty
    })
    assert.equal(TestStage.NotRun, mockTestState.getTestStage())
    const runner = createTestRunner(mockTestState)
    runner.tick()
    assert.equal(TestStage.Running, mockTestState.getTestStage())
    runner.tick()
    assert.equal(TestStage.Finished, mockTestState.getTestStage())
  })

  test("Cannot reload while testing", () => {
    test("Test 1", () => {
      async()
    })
    reloadAndTick()
    assert.same([], mockTestState.rootBlock.errors)
    reloadAndTick()
    assert.not_same([], mockTestState.rootBlock.errors)
    assert.equal(TestStage.LoadError, mockTestState.getTestStage())
  })

  test("can reload after load error", () => {
    test("Test 1", () => {
      actions.push("test 1")
    })
    mockTestState.setTestStage(TestStage.LoadError)
    reloadAndTick()
    assert.same([], mockTestState.rootBlock.errors)
    assert.equal(TestStage.Finished, mockTestState.getTestStage())
    assert.same(["test 1"], actions)
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
      "describeBlockEntered", // root
      "describeBlockEntered",
      "testEntered",
      "testStarted",
      "testPassed",
      "describeBlockFinished",
      "describeBlockFinished",
      "testRunFinished",
    ]
    assert.same(
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
    assert.same(
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
    assert.same(
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
    assert.same(
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
    assert.same(
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
    assert.same(
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
    assert.same(
      expected,
      events.map((x) => x.type),
    )
  })
})

test("Test pattern", () => {
  mockTestState.config = fillConfig({
    test_pattern: "foo",
  })
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
  assert.are_same(["yes1", "yes2"], actions)
})

describe("tags", () => {
  test("Can add tag to describe block", () => {
    tags("foo", "bar")
    describe("block", () => {
      // noop
    })
    const result = runTestSync<DescribeBlock>()
    assert.same(util.list_to_map(["foo", "bar"]), result.tags)
  })

  test("Can add tag to test", () => {
    tags("foo", "bar")
    test("Some test", () => 0)
    test("Some other test", () => 0)
    const result = runTestSync()
    assert.same(util.list_to_map(["foo", "bar"]), result.tags)
    assert.same([], mockTestState.rootBlock.children[1]!.tags)
  })

  test("Lonely tag call is error", () => {
    describe("", () => {
      tags("foo", "bar")
    })
    const block = runTestSync<DescribeBlock>()
    assert.not_same([], block.errors)
  })

  test("double tag call is error", () => {
    tags("foo", "bar")
    tags("foo", "bar")
    test("some test", () => 0)
    runTestSync()
    assert.not_same([], mockTestState.rootBlock.errors)
  })

  test("automatic after_mod_reload tag", () => {
    tags("tag1")
    test("foo", () => 0).after_mod_reload(() => 0)
    skipRun()
    assert.same(util.list_to_map(["tag1", "after_mod_reload"]), getFirst().tags)
  })

  test("automatic after_script_reload tag", () => {
    tags("tag1")
    test("foo", () => 0).after_mod_reload(() => 0)
    skipRun()
    assert.same(util.list_to_map(["tag1", "after_mod_reload"]), getFirst().tags)
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
    mockTestState.config = fillConfig({ tag_whitelist: ["yes"] })
    runTestSync()
    assert.same(["yes1", "yes2"], actions)
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

    mockTestState.config = fillConfig({ tag_blacklist: ["no"] })
    runTestSync()
    assert.same(["yes"], actions)
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

    mockTestState.config = fillConfig({ tag_whitelist: ["yes"], tag_blacklist: ["no"] })
    runTestSync()
    assert.same(["yes"], actions)
  })
})

describe("rerun", () => {
  test("rerun", () => {
    test("foo", () => {
      actions.push("foo")
    })
    runTestSync()
    assert.same(["foo"], actions)
    assert.False(mockTestState.isRerun)
    runTestSync()
    assert.same(["foo", "foo"], actions)
    assert.True(mockTestState.isRerun)
  })

  test("rerun resets test results", () => {
    test("foo", () => {
      // noop
    })
    runTestSync()
    assert.same(1, mockTestState.results?.passed)
    runTestSync()
    assert.same(1, mockTestState.results?.passed)
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

    mockTestState.config = fillConfig({ tag_blacklist: ["no"] })

    runTestSync()
    assert.same(["run both", "run one"], actions)
    runTestSync()
    assert.same(["run both", "run one", "run both"], actions)
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
    assert.same(["foo", "after_foo"], actions)
  })

  test("called even if test failed", () => {
    test("foo", () => {
      after_test(() => {
        actions.push("after_foo")
      })
      error("oh no")
    })
    runTestSync()
    assert.same(["after_foo"], actions)
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
      assert.same(["foo", "foo", "after_foo"], actions)
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
    assert.same(["foo", "after_foo", "after_foo2"], actions)
  })
})

test("a test with a really, really, incredibly long name such that it might extend pass the length of the output window, and this text needs to be even longer for that to happen", () => {
  assert.True(true)
})

import { addDescribeBlock, addTest, DescribeBlock, HookType, Source, Test, TestMode } from "./tests"
import { prepareReload } from "./resume"
import { getCurrentBlock, getCurrentTestRun, getTestState } from "./state"
import HookFn = Testorio.HookFn
import TestFn = Testorio.TestFn
import TestBuilder = Testorio.TestBuilder
import TestCreatorBase = Testorio.TestCreatorBase
import DescribeCreatorBase = Testorio.DescribeCreatorBase
import TestCreator = Testorio.TestCreator
import DescribeCreator = Testorio.DescribeCreator

function getCallerSource(upStack: number = 1): Source {
  const info = debug.getinfo(upStack + 2, "Sl") || {}
  return {
    file: info.source,
    line: info.currentline,
  }
}
function addHook(type: HookType, func: HookFn): void {
  const state = getTestState()
  if (state.currentTestRun) {
    error(`Hook (${type}) cannot be nested inside test "${state.currentTestRun.test.path}"`)
  }
  getCurrentBlock().hooks.push({
    type,
    func,
  })
}
function createTest(name: string, func: TestFn, mode: TestMode, upStack: number = 1): Test {
  const state = getTestState()
  if (state.currentTestRun) {
    error(`Test "${name}" cannot be nested inside test "${state.currentTestRun.test.path}"`)
  }
  const currentBlock = getCurrentBlock()
  if (currentBlock.mode === "skip" && mode !== "todo") {
    mode = "skip"
  }
  if (mode === "only") {
    state.hasFocusedTests = true
  }
  return addTest(currentBlock, name, getCallerSource(upStack + 1), func, mode)
}
// eslint-disable-next-line @typescript-eslint/ban-types
function addNext(test: Test, func: TestFn, funcForSource: Function = func) {
  const info = debug.getinfo(funcForSource, "Sl")
  const source: Source = {
    file: info.source,
    line: info.linedefined,
  }
  test.parts.push({
    func,
    source,
  })
}
function createTestBuilder<F extends () => void>(addPart: (func: F) => void) {
  function reloadFunc(reload: () => void, what: string) {
    return (func: F) => {
      addPart((() => {
        async(1)
        game.print(`${getCurrentTestRun().test.path}:\nReloading ${what} for test`)
        on_tick(() => {
          prepareReload(getTestState())
          reload()
        })
      }) as F)
      addPart(func)
      return result
    }
  }

  const result: TestBuilder<F> = {
    after_script_reload: reloadFunc(() => game.reload_script(), "script"),
    after_mod_reload: reloadFunc(() => game.reload_mods(), "mods"),
  }
  return result
}
function propagateFocus(block: DescribeBlock) {
  if (block.mode === "only" && block.children.every((child) => child.mode !== "only")) {
    for (const child of block.children) {
      if (child.mode !== undefined) continue
      child.mode = "only"
      if (child.type === "describeBlock") {
        propagateFocus(block)
      }
    }
  }
}
function createDescribe(name: string, block: TestFn, mode: TestMode, upStack: number = 1): DescribeBlock | undefined {
  const state = getTestState()
  if (state.currentTestRun) {
    error(`Describe block "${name}" cannot be nested inside test "${state.currentTestRun.test.path}"`)
  }

  const source = getCallerSource(upStack + 1)

  const previousBlock = getCurrentBlock()
  if (previousBlock.mode === "skip") {
    mode = "skip"
  }
  if (mode === "only") {
    state.hasFocusedTests = true
  }

  const describeBlock = addDescribeBlock(previousBlock, name, source, mode)
  state.currentBlock = describeBlock
  block()
  state.currentBlock = previousBlock
  propagateFocus(describeBlock)
  return describeBlock
}
function setCall<T extends object, F extends (...args: any) => any>(obj: T, func: F): T & F {
  return setmetatable(obj, {
    __call(...args: any[]) {
      return func(...args)
    },
  })
}
function createEachItems(
  values: unknown[][],
  name: string,
): {
  name: string
  row: unknown[]
}[] {
  if (values.length === 0) error(".each called with no data")
  if (!values.every((v) => Array.isArray(v))) {
    values = (values as unknown[]).map((v) => [v])
  }
  return values.map((row) => {
    const rowValues = (row as unknown[]).map((v) => (typeof v === "object" ? serpent.line(v) : v))
    const itemName = string.format(name, ...rowValues)

    return {
      name: itemName,
      row,
    }
  })
}
function createTestEach(mode: TestMode): TestCreatorBase {
  const eachFn: TestCreatorBase["each"] = (values: unknown[][], name: string, func: (...values: any[]) => void) => {
    const items = createEachItems(values, name)
    const testBuilders = items.map(({ row, name }) => {
      const test = createTest(
        name,
        () => {
          func(...row)
        },
        mode,
        2,
      )
      return { test, row }
    })
    return createTestBuilder<(...args: unknown[]) => void>((func) => {
      for (const { test, row } of testBuilders) {
        addNext(
          test,
          () => {
            func(...row)
          },
          func,
        )
      }
    })
  }
  return setCall(
    {
      each: eachFn,
    },
    (name, func) => {
      const test = createTest(name, func, mode)
      return createTestBuilder((func1) => addNext(test, func1))
    },
  )
}
function createDescribeEach(mode: TestMode): DescribeCreatorBase {
  const eachFn: DescribeCreatorBase["each"] = (values: unknown[][], name: string, func: (...values: any[]) => void) => {
    const items = createEachItems(values, name)
    for (const { row, name } of items) {
      createDescribe(
        name,
        () => {
          func(...row)
        },
        mode,
        2,
      )
    }
  }
  return setCall(
    {
      each: eachFn,
    },
    (name, func) => createDescribe(name, func, mode),
  )
}
const DEFAULT_TIMEOUT = 60 * 60
export const test = createTestEach(undefined) as TestCreator
test.skip = createTestEach("skip")
test.only = createTestEach("only")
test.todo = (name: string) => {
  createTest(
    name,
    () => {
      //noop
    },
    "todo",
  )
}
export const it = test
export const describe = createDescribeEach(undefined) as DescribeCreator
describe.skip = createDescribeEach("skip")
describe.only = createDescribeEach("only")
type Globals =
  | HookType
  | "async"
  | "done"
  | "on_tick"
  | "after_ticks"
  | "ticks_between_tests"
  | "test"
  | "it"
  | "describe"
  | "part"
type GlobalsObj = {
  [P in Globals]: typeof globalThis[P]
}
export const globals: GlobalsObj = {
  test,
  it: test,
  describe,

  beforeAll(func) {
    addHook("beforeAll", func)
  },

  afterAll(func) {
    addHook("afterAll", func)
  },

  beforeEach(func) {
    addHook("beforeEach", func)
  },

  afterEach(func) {
    addHook("afterEach", func)
  },

  afterTest(func) {
    getCurrentTestRun().test.afterTest.push(func)
  },

  async(timeout = DEFAULT_TIMEOUT) {
    const testRun = getCurrentTestRun()
    if (testRun.async) {
      error("test is already async")
    }
    if (timeout < 1) {
      error("test timeout must be greater than 0")
    }
    testRun.timeout = timeout
    testRun.async = true
  },

  done() {
    const testRun = getCurrentTestRun()

    if (!testRun.async) {
      error(`"done" can only be used when test is async`)
    }
    if (testRun.asyncDone) {
      error(`async test is already marked as done`)
    }
    testRun.asyncDone = true
  },

  on_tick(func) {
    const testRun = getCurrentTestRun()
    if (!testRun.async) {
      error("on_tick can only be used in async tests")
    }
    testRun.onTickFuncs.set(func, true)
  },

  after_ticks(ticks, func) {
    const testRun = getCurrentTestRun()
    const finishTick = game.tick - testRun.tickStarted + ticks
    if (ticks < 1) {
      error("after_ticks amount must be positive")
    }
    on_tick((tick) => {
      if (tick >= finishTick) {
        func()
        return false
      }
    })
  },
  ticks_between_tests(ticks) {
    if (ticks < 0) {
      error("ticks between tests must be 0 or greater")
    }
    getCurrentBlock().ticksBetweenTests = ticks
  },
  part(func) {
    const { test, partIndex } = getCurrentTestRun()
    const source = getCallerSource()
    table.insert(test.parts, partIndex + 2, {
      func,
      source,
    })
  },
}
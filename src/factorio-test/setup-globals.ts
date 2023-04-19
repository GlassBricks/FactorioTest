// noinspection JSUnusedGlobalSymbols

import * as util from "util"
import { prepareReload } from "./reload-resume"
import { getCurrentBlock, getTestState, TestRun, TestState } from "./state"
import {
  addDescribeBlock,
  addTest,
  createSource,
  DescribeBlock,
  HookType,
  Source,
  Test,
  TestMode,
  TestTags,
} from "./tests"
import { __factorio_test__pcallWithStacktrace } from "./_util"
import DescribeCreator = FactorioTest.DescribeCreator
import DescribeCreatorBase = FactorioTest.DescribeBlockCreatorBase
import HookFn = FactorioTest.HookFn
import TestBuilder = FactorioTest.TestBuilder
import TestCreator = FactorioTest.TestCreator
import TestCreatorBase = FactorioTest.TestCreatorBase
import TestFn = FactorioTest.TestFn

function getCallerSource(upStack: number = 1): Source {
  const info = debug.getinfo(upStack + 2, "Sl") || {}
  return createSource(info.source, info.currentline)
}

export function getCurrentTestRun(): TestRun {
  return getTestState().currentTestRun ?? error("This can only be called within a test")
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

function afterTest(func: TestFn): void {
  getCurrentTestRun().afterTestFuncs.push(func)
}

function consumeTags(): TestTags {
  const state = getTestState()
  const result = state.currentTags
  state.currentTags = undefined
  return result ?? new LuaSet()
}

function createTest(name: string, func: TestFn, mode: TestMode, upStack: number = 1): Test {
  const state = getTestState()
  if (state.currentTestRun) {
    error(`Test "${name}" cannot be nested inside test "${state.currentTestRun.test.path}"`)
  }
  const parent = getCurrentBlock()
  return addTest(parent, name, getCallerSource(upStack + 1), func, mode, util.merge([consumeTags(), parent.tags]))
}

// eslint-disable-next-line @typescript-eslint/ban-types
function addPart(test: Test, func: TestFn, funcForSource: Function = func) {
  const info = debug.getinfo(funcForSource, "Sl")
  const source = createSource(info.source, info.linedefined)
  test.parts.push({ func, source })
}

function createTestBuilder<F extends () => void>(addPart: (func: F) => void, addTag: (tag: string) => void) {
  function reloadFunc(reload: () => void, what: string, tag: string) {
    return (func: F) => {
      addPart((() => {
        async(1)
        prepareReload(getTestState())
        reload()
      }) as F)
      addPart(func)
      addTag(tag)
      return result
    }
  }

  const result: TestBuilder<F> = {
    after_script_reload: reloadFunc(() => game.reload_script(), "script", "after_script_reload"),
    after_mod_reload: reloadFunc(() => game.reload_mods(), "mods", "after_mod_reload"),
  }
  return result
}

function skipAllChildren(block: DescribeBlock): void {
  for (const child of block.children) {
    child.mode = "skip"
    if (child.declaredMode !== "skip") {
      if (child.type === "describeBlock") {
        skipAllChildren(child)
      }
    }
  }
}
function focusAllChildren(block: DescribeBlock): void {
  for (const child of block.children) {
    if (child.declaredMode === undefined) {
      child.mode = "only"
      if (child.type === "describeBlock") {
        focusAllChildren(child)
      }
    } else {
      child.mode = child.declaredMode
    }
  }
}
function markFocusedTests(state: TestState, block: DescribeBlock): void {
  for (const child of block.children) {
    if (child.declaredMode === "only") {
      state.hasFocusedTests = true
    }
  }
}

export function propagateTestMode(state: TestState, describeBlock: DescribeBlock, mode: TestMode) {
  if (mode === "skip") {
    skipAllChildren(describeBlock)
  } else if (mode === "only") {
    state.hasFocusedTests = true
    if (!describeBlock.children.some((child) => child.mode === "only")) {
      // nested only; ignore outer only
      focusAllChildren(describeBlock)
    } else {
      markFocusedTests(state, describeBlock)
    }
  } else {
    markFocusedTests(state, describeBlock)
  }
}

function createDescribe(name: string, block: TestFn, mode: TestMode, upStack: number = 1): DescribeBlock | undefined {
  const state = getTestState()
  if (state.currentTestRun) {
    error(`Describe block "${name}" cannot be nested inside test "${state.currentTestRun.test.path}"`)
  }

  const source = getCallerSource(upStack + 1)

  const parent = getCurrentBlock()
  const describeBlock = addDescribeBlock(parent, name, source, mode, util.merge([parent.tags, consumeTags()]))
  state.currentBlock = describeBlock
  const [success, msg] = __factorio_test__pcallWithStacktrace(block)
  if (!success) {
    describeBlock.errors.push(`Error in definition: ${msg}`)
  }
  propagateTestMode(state, describeBlock, mode)

  state.currentBlock = parent
  if (state.currentTags) {
    describeBlock.errors.push(`Tags not added to any test or describe block: ${serpent.line(state.currentTags)}`)
    state.currentTags = undefined
  }
  return describeBlock
}

function createEachItems(
  values: unknown[],
  name: string,
): {
  name: string
  row: unknown[]
}[] {
  if (values.length === 0) error(".each called with no data")

  const valuesAsRows: unknown[][] = values.every((v): v is any[] => Array.isArray(v)) ? values : values.map((v) => [v])
  return valuesAsRows.map((row) => {
    const rowValues = row.map((v) => (typeof v === "object" ? serpent.line(v) : v))
    const itemName = string.format(name, ...rowValues)

    return {
      name: itemName,
      row,
    }
  })
}

function createTestEach(mode: TestMode): TestCreatorBase {
  const result: TestCreatorBase = (name, func) => {
    const test = createTest(name, func, mode)
    return createTestBuilder(
      (func1) => addPart(test, func1),
      (tag) => test.tags.add(tag),
    )
  }

  result.each = (values: unknown[]) => (name: string, func: (...values: any[]) => void) => {
    const items = createEachItems(values, name)
    const testBuilders = items.map((item) => {
      const test = createTest(item.name, () => func(...item.row), mode, 3)
      return { test, row: item.row }
    })
    return createTestBuilder<(...args: unknown[]) => void>(
      (func) => {
        for (const { test, row } of testBuilders) {
          addPart(
            test,
            () => {
              func(...row)
            },
            func,
          )
        }
      },
      (tag) => {
        for (const { test } of testBuilders) {
          test.tags.add(tag)
        }
      },
    )
  }

  return result
}
function createDescribeEach(mode: TestMode): DescribeCreatorBase {
  const result: DescribeCreatorBase = (name, func) => createDescribe(name, func, mode)
  result.each = (values: unknown[]) => (name: string, func: (...values: any[]) => void) => {
    const items = createEachItems(values, name)
    for (const { row, name } of items) {
      createDescribe(name, () => func(...row), mode, 2)
    }
  }
  return result
}

const test = createTestEach(undefined) as TestCreator
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
const describe = createDescribeEach(undefined) as DescribeCreator
describe.skip = createDescribeEach("skip")
describe.only = createDescribeEach("only")

function tags(...tags: string[]) {
  const block = getCurrentBlock()
  const state = getTestState()
  if (state.currentTags) {
    block.errors.push(`Double call to tags()`)
  }
  state.currentTags = util.list_to_map(tags)
}

type SetupGlobals =
  | `${"before" | "after"}_${"each" | "all"}`
  | "after_test"
  | "async"
  | "done"
  | "on_tick"
  | "after_ticks"
  | "ticks_between_tests"
  | "test"
  | "it"
  | "describe"
  | "tags"

function implicitAsync() {
  const testRun = getCurrentTestRun()
  testRun.async = true
  if (!testRun.explicitAsync) {
    testRun.timeout = getTestState().config.default_timeout
  }
}

function async(timeout?: number) {
  const testRun = getCurrentTestRun()
  testRun.async = true
  testRun.explicitAsync = true

  if (!timeout) {
    timeout = getTestState().config.default_timeout
  }
  if (timeout < 1) error("test timeout must be greater than 0")

  testRun.timeout = timeout
  testRun.async = true
}

export const globals: Pick<typeof globalThis, SetupGlobals> = {
  test,
  it: test,
  describe,
  tags,

  before_all(func) {
    addHook("beforeAll", func)
  },
  after_all(func) {
    addHook("afterAll", func)
  },
  before_each(func) {
    addHook("beforeEach", func)
  },
  after_each(func) {
    addHook("afterEach", func)
  },
  after_test(func) {
    afterTest(func)
  },

  async,
  done() {
    const testRun = getCurrentTestRun()

    if (!testRun.async) error(`"done" can only be used when test is async`)
    testRun.asyncDone = true
  },
  on_tick(func) {
    implicitAsync()
    const testRun = getCurrentTestRun()
    testRun.onTickFuncs.add(func)
  },
  after_ticks(ticks, func) {
    implicitAsync()
    const testRun = getCurrentTestRun()
    const finishTick = game.tick - testRun.tickStarted + ticks
    if (ticks < 1) error("after_ticks amount must be positive")
    on_tick((tick) => {
      if (tick >= finishTick) {
        func()
        return false
      }
    })
  },
  ticks_between_tests(ticks) {
    if (ticks < 0) error("ticks between tests must be 0 or greater")
    getCurrentBlock().ticksBetweenTests = ticks
  },
}

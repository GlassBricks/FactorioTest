// noinspection JSUnusedGlobalSymbols

import * as util from "util"
import { consumeTags, getDefinitionState } from "./definition"
import { createEachItems } from "./each-format"
import { __factorio_test__pcallWithStacktrace } from "./pcall-with-stacktrace"
import { prepareReload } from "./reload-resume"
import { getTestState, PartRun, TestRun } from "./state"
import { propagateTestMode } from "./test-mode"
import { addDescribeBlock, addTest, createSource, DescribeBlock, HookType, Source, Test, TestMode } from "./tests"
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
  getDefinitionState().currentBlock.hooks.push({
    type,
    func,
  })
}

function afterTest(func: TestFn): void {
  getCurrentTestRun().afterTestFuncs.push(func)
}

function createTest(name: string, func: TestFn, mode: TestMode, upStack: number = 1): Test {
  const parent = getDefinitionState().currentBlock
  return addTest(parent, name, getCallerSource(upStack + 1), func, mode, util.merge([consumeTags(), parent.tags]))
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
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
    after_reload_script: reloadFunc(() => game.reload_script(), "script", "after_reload_script"),
    after_reload_mods: reloadFunc(() => game.reload_mods(), "mods", "after_reload_mods"),
  }
  return result
}

function createDescribe(name: string, block: TestFn, mode: TestMode, upStack: number = 1): DescribeBlock {
  const definition = getDefinitionState()
  const source = getCallerSource(upStack + 1)

  const parent = definition.currentBlock
  const describeBlock = addDescribeBlock(parent, name, source, mode, util.merge([parent.tags, consumeTags()]))
  definition.currentBlock = describeBlock
  const [success, msg] = __factorio_test__pcallWithStacktrace(block)
  if (!success) {
    describeBlock.errors.push(`Error in definition: ${msg}`)
  }
  propagateTestMode(definition, describeBlock, mode)

  definition.currentBlock = parent
  if (definition.currentTags) {
    describeBlock.errors.push(`Tags not added to any test or describe block: ${serpent.line(definition.currentTags)}`)
    definition.currentTags = undefined
  }
  return describeBlock
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
  const result: DescribeCreatorBase = (name, func) => {
    // avoid tail call, messes up stack trace
    // noinspection UnnecessaryLocalVariableJS
    const block: DescribeBlock = createDescribe(name, func, mode)
    return block
  }
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
  const definition = getDefinitionState()
  if (definition.currentTags) {
    definition.currentBlock.errors.push(`Double call to tags()`)
  }
  definition.currentTags = util.list_to_map(tags)
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

function getCurrentPart(): PartRun {
  return getCurrentTestRun().part
}

function implicitAsync() {
  const part = getCurrentPart()
  part.async = true
  if (!part.explicitAsync) {
    part.timeout = getTestState().config.default_timeout
  }
}

function async(timeout?: number) {
  const part = getCurrentPart()
  part.async = true
  part.explicitAsync = true

  if (!timeout) {
    timeout = getTestState().config.default_timeout
  }
  if (timeout < 1) error("test timeout must be greater than 0")

  part.timeout = timeout
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
    const part = getCurrentPart()

    if (!part.async) error(`"done" can only be used when test is async`)
    part.asyncDone = true
  },
  on_tick(func) {
    implicitAsync()
    getCurrentPart().onTickFuncs.add(func)
  },
  after_ticks(ticks, func) {
    implicitAsync()
    const finishTick = game.tick - getCurrentPart().tickStarted + ticks
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
    getDefinitionState().currentBlock.ticksBetweenTests = ticks
  },
}

// noinspection JSUnusedGlobalSymbols

import * as util from "util"
import { createEachItems } from "./each-format"
import { __factorio_test__pcallWithStacktrace } from "./pcall-with-stacktrace"
import { consumeTags, PartRun, TestContext, TestRun } from "./state"
import { propagateTestMode } from "./test-mode"
import {
  addDescribeBlock,
  addTest,
  createSource,
  DescribeBlock,
  HookType,
  ReloadKind,
  Source,
  Test,
  TestMode,
} from "./tests"
import DescribeCreator = FactorioTest.DescribeCreator
import DescribeCreatorBase = FactorioTest.DescribeBlockCreatorBase
import HookFn = FactorioTest.HookFn
import OnTickFn = FactorioTest.OnTickFn
import TestBuilder = FactorioTest.TestBuilder
import TestCreator = FactorioTest.TestCreator
import TestCreatorBase = FactorioTest.TestCreatorBase
import TestFn = FactorioTest.TestFn

function getCallerSource(upStack: number = 1): Source {
  const info = debug.getinfo(upStack + 2, "Sl") || {}
  return createSource(info.source, info.currentline)
}

function getCurrentTestRun(context: TestContext): TestRun {
  return context.testState().currentTestRun ?? error("This can only be called within a test")
}

function addHook(context: TestContext, type: HookType, func: HookFn): void {
  context.definition().currentBlock.hooks.push({
    type,
    func,
  })
}

function afterTest(context: TestContext, func: TestFn): void {
  getCurrentTestRun(context).afterTestFuncs.push(func)
}

function createTest(context: TestContext, name: string, func: TestFn, mode: TestMode, upStack: number = 1): Test {
  const definition = context.definition()
  const parent = definition.currentBlock
  return addTest(
    parent,
    name,
    getCallerSource(upStack + 1),
    func,
    mode,
    util.merge([consumeTags(definition), parent.tags]),
  )
}

// eslint-disable-next-line @typescript-eslint/no-unsafe-function-type
function addPart(test: Test, func: TestFn, reloadBefore: ReloadKind, funcForSource: Function = func) {
  const info = debug.getinfo(funcForSource, "Sl")
  const source = createSource(info.source, info.linedefined)
  test.parts.push({ func, source, reloadBefore })
}

function createTestBuilder<F extends () => void>(
  addPart: (func: F, reloadBefore: ReloadKind) => void,
  addTag: (tag: string) => void,
) {
  function reloadFunc(reloadBefore: ReloadKind, tag: string) {
    return (func: F) => {
      addPart(func, reloadBefore)
      addTag(tag)
      return result
    }
  }

  const result: TestBuilder<F> = {
    after_reload_script: reloadFunc("script", "after_reload_script"),
    after_reload_mods: reloadFunc("mods", "after_reload_mods"),
  }
  return result
}

function createDescribe(
  context: TestContext,
  name: string,
  block: TestFn,
  mode: TestMode,
  upStack: number = 1,
): DescribeBlock {
  const definition = context.definition()
  const source = getCallerSource(upStack + 1)

  const parent = definition.currentBlock
  const describeBlock = addDescribeBlock(parent, name, source, mode, util.merge([parent.tags, consumeTags(definition)]))
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

function createTestEach(context: TestContext, mode: TestMode): TestCreatorBase {
  const result: TestCreatorBase = (name, func) => {
    const test = createTest(context, name, func, mode)
    return createTestBuilder(
      (func1, reloadBefore) => addPart(test, func1, reloadBefore),
      (tag) => test.tags.add(tag),
    )
  }

  result.each = (values: unknown[]) => (name: string, func: (...values: any[]) => void) => {
    const items = createEachItems(values, name)
    const testBuilders = items.map((item) => {
      const test = createTest(context, item.name, () => func(...item.row), mode, 3)
      return { test, row: item.row }
    })
    return createTestBuilder<(...args: unknown[]) => void>(
      (func, reloadBefore) => {
        for (const { test, row } of testBuilders) {
          addPart(
            test,
            () => {
              func(...row)
            },
            reloadBefore,
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

function createDescribeEach(context: TestContext, mode: TestMode): DescribeCreatorBase {
  const result: DescribeCreatorBase = (name, func) => {
    // avoid tail call, messes up stack trace
    // noinspection UnnecessaryLocalVariableJS
    const block: DescribeBlock = createDescribe(context, name, func, mode)
    return block
  }
  result.each = (values: unknown[]) => (name: string, func: (...values: any[]) => void) => {
    const items = createEachItems(values, name)
    for (const { row, name } of items) {
      createDescribe(context, name, () => func(...row), mode, 2)
    }
  }
  return result
}

function createTestCreator(context: TestContext): TestCreator {
  const test = createTestEach(context, undefined) as TestCreator
  test.skip = createTestEach(context, "skip")
  test.only = createTestEach(context, "only")
  test.todo = (name: string) => {
    createTest(
      context,
      name,
      () => {
        //noop
      },
      "todo",
    )
  }
  return test
}

function createDescribeCreator(context: TestContext): DescribeCreator {
  const describe = createDescribeEach(context, undefined) as DescribeCreator
  describe.skip = createDescribeEach(context, "skip")
  describe.only = createDescribeEach(context, "only")
  return describe
}

function tags(context: TestContext, tags: string[]) {
  const definition = context.definition()
  if (definition.currentTags) {
    definition.currentBlock.errors.push(`Double call to tags()`)
  }
  definition.currentTags = util.list_to_map(tags)
}

function getCurrentPart(context: TestContext): PartRun {
  return getCurrentTestRun(context).part
}

function implicitAsync(context: TestContext) {
  const part = getCurrentPart(context)
  part.async = true
  if (!part.explicitAsync) {
    part.timeout = context.testState().config.default_timeout
  }
}

function async(context: TestContext, timeout?: number) {
  const part = getCurrentPart(context)
  part.async = true
  part.explicitAsync = true

  if (!timeout) {
    timeout = context.testState().config.default_timeout
  }
  if (timeout < 1) error("test timeout must be greater than 0")

  part.timeout = timeout
}

function done(context: TestContext) {
  const part = getCurrentPart(context)

  if (!part.async) error(`"done" can only be used when test is async`)
  part.asyncDone = true
}

function onTick(context: TestContext, func: OnTickFn) {
  implicitAsync(context)
  getCurrentPart(context).onTickFuncs.add(func)
}

function afterTicks(context: TestContext, ticks: number, func: TestFn) {
  implicitAsync(context)
  const finishTick = game.tick - getCurrentPart(context).tickStarted + ticks
  if (ticks < 1) error("after_ticks amount must be positive")
  onTick(context, (tick) => {
    if (tick >= finishTick) {
      func()
      return false
    }
  })
}

function ticksBetweenTests(context: TestContext, ticks: number) {
  if (ticks < 0) error("ticks between tests must be 0 or greater")
  context.definition().currentBlock.ticksBetweenTests = ticks
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

export type TestApi = Pick<typeof globalThis, SetupGlobals>

export function createTestApi(context: TestContext): TestApi {
  const test = createTestCreator(context)
  return {
    test,
    it: test,
    describe: createDescribeCreator(context),
    tags: (...tagNames) => tags(context, tagNames),

    before_all: (func) => addHook(context, "beforeAll", func),
    after_all: (func) => addHook(context, "afterAll", func),
    before_each: (func) => addHook(context, "beforeEach", func),
    after_each: (func) => addHook(context, "afterEach", func),
    after_test: (func) => afterTest(context, func),

    async: (timeout) => async(context, timeout),
    done: () => done(context),
    on_tick: (func) => onTick(context, func),
    after_ticks: (ticks, func) => afterTicks(context, ticks, func),
    ticks_between_tests: (ticks) => ticksBetweenTests(context, ticks),
  }
}

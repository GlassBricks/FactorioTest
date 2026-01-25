import { LuaProfiler } from "factorio:runtime"
import { assertNever } from "./_util"
import { TestState } from "./state"
import Config = FactorioTest.Config
import HookFn = FactorioTest.HookFn
import TestFn = FactorioTest.TestFn

export interface Source {
  readonly file?: string | undefined
  readonly line?: number | undefined
}

export function formatSource(source: Source): string {
  if (!source.file) return "<unknown source>"
  return `${source.file}:${source.line ?? 1}`
}
declare global {
  let __TS__sourcemap: Record<string, Record<string, number | Source> | undefined> | undefined
}

function tryUseSourcemap(rawFile: string | undefined, line: number | undefined): Source | undefined {
  if (!rawFile || !line || !__TS__sourcemap) return undefined
  const [fileName] = string.match(rawFile, "@?(%S+)%.lua")
  if (!fileName) return undefined
  const fileSourceMap = __TS__sourcemap[fileName + ".lua"]
  if (!fileSourceMap) return undefined
  const data = fileSourceMap[tostring(line)]
  if (!data) return undefined
  return typeof data === "number" ? { file: fileName + ".ts", line: data } : data
}
export function createSource(file: string | undefined, line: number | undefined): Source {
  return tryUseSourcemap(file, line) ?? { file, line }
}

export type TestMode = undefined | "skip" | "only" | "todo"
export type TestTags = LuaSet<string>

export interface Test {
  readonly type: "test"

  readonly name: string
  readonly path: string
  readonly tags: TestTags

  readonly source: Source
  readonly parent: DescribeBlock
  readonly indexInParent: number

  readonly parts: {
    func: TestFn
    source: Source
  }[]

  readonly declaredMode: TestMode
  mode: TestMode
  readonly ticksBefore: number

  readonly errors: string[]
  profiler?: LuaProfiler | undefined

  _previouslyFailed?: boolean
}

export function addTest(
  parent: DescribeBlock,
  name: string,
  source: Source,
  func: TestFn,
  declaredMode: TestMode,
  tags: TestTags,
): Test {
  const test: Test = {
    type: "test",
    name,
    path: parent.path + " > " + name,
    tags,
    parent,
    source,
    indexInParent: parent.children.length,
    parts: [
      {
        func,
        source,
      },
    ],
    errors: [],
    declaredMode,
    mode: declaredMode,
    ticksBefore: parent.ticksBetweenTests,
  }
  parent.children.push(test)
  return test
}

export type HookType = `${"before" | "after"}${"Each" | "All"}` | "afterTest"

export interface Hook {
  func: HookFn
  type: HookType
}

export interface DescribeBlock {
  readonly type: "describeBlock"

  readonly name: string
  readonly path: string
  readonly tags: TestTags

  readonly source: Source

  readonly parent: DescribeBlock | undefined
  readonly children: (Test | DescribeBlock)[]
  readonly indexInParent: number

  readonly hooks: Hook[]

  readonly declaredMode: TestMode
  mode?: TestMode

  ticksBetweenTests: number

  errors: string[]

  _hasFailedDescendant?: boolean
  _reordered?: boolean
}

export function addDescribeBlock(
  parent: DescribeBlock,
  name: string,
  source: Source,
  declaredMode: TestMode,
  tags: TestTags,
): DescribeBlock {
  const block: DescribeBlock = {
    type: "describeBlock",
    name,
    path: parent.path !== "" ? parent.path + " > " + name : name,
    tags,
    parent,
    indexInParent: parent?.children.length ?? -1,
    source,
    hooks: [],
    children: [],
    declaredMode,
    ticksBetweenTests: parent.ticksBetweenTests,
    errors: [],
  }
  parent.children.push(block)
  return block
}

export function createRootDescribeBlock(config: Config): DescribeBlock {
  return {
    type: "describeBlock",
    name: "",
    path: "",
    tags: new LuaSet(),
    source: {},
    parent: undefined,
    children: [],
    indexInParent: -1,
    hooks: [],
    declaredMode: undefined,
    mode: undefined,
    ticksBetweenTests: config.default_ticks_between_tests,
    errors: [],
  }
}

function testMatchesTagList(test: Test, config: Config): boolean {
  if (config.tag_whitelist) {
    for (const tag of config.tag_whitelist) {
      if (!(tag in test.tags)) return false
    }
  }
  if (config.tag_blacklist) {
    for (const tag of config.tag_blacklist) {
      if (tag in test.tags) return false
    }
  }
  return true
}

export function isSkippedTest(test: Test, state: TestState) {
  return (
    test.mode === "skip" ||
    test.mode === "todo" ||
    (state.hasFocusedTests && test.mode !== "only") ||
    (state.config.test_pattern !== undefined && !string.match(test.path, state.config.test_pattern)[0]) ||
    !testMatchesTagList(test, state.config)
  )
}

export function countActiveTests(block: DescribeBlock, state: TestState): number {
  if (block.mode === "skip") return 0
  let result = 0
  for (const child of block.children) {
    if (child.type === "describeBlock") {
      result += countActiveTests(child, state)
    } else if (child.type === "test") {
      if (!isSkippedTest(child, state)) result++
    } else {
      assertNever(child)
    }
  }
  return result
}

export type HookTraversalOrder = "ancestors-first" | "descendants-first"

export function collectHooks(block: DescribeBlock, type: HookType, order: HookTraversalOrder): HookFn[] {
  const hooks: HookFn[] = []
  collectHooksRecursive(block, type, order, hooks)
  return hooks
}

function collectHooksRecursive(block: DescribeBlock, type: HookType, order: HookTraversalOrder, hooks: HookFn[]): void {
  if (order === "ancestors-first" && block.parent) {
    collectHooksRecursive(block.parent, type, order, hooks)
  }

  for (const hook of block.hooks) {
    if (hook.type === type) {
      hooks.push(hook.func)
    }
  }

  if (order === "descendants-first" && block.parent) {
    collectHooksRecursive(block.parent, type, order, hooks)
  }
}

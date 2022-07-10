import { TestStage } from "../shared-constants"
import { RunResults } from "./result"
import type { TestState } from "./state"
import { DescribeBlock, HookType, Source, Test, TestMode } from "./tests"
import { table } from "util"
import compare = table.compare

interface SavedTestData {
  readonly type: "test"
  readonly path: string
  readonly tags: Tags
  readonly source: Source

  readonly numParts: number
  readonly mode: TestMode
  readonly ticksBefore: number

  readonly errors: string[]
  readonly profiler?: LuaProfiler
}

interface SavedDescribeBlockData {
  readonly type: "describeBlock"
  readonly path: string
  readonly tags: Tags
  readonly source: Source
  readonly children: (SavedTestData | SavedDescribeBlockData)[]
  readonly hookTypes: HookType[]
  readonly mode: TestMode
  readonly ticksBetweenTests: number
  readonly errors: string[]
}

function copyTest(test: Test): SavedTestData {
  const result: SavedTestData = {
    type: "test",
    path: test.path,
    tags: test.tags,
    source: test.source,
    numParts: test.parts.length,
    mode: test.mode,
    ticksBefore: test.ticksBefore,
    errors: test.errors,
    profiler: test.profiler,
  }
  ;(test as any).parts = undefined!
  return result
}

function copyDescribeBlock(block: DescribeBlock): SavedDescribeBlockData {
  const result: SavedDescribeBlockData = {
    type: "describeBlock",
    path: block.path,
    tags: block.tags,
    source: block.source,
    children: block.children.map((child) => (child.type === "test" ? copyTest(child) : copyDescribeBlock(child))),
    hookTypes: block.hooks.map((hook) => hook.type),
    mode: block.mode,
    ticksBetweenTests: block.ticksBetweenTests,
    errors: block.errors,
  }
  ;(block as any).hooks = undefined!

  return result
}

let savedTestPath: string
let foundMatchingTest: Test | undefined

function compareToSavedTest(saved: SavedTestData, current: Test): boolean {
  if (saved.path !== current.path) return false
  if (!compare(saved.tags, current.tags)) return false
  if (!compare(saved.source, current.source)) return false
  if (saved.numParts !== current.parts.length) return false
  if (saved.mode !== current.mode) return false
  if (saved.ticksBefore !== current.ticksBefore) return false
  ;(current as any).errors = saved.errors
  current.profiler = saved.profiler
  if (current.path === savedTestPath) {
    foundMatchingTest = current
  }
  return true
}

function compareToSavedDescribeBlock(saved: SavedDescribeBlockData, current: DescribeBlock): boolean {
  if (saved.path !== current.path) return false
  if (!compare(saved.tags, current.tags)) return false
  if (!compare(saved.source, current.source)) return false
  if (
    !compare(
      saved.hookTypes,
      current.hooks.map((hook) => hook.type),
    )
  )
    return false
  if (saved.mode !== current.mode) return false
  if (saved.ticksBetweenTests !== current.ticksBetweenTests) return false
  const childrenMatch = saved.children.every((child, i) => {
    const currentChild = current.children[i]
    if (!currentChild || currentChild.type !== child.type) return false
    return child.type === "test"
      ? compareToSavedTest(child, currentChild as Test)
      : compareToSavedDescribeBlock(child, currentChild as DescribeBlock)
  })
  if (!childrenMatch) return false
  ;(current as any).errors = saved.errors
  return true
}

interface ResumeData {
  rootBlock: SavedDescribeBlockData
  results: RunResults
  isRerun: boolean
  profiler: LuaProfiler
  resumeTestPath: string
  resumePartIndex: number
}
declare const global: {
  __testResume?: ResumeData
}

export function prepareReload(testState: TestState): void {
  const currentRun = testState.currentTestRun!
  global.__testResume = {
    rootBlock: copyDescribeBlock(testState.rootBlock),
    results: testState.results,
    isRerun: testState.isRerun,
    resumeTestPath: currentRun.test.path,
    resumePartIndex: currentRun.partIndex + 1,
    profiler: testState.profiler!,
  }
  testState.rootBlock = undefined!
  testState.currentTestRun = undefined!
  testState.setTestStage(TestStage.ToReload)
  // collectgarbage()
  // game.print(serpent.block(findRefValue()))
}

export function resumeAfterReload(state: TestState):
  | {
      test: Test
      partIndex: number
    }
  | {
      test?: never
      partIndex?: never
    } {
  const testResume = global.__testResume ?? error("attempting to resume after reload without resume data saved")

  global.__testResume = undefined

  state.results = testResume.results
  state.profiler = testResume.profiler
  state.isRerun = testResume.isRerun
  state.reloaded = true

  const saved = testResume.rootBlock

  savedTestPath = testResume.resumeTestPath
  foundMatchingTest = undefined
  const matches = compareToSavedDescribeBlock(saved, state.rootBlock)
  const test = foundMatchingTest
  foundMatchingTest = undefined
  savedTestPath = undefined!

  if (matches && test) {
    return {
      test,
      partIndex: testResume.resumePartIndex,
    }
  }
  return {}
}

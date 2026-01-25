import { LuaProfiler } from "factorio:runtime"
import { table } from "util"
import { TestStage } from "../constants"
import { TestRunResults } from "./results"
import type { TestState } from "./state"
import { DescribeBlock, HookType, Source, Test, TestMode, TestTags } from "./tests"
import compare = table.compare

interface SavedTestData {
  readonly type: "test"
  readonly path: string
  readonly tags: TestTags
  readonly source: Source

  readonly numParts: number
  readonly mode: TestMode
  readonly ticksBefore: number

  readonly errors: string[]
  readonly profiler?: LuaProfiler | undefined
}

interface SavedDescribeBlockData {
  readonly type: "describeBlock"
  readonly path: string
  readonly tags: TestTags
  readonly source: Source
  readonly children: (SavedTestData | SavedDescribeBlockData)[]
  readonly hookTypes: HookType[]
  readonly mode: TestMode
  readonly ticksBetweenTests: number
  readonly errors: string[]
}

function saveTest(test: Test): SavedTestData {
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

function saveDescribeBlock(block: DescribeBlock): SavedDescribeBlockData {
  const result: SavedDescribeBlockData = {
    type: "describeBlock",
    path: block.path,
    tags: block.tags,
    source: block.source,
    children: block.children.map((child) => (child.type === "test" ? saveTest(child) : saveDescribeBlock(child))),
    hookTypes: block.hooks.map((hook) => hook.type),
    mode: block.mode,
    ticksBetweenTests: block.ticksBetweenTests,
    errors: block.errors,
  }
  ;(block as any).hooks = undefined!

  return result
}

function structuresMatch(saved: SavedTestData, current: Test): boolean {
  if (saved.path !== current.path) {
    log(`Structure mismatch: path "${saved.path}" !== "${current.path}"`)
    return false
  }
  if (!compare(saved.tags, current.tags)) {
    log(`Structure mismatch in "${saved.path}": tags differ`)
    return false
  }
  if (!compare(saved.source, current.source)) {
    log(
      `Structure mismatch in "${saved.path}": source ${serpent.line(saved.source)} !== ${serpent.line(current.source)}`,
    )
    return false
  }
  if (saved.numParts !== current.parts.length) {
    log(`Structure mismatch in "${saved.path}": numParts ${saved.numParts} !== ${current.parts.length}`)
    return false
  }
  if (saved.mode !== current.mode) {
    log(`Structure mismatch in "${saved.path}": mode "${saved.mode}" !== "${current.mode}"`)
    return false
  }
  if (saved.ticksBefore !== current.ticksBefore) {
    log(`Structure mismatch in "${saved.path}": ticksBefore ${saved.ticksBefore} !== ${current.ticksBefore}`)
    return false
  }
  return true
}

function describeBlockStructuresMatch(saved: SavedDescribeBlockData, current: DescribeBlock): boolean {
  if (saved.path !== current.path) {
    log(`Block mismatch: path "${saved.path}" !== "${current.path}"`)
    return false
  }
  if (!compare(saved.tags, current.tags)) {
    log(`Block mismatch in "${saved.path}": tags differ`)
    return false
  }
  if (!compare(saved.source, current.source)) {
    log(
      `Block mismatch in "${saved.path}": source ${serpent.line(saved.source)} !== ${serpent.line(current.source)}`,
    )
    return false
  }
  if (
    !compare(
      saved.hookTypes,
      current.hooks.map((hook) => hook.type),
    )
  ) {
    log(`Block mismatch in "${saved.path}": hookTypes differ`)
    return false
  }
  if (saved.mode !== current.mode) {
    log(`Block mismatch in "${saved.path}": mode "${saved.mode}" !== "${current.mode}"`)
    return false
  }
  if (saved.ticksBetweenTests !== current.ticksBetweenTests) {
    log(`Block mismatch in "${saved.path}": ticksBetweenTests ${saved.ticksBetweenTests} !== ${current.ticksBetweenTests}`)
    return false
  }
  if (saved.children.length !== current.children.length) {
    log(`Block mismatch in "${saved.path}": children.length ${saved.children.length} !== ${current.children.length}`)
    return false
  }

  const currentByPath = new LuaMap<string, Test | DescribeBlock>()
  for (const child of current.children) {
    if (currentByPath.has(child.path)) {
      log(`Duplicate test/describe path "${child.path}" - this will cause reload issues`)
    }
    currentByPath.set(child.path, child)
  }

  return saved.children.every((child) => {
    const currentChild = currentByPath.get(child.path)
    if (!currentChild) {
      log(`Block mismatch in "${saved.path}": child "${child.path}" not found in current`)
      return false
    }
    if (currentChild.type !== child.type) {
      log(`Block mismatch in "${saved.path}": child "${child.path}" type "${child.type}" !== "${currentChild.type}"`)
      return false
    }
    return child.type === "test"
      ? structuresMatch(child, currentChild as Test)
      : describeBlockStructuresMatch(child, currentChild as DescribeBlock)
  })
}

function restoreTestState(saved: SavedTestData, current: Test): void {
  current.errors.length = 0
  current.errors.push(...saved.errors)
  current.profiler = saved.profiler
}

function restoreDescribeBlockState(saved: SavedDescribeBlockData, current: DescribeBlock): void {
  current.errors.length = 0
  current.errors.push(...saved.errors)

  const currentByPath = new LuaMap<string, Test | DescribeBlock>()
  for (const child of current.children) {
    currentByPath.set(child.path, child)
  }

  for (const savedChild of saved.children) {
    const currentChild = currentByPath.get(savedChild.path)!
    if (savedChild.type === "test") {
      restoreTestState(savedChild, currentChild as Test)
    } else {
      restoreDescribeBlockState(savedChild, currentChild as DescribeBlock)
    }
  }
}

function findTestByPath(block: DescribeBlock, path: string): Test | undefined {
  for (const child of block.children) {
    if (child.type === "test") {
      if (child.path === path) return child
    } else {
      const found = findTestByPath(child, path)
      if (found) return found
    }
  }
  return undefined
}

interface ResumeData {
  rootBlock: SavedDescribeBlockData
  results: TestRunResults
  profiler: LuaProfiler
  resumeTestPath: string
  resumePartIndex: number
}
declare const storage: {
  __testResume: ResumeData | undefined
}

export function prepareReload(testState: TestState): void {
  const currentRun = testState.currentTestRun!
  storage.__testResume = {
    rootBlock: saveDescribeBlock(testState.rootBlock),
    results: testState.results,
    resumeTestPath: currentRun.test.path,
    resumePartIndex: currentRun.partIndex + 1,
    profiler: testState.profiler!,
  }
  testState.rootBlock = undefined!
  testState.currentTestRun = undefined!
  testState.setTestStage(TestStage.ReloadingMods)
}

export function resumeAfterReload(state: TestState): { test: Test; partIndex: number } | undefined {
  const testResume = storage.__testResume ?? error("attempting to resume after reload without resume data saved")
  storage.__testResume = undefined

  state.results = testResume.results
  state.profiler = testResume.profiler
  state.reloaded = true

  const saved = testResume.rootBlock

  if (!describeBlockStructuresMatch(saved, state.rootBlock)) {
    return undefined
  }

  restoreDescribeBlockState(saved, state.rootBlock)

  const test = findTestByPath(state.rootBlock, testResume.resumeTestPath)
  if (!test) {
    return undefined
  }

  return {
    test,
    partIndex: testResume.resumePartIndex,
  }
}

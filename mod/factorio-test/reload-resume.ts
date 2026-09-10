import { LuaProfiler } from "factorio:runtime"
import { table } from "util"
import { TestStage } from "../constants"
import { TestRunResults } from "./results"
import { type TestState } from "./state"
import { testStorage } from "./storage"
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

/** Snapshots a test, and detaches its `parts` so they are not saved into `storage`. */
function snapshotAndDetachTest(test: Test): SavedTestData {
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

/** Snapshots a describe block, and detaches its `hooks` so they are not saved into `storage`. */
function snapshotAndDetachDescribeBlock(block: DescribeBlock): SavedDescribeBlockData {
  const result: SavedDescribeBlockData = {
    type: "describeBlock",
    path: block.path,
    tags: block.tags,
    source: block.source,
    children: block.children.map((child) =>
      child.type === "test" ? snapshotAndDetachTest(child) : snapshotAndDetachDescribeBlock(child),
    ),
    hookTypes: block.hooks.map((hook) => hook.type),
    mode: block.mode,
    ticksBetweenTests: block.ticksBetweenTests,
    errors: block.errors,
  }
  ;(block as any).hooks = undefined!

  return result
}

function valuesMatch(a: unknown, b: unknown): boolean {
  if (a === b) return true
  return typeof a === "object" && typeof b === "object" && compare(a as object, b as object)
}

function fieldsMatch(path: string, fields: [name: string, saved: unknown, current: unknown][]): boolean {
  for (const [name, saved, current] of fields) {
    if (valuesMatch(saved, current)) continue
    log(`Structure mismatch in "${path}": ${name} ${serpent.line(saved)} !== ${serpent.line(current)}`)
    return false
  }
  return true
}

function testFieldsMatch(saved: SavedTestData, current: Test): boolean {
  return fieldsMatch(saved.path, [
    ["path", saved.path, current.path],
    ["tags", saved.tags, current.tags],
    ["source", saved.source, current.source],
    ["numParts", saved.numParts, current.parts.length],
    ["mode", saved.mode, current.mode],
    ["ticksBefore", saved.ticksBefore, current.ticksBefore],
  ])
}

function describeBlockFieldsMatch(saved: SavedDescribeBlockData, current: DescribeBlock): boolean {
  return fieldsMatch(saved.path, [
    ["path", saved.path, current.path],
    ["tags", saved.tags, current.tags],
    ["source", saved.source, current.source],
    ["hookTypes", saved.hookTypes, current.hooks.map((hook) => hook.type)],
    ["mode", saved.mode, current.mode],
    ["ticksBetweenTests", saved.ticksBetweenTests, current.ticksBetweenTests],
    ["children.length", saved.children.length, current.children.length],
  ])
}

function childrenByPath(block: DescribeBlock): LuaMap<string, Test | DescribeBlock> {
  const map = new LuaMap<string, Test | DescribeBlock>()
  for (const child of block.children) {
    if (map.has(child.path)) {
      log(`Duplicate test/describe path "${child.path}" - this will cause reload issues`)
    }
    map.set(child.path, child)
  }
  return map
}

function describeBlockStructuresMatch(saved: SavedDescribeBlockData, current: DescribeBlock): boolean {
  if (!describeBlockFieldsMatch(saved, current)) return false

  const currentByPath = childrenByPath(current)
  return saved.children.every((child) => {
    const currentChild = currentByPath.get(child.path)
    if (!currentChild) {
      log(`Structure mismatch in "${saved.path}": child "${child.path}" not found in current`)
      return false
    }
    if (currentChild.type !== child.type) {
      log(
        `Structure mismatch in "${saved.path}": child "${child.path}" type "${child.type}" !== "${currentChild.type}"`,
      )
      return false
    }
    return child.type === "test"
      ? testFieldsMatch(child, currentChild as Test)
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

  const currentByPath = childrenByPath(current)
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

export interface ResumeData {
  rootBlock: SavedDescribeBlockData
  results: TestRunResults
  profiler: LuaProfiler
  resumeTestPath: string
  resumePartIndex: number
}

export function prepareReload(testState: TestState): void {
  const currentRun = testState.currentTestRun!
  testStorage().resume = {
    rootBlock: snapshotAndDetachDescribeBlock(testState.rootBlock),
    results: testState.report!.results,
    resumeTestPath: currentRun.test.path,
    resumePartIndex: currentRun.partIndex + 1,
    profiler: testState.report!.profiler!,
  }
  testState.rootBlock = undefined!
  testState.currentTestRun = undefined
  testState.env.setTestStage(TestStage.ReloadingMods)
}

export function resumeAfterReload(state: TestState): { test: Test; partIndex: number } | undefined {
  const testResume = testStorage().resume ?? error("attempting to resume after reload without resume data saved")
  testStorage().resume = undefined

  state.report = {
    results: testResume.results,
    profiler: testResume.profiler,
    reloaded: true,
    bailedOut: false,
  }

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

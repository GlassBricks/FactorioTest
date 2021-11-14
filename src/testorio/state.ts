import { createRootDescribeBlock, DescribeBlock, Test } from "./tests"
import { Remote, TestStage } from "../shared-constants"
import { _raiseTestEvent, TestEvent } from "./testEvents"
import { createRunResult, RunResults } from "./result"
import OnTickFn = Testorio.OnTickFn
import Config = Testorio.Config

/** @noSelf */
export interface TestState {
  config: Config
  rootBlock: DescribeBlock
  // setup
  currentBlock?: DescribeBlock
  hasFocusedTests: boolean

  // run
  currentTestRun?: TestRun
  suppressedErrors: string[]

  results: RunResults

  // state that is persistent across game reload
  // here as a function so is mock-able in meta test
  getTestStage(): TestStage
  setTestStage(state: TestStage): void

  raiseTestEvent(this: this, event: TestEvent): void
}

export interface TestRun {
  test: Test
  partIndex: number
  async: boolean
  timeout: number
  asyncDone: boolean
  tickStarted: number
  onTickFuncs: LuaTable<OnTickFn, true>
}

declare global {
  let TESTORIO_TEST_STATE: TestState | undefined
}

// stored in settings so can be accessed even when global table is not yet loaded
// TODO: monitor usages for globalness
export function getTestState(): TestState {
  return TESTORIO_TEST_STATE ?? error("Tests are not configured to be run")
}

// internal, export for meta-test only
export function _setTestState(state: TestState): void {
  TESTORIO_TEST_STATE = state
}

export function getGlobalTestStage(): TestStage {
  return remote.call(Remote.Testorio, "getGlobalTestStage")
}

function setGlobalTestStage(stage: TestStage): void {
  remote.call(Remote.Testorio, "setGlobalTestStage", stage)
}

export function resetTestState(config: Config): void {
  const rootBlock = createRootDescribeBlock()
  _setTestState({
    config,
    rootBlock,
    currentBlock: rootBlock,
    hasFocusedTests: false,
    suppressedErrors: [],
    getTestStage: getGlobalTestStage,
    setTestStage: setGlobalTestStage,
    raiseTestEvent(event) {
      _raiseTestEvent(this, event)
    },
    results: createRunResult(),
  })
}

export function makeLoadError(state: TestState, error: string): void {
  state.setTestStage(TestStage.LoadError)
  state.rootBlock = createRootDescribeBlock()
  state.currentBlock = undefined
  state.currentTestRun = undefined
  state.suppressedErrors = [error]
}

export function getCurrentBlock(): DescribeBlock {
  const block = getTestState().currentBlock
  if (!block) {
    error("Tests and hooks cannot be added/configured at this time")
  }
  return block
}

export function getCurrentTestRun(): TestRun {
  return getTestState().currentTestRun ?? error("This can only be used during a test", 3)
}

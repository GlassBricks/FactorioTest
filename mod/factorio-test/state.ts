/** @noSelfInFile */
import { TestStage } from "../constants"
import { createEmptyRunResults, TestRunResults } from "./results"
import { notifyListeners, TestEvent } from "./test-events"
import { testStorage } from "./storage"
import { createRootDescribeBlock, DescribeBlock, Test, TestTags } from "./tests"
import Config = FactorioTest.Config
import OnTickFn = FactorioTest.OnTickFn
import HookFn = FactorioTest.HookFn
import { LuaProfiler } from "factorio:runtime"

/**
 * Interface between the test framework, and the world around it.
 *
 * Mocked in tests.
 * @noSelf
 */
export interface TestEnvironment {
  getTestStage(): TestStage
  setTestStage(stage: TestStage): void
  emit(event: TestEvent): void
}

/** State belonging to a single test run; recreated for each run. */
export interface RunState {
  currentTestRun?: TestRun | undefined
  cancelRequested: boolean
  failureCount: number
  bailedOut: boolean
  profiler?: LuaProfiler
}

/** @noSelf */
export interface TestState {
  config: Config
  rootBlock: DescribeBlock

  // definition phase
  currentBlock?: DescribeBlock | undefined
  currentTags?: TestTags | undefined
  hasFocusedTests: boolean

  run: RunState

  // outlives the run: read by the getResults remote after it finishes
  results: TestRunResults
  reloaded?: boolean

  env: TestEnvironment
}

export interface TestRun {
  test: Test
  partIndex: number
  async: boolean
  explicitAsync?: boolean
  timeout: number
  asyncDone: boolean
  tickStarted: number
  onTickFuncs: LuaSet<OnTickFn>
  afterTestFuncs: HookFn[]
}

let TheTestState: TestState | undefined

export function getTestState(): TestState {
  return TheTestState ?? error("Tests are not configured to be run")
}

// internal, export for meta-test only
export function _setTestState(state: TestState): void {
  TheTestState = state
}

export function getGlobalTestStage(): TestStage {
  return testStorage().testStage ?? TestStage.NotRun
}

const onTestStageChanged = script.generate_event_name<{ stage: TestStage }>()
export { onTestStageChanged }

function setGlobalTestStage(stage: TestStage): void {
  testStorage().testStage = stage
  script.raise_event(onTestStageChanged, { stage })
}

export function createRunState(): RunState {
  return {
    cancelRequested: false,
    failureCount: 0,
    bailedOut: false,
  }
}

export function resetTestState(config: Config): void {
  const rootBlock = createRootDescribeBlock(config)
  const state: TestState = {
    config,
    rootBlock,
    currentBlock: rootBlock,
    hasFocusedTests: false,
    run: createRunState(),
    results: createEmptyRunResults(),
    env: {
      getTestStage: getGlobalTestStage,
      setTestStage: setGlobalTestStage,
      emit: (event) => notifyListeners(state, event),
    },
  }
  _setTestState(state)
}

/** Frees the test tree once a run is over. */
export function cleanupTestState(): void {
  const state = getTestState()
  state.run = createRunState()
  state.rootBlock = createRootDescribeBlock(state.config)
  state.currentBlock = undefined
}

export function setToLoadErrorState(state: TestState, error: string): void {
  state.env.setTestStage(TestStage.LoadError)
  state.rootBlock = createRootDescribeBlock(state.config)
  state.currentBlock = undefined
  state.run.currentTestRun = undefined
  state.rootBlock.errors = [error]
  game.speed = 1
}

export function getCurrentBlock(): DescribeBlock {
  return getTestState().currentBlock ?? error("Tests and hooks cannot be added/configured at this time")
}

/** @noSelfInFile */
import { TestStage } from "../constants"
import { RunReport } from "./results"
import { notifyListeners, TestEvent } from "./test-events"
import { testStorage } from "./storage"
import { createRootDescribeBlock, DescribeBlock, Test, TestSuite, TestTags } from "./tests"
import Config = FactorioTest.Config
import OnTickFn = FactorioTest.OnTickFn
import HookFn = FactorioTest.HookFn

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

/** @noSelf */
export interface TestState {
  config: Config
  suite: TestSuite

  // definition phase
  currentBlock?: DescribeBlock | undefined
  currentTags?: TestTags | undefined

  currentTestRun?: TestRun | undefined

  /** Created when a run starts, and outlives it: read by the getResults remote afterwards. */
  report?: RunReport | undefined

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

export function resetTestState(config: Config): void {
  const rootBlock = createRootDescribeBlock(config)
  const state: TestState = {
    config,
    suite: { rootBlock, hasFocusedTests: false },
    currentBlock: rootBlock,
    env: {
      getTestStage: getGlobalTestStage,
      setTestStage: setGlobalTestStage,
      emit: (event) => notifyListeners(state, event),
    },
  }
  _setTestState(state)
}

export function setToLoadErrorState(state: TestState, error: string): void {
  state.env.setTestStage(TestStage.LoadError)
  const rootBlock = createRootDescribeBlock(state.config)
  rootBlock.errors = [error]
  state.suite = { rootBlock, hasFocusedTests: false }
  state.currentBlock = undefined
  state.currentTestRun = undefined
  game.speed = 1
}

export function getCurrentBlock(): DescribeBlock {
  return getTestState().currentBlock ?? error("Tests and hooks cannot be added/configured at this time")
}

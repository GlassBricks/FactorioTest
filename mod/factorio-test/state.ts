/** @noSelfInFile */
import { TestStage } from "../constants"
import { RunReport } from "./results"
import { notifyListeners, TestEvent } from "./test-events"
import { testStorage } from "./storage"
import { createRootDescribeBlock, Test, TestSuite } from "./tests"
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

/** Unlike `getTestState`, does not error before the definition phase has finished. */
export function peekTestState(): TestState | undefined {
  return TheTestState
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

export function initTestState(config: Config, suite: TestSuite): TestState {
  const state: TestState = {
    config,
    suite,
    env: {
      getTestStage: getGlobalTestStage,
      setTestStage: setGlobalTestStage,
      emit: (event) => notifyListeners(state, event),
    },
  }
  _setTestState(state)
  return state
}

export function setToLoadErrorState(state: TestState, error: string): void {
  state.env.setTestStage(TestStage.LoadError)
  const rootBlock = createRootDescribeBlock(state.config)
  rootBlock.errors = [error]
  state.suite = { rootBlock, hasFocusedTests: false }
  state.currentTestRun = undefined
  game.speed = 1
}

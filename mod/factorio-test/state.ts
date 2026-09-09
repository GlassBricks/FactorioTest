/** @noSelfInFile */
import { TestStage } from "../constants"
import { createEmptyRunResults, TestRunResults } from "./results"
import { _raiseTestEvent, TestEvent } from "./test-events"
import { createRootDescribeBlock, DescribeBlock, Test, TestTags } from "./tests"
import Config = FactorioTest.Config
import OnTickFn = FactorioTest.OnTickFn
import HookFn = FactorioTest.HookFn
import { LuaProfiler } from "factorio:runtime"

/** An action the user can take while the test run is paused at a step. */
export type StepAction = "next" | "skipTest" | "runRest"

export interface StepPause {
  caption: string
}

/** @noSelf */
export interface TestState {
  config: Config
  rootBlock: DescribeBlock
  // setup
  currentBlock?: DescribeBlock | undefined
  currentTags?: TestTags | undefined
  hasFocusedTests: boolean

  // run
  currentTestRun?: TestRun | undefined
  cancelRequested: boolean
  failureCount: number
  bailedOut: boolean

  // step mode
  /** Whether the run currently pauses at steps. Turned off by the "run the rest" action. */
  stepMode: boolean
  /** Set while the run is paused, waiting for a step action. */
  stepPause?: StepPause | undefined
  /** The action chosen by the user, consumed by the runner on the next tick. */
  stepAction?: StepAction | undefined

  results: TestRunResults
  profiler?: LuaProfiler

  reloaded?: boolean

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
  explicitAsync?: boolean
  timeout: number
  asyncDone: boolean
  tickStarted: number
  onTickFuncs: LuaSet<OnTickFn>
  afterTestFuncs: HookFn[]
  /** Set when the user skipped the rest of this test from the step GUI. */
  stepSkipped?: boolean
}

let TheTestState: TestState | undefined
declare const storage: {
  __factorio_testTestStage?: TestStage
}

export function getTestState(): TestState {
  return TheTestState ?? error("Tests are not configured to be run")
}

// internal, export for meta-test only
export function _setTestState(state: TestState): void {
  TheTestState = state
}

export function getGlobalTestStage(): TestStage {
  return storage.__factorio_testTestStage ?? TestStage.NotRun
}

const onTestStageChanged = script.generate_event_name<{ stage: TestStage }>()
export { onTestStageChanged }

function setGlobalTestStage(stage: TestStage): void {
  storage.__factorio_testTestStage = stage
  script.raise_event(onTestStageChanged, { stage })
}

export function resetTestState(config: Config): void {
  const rootBlock = createRootDescribeBlock(config)
  _setTestState({
    config,
    rootBlock,
    currentBlock: rootBlock,
    hasFocusedTests: false,
    cancelRequested: false,
    stepMode: config.step,
    failureCount: 0,
    bailedOut: false,
    results: createEmptyRunResults(),
    getTestStage: getGlobalTestStage,
    setTestStage: setGlobalTestStage,
    raiseTestEvent(event) {
      _raiseTestEvent(this, event)
    },
  })
}

/**
 * Called from outside the runner (the test GUI) to resume a run paused at a step.
 * The runner picks the action up on its next tick.
 */
export function requestStepAction(action: StepAction): void {
  const state = TheTestState
  if (!state?.stepPause) return
  state.stepAction = action
  state.stepPause = undefined
  // The runner only advances on_tick, which does not fire while the game is paused.
  if (game !== undefined) game.tick_paused = false
}

export function cleanupTestState(): void {
  const state = getTestState()
  state.config = undefined!
  state.rootBlock = undefined!
  state.currentBlock = undefined
  state.currentTestRun = undefined
}

export function setToLoadErrorState(state: TestState, error: string): void {
  state.setTestStage(TestStage.LoadError)
  state.rootBlock = createRootDescribeBlock(state.config)
  state.currentBlock = undefined
  state.currentTestRun = undefined
  state.rootBlock.errors = [error]
  game.speed = 1
}

export function getCurrentBlock(): DescribeBlock {
  return getTestState().currentBlock ?? error("Tests and hooks cannot be added/configured at this time")
}

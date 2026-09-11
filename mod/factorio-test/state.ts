/** @noSelfInFile */
import { TestStage } from "../constants"
import { createRunReport, RunReport } from "./results"
import { notifyListeners, TestEvent } from "./test-events"
import { getGlobalTestStage, setGlobalTestStage } from "./test-stage"
import { createRootDescribeBlock, DescribeBlock, Test, TestSuite, TestTags } from "./tests"
import Config = FactorioTest.Config
import OnTickFn = FactorioTest.OnTickFn
import HookFn = FactorioTest.HookFn

/**
 * State needed to collect tests.
 *
 * Live only while tests are being defined.
 */
export interface DefinitionState {
  config: Config
  readonly rootBlock: DescribeBlock
  currentBlock: DescribeBlock
  currentTags?: TestTags
  hasFocusedTests: boolean
}

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

  currentTestRun?: TestRun

  /** Replaced when a run starts, and outlives it: read by the getResults remote afterwards. */
  report: RunReport

  env: TestEnvironment
}

/** One test in flight. Survives the transition from one part to the next. */
export interface TestRun {
  readonly test: Test
  afterTestFuncs: HookFn[]
  part: PartRun
}

/** One part of a test in flight; recreated per part. What async/done/on_tick mutate. */
export interface PartRun {
  readonly partIndex: number
  async: boolean
  explicitAsync?: boolean
  timeout: number
  asyncDone: boolean
  tickStarted: number
  onTickFuncs: LuaSet<OnTickFn>
}

let theDefinition: DefinitionState | undefined
let theTestState: TestState | undefined

export function beginDefinition(config: Config): DefinitionState {
  const rootBlock = createRootDescribeBlock(config)
  theDefinition = {
    config,
    rootBlock,
    currentBlock: rootBlock,
    hasFocusedTests: false,
  }
  return theDefinition
}

export function getDefinitionState(): DefinitionState {
  if (theDefinition) return theDefinition
  const testRun = theTestState?.currentTestRun
  if (testRun) error(`Tests and hooks cannot be nested inside test "${testRun.test.path}"`)
  error(`Tests and hooks cannot be added/configured at this time`)
}

export function consumeTags(): TestTags {
  const definition = getDefinitionState()
  const result = definition.currentTags
  definition.currentTags = undefined
  return result ?? new LuaSet()
}

/** Seals the definition phase, and installs the state the resulting suite is run with. */
export function endDefinition(): TestState {
  const { config, rootBlock, hasFocusedTests } = getDefinitionState()
  _clearDefinition()
  return initTestState(config, { rootBlock, hasFocusedTests })
}

function initTestState(config: Config, suite: TestSuite): TestState {
  const state: TestState = {
    config,
    suite,
    report: createRunReport(),
    env: {
      getTestStage: getGlobalTestStage,
      setTestStage: setGlobalTestStage,
      emit: (event) => notifyListeners(state, event),
    },
  }
  theTestState = state
  return state
}

export function getTestState(): TestState {
  return theTestState ?? error("Tests are not configured to be run")
}

export function setToLoadErrorState(state: TestState, error: string): void {
  state.env.setTestStage(TestStage.LoadError)
  const rootBlock = createRootDescribeBlock(state.config)
  rootBlock.errors = [error]
  state.suite = { rootBlock, hasFocusedTests: false }
  state.currentTestRun = undefined
  game.speed = 1
}

// internal, export for meta-test only
export function _clearDefinition(): DefinitionState | undefined {
  const definition = theDefinition
  theDefinition = undefined
  return definition
}

// internal, export for meta-test only
export function _setTestState(state: TestState): void {
  theTestState = state
}

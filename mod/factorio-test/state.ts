/** @noSelfInFile */
import { TestStage } from "../constants"
import { createRunReport, RunReport } from "./results"
import { testStorage } from "./storage"
import { createRootDescribeBlock, DescribeBlock, Test, TestSuite, TestTags } from "./tests"
import Config = FactorioTest.Config
import OnTickFn = FactorioTest.OnTickFn
import HookFn = FactorioTest.HookFn

export const onTestStageChanged = script.generate_event_name<{ stage: TestStage }>()

export interface TestStageStore {
  get(): TestStage
  set(stage: TestStage): void
}

export const globalTestStage: TestStageStore = {
  get: () => testStorage().testStage ?? TestStage.NotRun,
  set: (stage) => {
    testStorage().testStage = stage
    script.raise_event(onTestStageChanged, { stage })
  },
}

/**
 * State needed to collect tests.
 *
 * Live only while tests are being defined.
 */
export interface DefinitionState {
  readonly kind: "definition"
  config: Config
  readonly rootBlock: DescribeBlock
  currentBlock: DescribeBlock
  currentTags?: TestTags
  hasFocusedTests: boolean
}

export interface TestState {
  readonly kind: "test"
  config: Config
  suite: TestSuite

  currentTestRun?: TestRun

  /** Replaced when a run starts, and outlives it: read by the getResults remote afterwards. */
  report: RunReport

  stage: TestStageStore
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

export type GlobalState = DefinitionState | TestState

let globalState: GlobalState | undefined

export function beginDefinition(config: Config): DefinitionState {
  const rootBlock = createRootDescribeBlock(config)
  const definition: DefinitionState = {
    kind: "definition",
    config,
    rootBlock,
    currentBlock: rootBlock,
    hasFocusedTests: false,
  }
  globalState = definition
  return definition
}

export function getDefinitionState(): DefinitionState {
  if (globalState?.kind === "definition") return globalState
  const testRun = globalState?.currentTestRun
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
export function endDefinition(stage: TestStageStore): TestState {
  const { config, rootBlock, hasFocusedTests } = getDefinitionState()
  const testState: TestState = {
    kind: "test",
    config,
    suite: { rootBlock, hasFocusedTests },
    report: createRunReport(),
    stage,
  }
  globalState = testState
  return testState
}

export function getTestState(): TestState {
  if (globalState?.kind === "test") return globalState
  error("Tests are not configured to be run")
}

export function setToLoadErrorState(state: TestState, error: string): void {
  state.stage.set(TestStage.LoadError)
  const rootBlock = createRootDescribeBlock(state.config)
  rootBlock.errors = [error]
  state.suite = { rootBlock, hasFocusedTests: false }
  state.currentTestRun = undefined
}

// internal, export for meta-test only
export function _getGlobalState(): GlobalState | undefined {
  return globalState
}

// internal, export for meta-test only
export function _setGlobalState(state: GlobalState | undefined): void {
  globalState = state
}

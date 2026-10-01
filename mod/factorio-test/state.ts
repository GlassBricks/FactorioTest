/** @noSelfInFile */
import { TestStage } from "../constants"
import type { ResumeData } from "./reload-resume"
import { createRunReport, RunReport } from "./results"
import { propagateTestMode } from "./test-mode"
import { createRootDescribeBlock, DescribeBlock, Test, TestSuite, TestTags } from "./tests"
import Config = FactorioTest.Config
import OnTickFn = FactorioTest.OnTickFn
import HookFn = FactorioTest.HookFn

export interface TestStageStore {
  get(): TestStage
  set(stage: TestStage): void
}

/** Run data that must survive a reload. */
export interface PersistedRunData {
  resume?: ResumeData
  lastFailedTests?: LuaSet<string>
}

/** Everything a run keeps outside of the Lua state; backed by `storage` in game. */
export interface RunStore {
  readonly stage: TestStageStore
  persisted(): PersistedRunData
}

/**
 * State needed to collect tests.
 *
 * Live only while tests are being defined.
 */
export interface DefinitionState {
  readonly kind: "definition"
  readonly config: Config
  readonly rootBlock: DescribeBlock
  currentBlock: DescribeBlock
  currentTags?: TestTags
  hasFocusedTests: boolean
}

export interface TestState {
  readonly kind: "test"
  readonly config: Config
  suite: TestSuite
  isRerun: boolean

  currentTestRun?: TestRun

  /** Replaced when a run starts, and outlives it: read by the getResults remote afterwards. */
  report: RunReport

  readonly store: RunStore
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

export type ContextState = DefinitionState | TestState

export class TestContext {
  state?: ContextState

  constructor(readonly store: RunStore) {}

  beginDefinition(config: Config): void {
    const rootBlock = createRootDescribeBlock(config)
    this.state = {
      kind: "definition",
      config,
      rootBlock,
      currentBlock: rootBlock,
      hasFocusedTests: false,
    }
  }

  definition(): DefinitionState {
    const { state } = this
    if (state?.kind === "definition") return state
    const testRun = state?.currentTestRun
    if (testRun) error(`Tests and hooks cannot be nested inside test "${testRun.test.path}"`)
    error(`Tests and hooks cannot be added/configured at this time`)
  }

  /** Seals the definition phase, and installs the state the resulting suite is run with. */
  endDefinition(): TestState {
    const definition = this.definition()
    const { config, rootBlock } = definition
    propagateTestMode(definition, rootBlock, undefined)
    const testState: TestState = {
      kind: "test",
      config,
      suite: { rootBlock, hasFocusedTests: definition.hasFocusedTests },
      isRerun: false,
      report: createRunReport(),
      store: this.store,
    }
    this.state = testState
    return testState
  }

  testState(): TestState {
    const { state } = this
    if (state?.kind === "test") return state
    error("Tests are not configured to be run")
  }
}

export function consumeTags(definition: DefinitionState): TestTags {
  const result = definition.currentTags
  definition.currentTags = undefined
  return result ?? new LuaSet()
}

export function setToLoadErrorState(state: TestState, error: string): void {
  state.store.stage.set(TestStage.LoadError)
  const rootBlock = createRootDescribeBlock(state.config)
  rootBlock.errors = [error]
  state.suite = { rootBlock, hasFocusedTests: false }
  state.currentTestRun = undefined
}

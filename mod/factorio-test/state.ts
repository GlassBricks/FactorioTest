/** @noSelfInFile */
import { TestStage } from "../constants"
import { createRunReport, RunReport } from "./results"
import { createRootDescribeBlock, DescribeBlock, Test, TestSuite, TestTags } from "./tests"
import Config = FactorioTest.Config
import OnTickFn = FactorioTest.OnTickFn
import HookFn = FactorioTest.HookFn

export interface TestStageStore {
  get(): TestStage
  set(stage: TestStage): void
}

/**
 * State needed to collect tests.
 *
 * Live only while tests are being defined.
 */
export interface DefinitionState {
  readonly kind: "definition"
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

export type ContextState = DefinitionState | TestState

export class TestContext {
  state?: ContextState

  constructor(
    public config: Config,
    readonly stage: TestStageStore,
  ) {}

  beginDefinition(): void {
    const rootBlock = createRootDescribeBlock(this.config)
    this.state = {
      kind: "definition",
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
    const { rootBlock, hasFocusedTests } = this.definition()
    const testState: TestState = {
      kind: "test",
      config: this.config,
      suite: { rootBlock, hasFocusedTests },
      report: createRunReport(),
      stage: this.stage,
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
  state.stage.set(TestStage.LoadError)
  const rootBlock = createRootDescribeBlock(state.config)
  rootBlock.errors = [error]
  state.suite = { rootBlock, hasFocusedTests: false }
  state.currentTestRun = undefined
}

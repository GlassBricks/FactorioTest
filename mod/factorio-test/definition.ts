/** @noSelfInFile */
import { peekTestState, initTestState, TestState } from "./state"
import { createRootDescribeBlock, DescribeBlock, TestTags } from "./tests"
import Config = FactorioTest.Config

/**
 * Everything needed to collect tests, and nothing else.
 *
 * Live only while tests are being defined; outside that, `getDefinitionState` is
 * what tells a caller it is using the DSL at the wrong time.
 */
export interface DefinitionState {
  config: Config
  readonly rootBlock: DescribeBlock
  currentBlock: DescribeBlock
  currentTags?: TestTags | undefined
  hasFocusedTests: boolean
}

let theDefinition: DefinitionState | undefined

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

/** Seals the definition phase, and installs the state the resulting suite is run with. */
export function endDefinition(): TestState {
  const { config, rootBlock, hasFocusedTests } = getDefinitionState()
  _clearDefinition()
  return initTestState(config, { rootBlock, hasFocusedTests })
}

// internal, export for meta-test only
export function _clearDefinition(): DefinitionState | undefined {
  const definition = theDefinition
  theDefinition = undefined
  return definition
}

export function getDefinitionState(what: string = "Tests and hooks"): DefinitionState {
  if (theDefinition) return theDefinition
  const testRun = peekTestState()?.currentTestRun
  if (testRun) error(`${what} cannot be nested inside test "${testRun.test.path}"`)
  error(`${what} cannot be added/configured at this time`)
}

export function consumeTags(): TestTags {
  const definition = getDefinitionState()
  const result = definition.currentTags
  definition.currentTags = undefined
  return result ?? new LuaSet()
}

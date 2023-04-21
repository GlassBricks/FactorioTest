import "__factorio-test__/luassert/init"
import { Remote, Settings, TestStage } from "../constants"
import { debugAdapterEnabled } from "./_util"
import { builtinTestEventListeners } from "./builtin-test-event-listeners"
import { fillConfig } from "./config"
import { addMessageHandler, debugAdapterLogger, logLogger } from "./output"
import { progressGuiListener, progressGuiLogger } from "./test-gui"
import { createTestRunner, TestRunner } from "./runner"
import { globals } from "./setup-globals"
import { getTestState, onTestStageChanged, resetTestState } from "./state"
import { addTestListener, clearTestListeners } from "./test-events"
import Config = FactorioTest.Config

declare const ____originalRequire: typeof require

function isRunning() {
  const stage = getTestState().getTestStage()
  return !(stage === TestStage.NotRun || stage === TestStage.LoadError || stage === TestStage.Finished)
}

// noinspection JSUnusedGlobalSymbols
export = function (files: string[], config: Partial<Config>): void {
  loadTests(files, config)
  remote.add_interface(Remote.FactorioTest, {
    runTests,
    modName: () => script.mod_name,
    getTestStage: () => getTestState().getTestStage(),
    isRunning,
    fireCustomEvent: (name, data) => {
      getTestState().raiseTestEvent({
        type: "customEvent",
        name,
        data,
      })
    },
    onTestStageChanged: () => onTestStageChanged,
    getResults: () => getTestState().results,
  })
  tapEvent(defines.events.on_game_created_from_scenario, runTests)
  tapEvent(defines.events.on_tick, tryContinueTests)
}

function loadTests(files: string[], partialConfig: Partial<Config>): void {
  const config = fillConfig(partialConfig)

  // load globals
  const defineGlobal = __DebugAdapter?.defineGlobal
  if (defineGlobal) {
    for (const key in globals) defineGlobal(key)
  }
  for (const [key, value] of pairs(globals)) {
    ;(globalThis as any)[key] = value
  }

  resetTestState(config)
  const state = getTestState()

  // load files
  const _require = settings.global[Settings.ModToTest]!.value === "factorio-test" ? require : ____originalRequire
  for (const file of files) {
    describe(file, () => _require(file))
  }
  state.currentBlock = undefined
}

function tryContinueTests() {
  const testStage = getTestState().getTestStage()
  if (testStage === TestStage.Running || testStage === TestStage.ReloadingMods) {
    doRunTests()
  } else {
    revertTappedEvents()
  }
}

function runTests() {
  if (isRunning()) return

  log(`Running tests for ${script.mod_name}`)
  getTestState().setTestStage(TestStage.Ready)
  doRunTests()
}

function doRunTests() {
  const state = getTestState()
  clearTestListeners()
  builtinTestEventListeners.forEach(addTestListener)
  if (game !== undefined) game.tick_paused = false
  addTestListener(progressGuiListener)
  addMessageHandler(progressGuiLogger)
  if (debugAdapterEnabled) {
    addMessageHandler(debugAdapterLogger)
  } else {
    addMessageHandler(logLogger)
  }

  let runner: TestRunner | undefined
  tapEvent(defines.events.on_tick, () => {
    if (!runner) {
      runner = createTestRunner(state)
    }
    runner.tick()
    if (runner.isDone()) {
      revertTappedEvents()
    }
  })
}

const tappedHandlers: Record<defines.events, [((data: any) => void) | undefined, () => void]> = {}
let onEventTapped = false
const oldOnEvent = script.on_event

function tapEvent(event: defines.events, func: () => void) {
  if (!tappedHandlers[event]) {
    tappedHandlers[event] = [script.get_event_handler(event), func]
    oldOnEvent(event, (data) => {
      const handlers = tappedHandlers[event]!
      handlers[0]?.(data)
      handlers[1]()
    })
  } else {
    tappedHandlers[event]![1] = func
  }

  if (!onEventTapped) {
    onEventTapped = true

    script.on_event = (event: any, func: any) => {
      const handler = tappedHandlers[event]
      if (handler) {
        handler[0] = func
      } else {
        oldOnEvent(event, func)
      }
    }
  }
}

function revertTappedEvents() {
  script.on_event = oldOnEvent
  for (const [event, handler] of pairs(tappedHandlers)) {
    delete tappedHandlers[event]
    script.on_event(event, handler[0])
  }
  onEventTapped = false
}

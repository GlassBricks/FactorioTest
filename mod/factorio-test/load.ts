import { Remote, Settings, TestStage } from "../constants"
import { getAutoStartMod, isHeadlessMode } from "./auto-start-config"
import { debugAdapterEnabled } from "./_util"
import { builtinTestEventListeners } from "./builtin-test-event-listeners"
import { cliEventEmitter } from "./cli-events"
import { initializeFailedTestsFromConfig } from "./failed-test-storage"
import { fillConfig } from "./config"
import { addMessageHandler, debugAdapterLogger, logLogger } from "./output"
import { progressGuiListener, progressGuiLogger } from "./test-gui"
import { createTestRunner, TestRunner } from "./runner"
import { globals } from "./setup-globals"
import { getTestState, onTestStageChanged, requestStepAction, resetTestState, StepAction } from "./state"
import { addTestListener, clearTestListeners } from "./test-events"
import { LuaBootstrap } from "factorio:runtime"
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
    cancelTestRun,
    stepAction: (action: StepAction) => requestStepAction(action),
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
    getConfig: () => getTestState().config,
  })
  tapEvent(defines.events.on_tick, tryContinueTests)
}

function loadTests(files: string[], partialConfig: Partial<Config>): void {
  const config = fillConfig(partialConfig)

  if (config.load_luassert) {
    debug.getmetatable = getmetatable
    require("@NoResolution:__factorio-test__/luassert/init")
  }

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

  const autoStartMod = getAutoStartMod()
  const manualMod = settings.global[Settings.ModToTest]!.value
  const modToTest = autoStartMod || manualMod
  const _require = modToTest === "factorio-test" ? require : ____originalRequire
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

let currentRunner: TestRunner | undefined

function runTests() {
  if (isRunning()) return

  log(`Running tests for ${script.mod_name}`)
  getTestState().setTestStage(TestStage.Ready)
  doRunTests()
}

function cancelTestRun() {
  // may be cancelled while frozen at a step; the runner needs ticks to wind the run down
  if (game !== undefined) game.tick_paused = false
  currentRunner?.requestCancel()
}

function doRunTests() {
  const state = getTestState()
  initializeFailedTestsFromConfig()
  clearTestListeners()
  const headless = isHeadlessMode()
  if (headless) {
    addTestListener(cliEventEmitter)
    if (state.config.step) {
      log("factorio-test: step requires graphics mode (there is no GUI to continue from); ignoring it")
      state.config.step = false
    }
  }
  builtinTestEventListeners.forEach(addTestListener)
  if (game !== undefined) game.tick_paused = false

  if (!headless) {
    addTestListener(progressGuiListener)
    addMessageHandler(progressGuiLogger)
  }

  if (debugAdapterEnabled) {
    addMessageHandler(debugAdapterLogger)
  } else if (!headless) {
    addMessageHandler(logLogger)
  }

  tapEvent(defines.events.on_tick, () => {
    if (!currentRunner) {
      currentRunner = createTestRunner(state)
    }
    currentRunner.tick()
    if (currentRunner.isDone()) {
      currentRunner = undefined
      revertTappedEvents()
    } else if (game !== undefined && !state.stepPause) {
      // A test hook may have paused the game (e.g. entering the map editor pauses by default
      // since 2.1). The runner is driven by on_tick, which only fires while ticks advance, so
      // keep the game unpaused for the duration of the run -- except while step mode is
      // deliberately holding the world still, waiting for the user.
      game.tick_paused = false
    }
  })
}

const tappedHandlers: Record<defines.events, [((data: any) => void) | undefined, () => void]> = {}
const oldScript: LuaBootstrap = script

function tapEvent(event: defines.events, func: () => void) {
  if (!tappedHandlers[event]) {
    tappedHandlers[event] = [script.get_event_handler(event), func]
    oldScript.on_event(event, (data) => {
      const handlers = tappedHandlers[event]!
      handlers[0]?.(data)
      handlers[1]()
    })
  } else {
    tappedHandlers[event]![1] = func
  }

  if (rawequal(script, oldScript)) {
    const proxyScript = {
      on_event(this: void, event: any, func: any) {
        const handler = tappedHandlers[event]
        if (handler) {
          handler[0] = func
        } else {
          oldScript.on_event(event, func)
        }
      },
    }
    setmetatable(proxyScript, {
      __index: oldScript,
      __newindex: oldScript,
    })
    ;(_G as any).script = proxyScript
  }
}

function revertTappedEvents() {
  ;(_G as any).script = oldScript
  for (const [event, handler] of pairs(tappedHandlers)) {
    tappedHandlers[event] = undefined!
    script.on_event(event, handler[0])
  }
}

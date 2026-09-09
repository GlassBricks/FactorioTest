import { Remote, Settings, TestStage } from "../constants"
import { getAutoStartMod, isHeadlessMode } from "./shared/auto-start-config"
import { debugAdapterEnabled } from "./shared/util"
import { builtinTestEventListeners } from "./builtin-test-event-listeners"
import { cliEventEmitter } from "./cli-events"
import { initializeFailedTestsFromConfig } from "./failed-test-storage"
import { resultCollector } from "./results"
import { fillConfig } from "./config"
import { addMessageHandler, debugAdapterLogger, logLogger } from "./output"
import { progressGuiListener, progressGuiLogger } from "./test-gui"
import { createTestRunner, TestRunner } from "./runner"
import { globals } from "./setup-globals"
import { getTestState, onTestStageChanged, resetTestState } from "./state"
import { addTestListener, clearTestListeners } from "./test-events"
import { LuaBootstrap } from "factorio:runtime"
import Config = FactorioTest.Config

declare const ____originalRequire: typeof require

function isRunning() {
  const stage = getTestState().env.getTestStage()
  return !(stage === TestStage.NotRun || stage === TestStage.LoadError || stage === TestStage.Finished)
}

// noinspection JSUnusedGlobalSymbols
export = function (files: string[], config: Partial<Config>): void {
  loadTests(files, config)
  remote.add_interface(Remote.FactorioTest, {
    runTests,
    cancelTestRun,
    modName: () => script.mod_name,
    getTestStage: () => getTestState().env.getTestStage(),
    isRunning,
    fireCustomEvent: (name, data) => {
      getTestState().env.emit({
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
  const testStage = getTestState().env.getTestStage()
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
  getTestState().env.setTestStage(TestStage.Ready)
  doRunTests()
}

function cancelTestRun() {
  currentRunner?.requestCancel()
}

function wireListeners(headless: boolean) {
  clearTestListeners()
  // resultCollector must run first; every other listener reads state.results.
  addTestListener(resultCollector)
  if (headless) {
    // cliEventEmitter must run before builtins, since setupListener ends the
    // headless process.
    addTestListener(cliEventEmitter)
  }
  builtinTestEventListeners.forEach(addTestListener)

  if (!headless) {
    addTestListener(progressGuiListener)
    addMessageHandler(progressGuiLogger)
  }

  if (debugAdapterEnabled) {
    addMessageHandler(debugAdapterLogger)
  } else if (!headless) {
    addMessageHandler(logLogger)
  }
}

function doRunTests() {
  const state = getTestState()
  initializeFailedTestsFromConfig()
  wireListeners(isHeadlessMode())
  if (game !== undefined) game.tick_paused = false

  tapEvent(defines.events.on_tick, () => {
    if (!currentRunner) {
      currentRunner = createTestRunner(state)
    }
    currentRunner.tick()
    if (currentRunner.isDone()) {
      currentRunner = undefined
      revertTappedEvents()
    } else if (game !== undefined) {
      // A test hook may have paused the game (e.g. entering the map editor pauses by default
      // since 2.1). The runner is driven by on_tick, which only fires while ticks advance, so
      // keep the game unpaused for the duration of the run.
      game.tick_paused = false
    }
  })
}

interface TappedHandler {
  /** The mod-under-test's own handler, restored when the run ends. */
  original: ((this: void, data: any) => void) | undefined
  ours: (this: void) => void
}

const tappedHandlers: Record<defines.events, TappedHandler> = {}
const oldScript: LuaBootstrap = script

function tapEvent(event: defines.events, func: () => void) {
  const existing = tappedHandlers[event]
  if (existing) {
    existing.ours = func
  } else {
    tappedHandlers[event] = { original: script.get_event_handler(event), ours: func }
    oldScript.on_event(event, (data) => {
      const handlers = tappedHandlers[event]!
      handlers.original?.(data)
      handlers.ours()
    })
  }

  if (rawequal(script, oldScript)) {
    const proxyScript = {
      on_event(this: void, event: any, func: any) {
        const handler = tappedHandlers[event]
        if (handler) {
          handler.original = func
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
    script.on_event(event, handler.original)
  }
}

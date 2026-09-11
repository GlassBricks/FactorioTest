import { LuaBootstrap } from "factorio:runtime"
import { Remote, Settings, TestStage } from "../constants"
import { gameEnvironmentListener, resultListener } from "./builtin-test-event-listeners"
import { cliEventEmitter } from "./cli-events"
import { fillConfig } from "./config"
import { failedTestCollector, initializeFailedTestsFromConfig } from "./failed-test-storage"
import { createLogListener, debugAdapterLogger, logLogger, MessageHandler } from "./output"
import { resultCollector } from "./results"
import { TestRunner } from "./runner"
import { globals } from "./setup-globals"
import { getAutoStartMod, isHeadlessMode } from "./shared/auto-start-config"
import { debugAdapterEnabled } from "./shared/util"
import { beginDefinition, endDefinition, getTestState, globalTestStage, onTestStageChanged } from "./state"
import { TestEventListener } from "./test-events"
import { progressGuiListener, progressGuiLogger } from "./test-gui"
import Config = FactorioTest.Config

declare const ____originalRequire: typeof require

function isRunning() {
  const stage = getTestState().stage.get()
  return !(stage === TestStage.NotRun || stage === TestStage.LoadError || stage === TestStage.Finished)
}

// noinspection JSUnusedGlobalSymbols
export = function (files: string[], config: Partial<Config>): void {
  loadTests(files, config)
  remote.add_interface(Remote.FactorioTest, {
    runTests,
    cancelTestRun,
    modName: () => script.mod_name,
    getTestStage: () => getTestState().stage.get(),
    isRunning,
    onTestStageChanged: () => onTestStageChanged,
    getResults: () => getTestState().report.results,
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

  beginDefinition(config)

  const autoStartMod = getAutoStartMod()
  const manualMod = settings.global[Settings.ModToTest]!.value
  const modToTest = autoStartMod || manualMod
  const _require = modToTest === "factorio-test" ? require : ____originalRequire
  for (const file of files) {
    describe(file, () => _require(file))
  }
  endDefinition(globalTestStage)
}

function createMessageHandlers(headless: boolean): MessageHandler[] {
  const handlers: MessageHandler[] = []
  if (!headless) handlers.push(progressGuiLogger)
  if (debugAdapterEnabled) {
    handlers.push(debugAdapterLogger)
  } else if (!headless) {
    handlers.push(logLogger)
  }
  return handlers
}

function createTestListeners(headless: boolean): TestEventListener[] {
  // resultCollector must run first; every other listener reads report.results.
  const listeners: TestEventListener[] = [resultCollector]
  if (headless) listeners.push(cliEventEmitter)
  // resultListener ends the headless process, so what follows it only runs in-game.
  listeners.push(gameEnvironmentListener, resultListener)
  listeners.push(createLogListener(createMessageHandlers(headless)), failedTestCollector)
  if (!headless) listeners.push(progressGuiListener)
  return listeners
}

const testListeners = createTestListeners(isHeadlessMode())

function tryContinueTests() {
  const testStage = getTestState().stage.get()
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
  getTestState().stage.set(TestStage.Ready)
  doRunTests()
}

function cancelTestRun() {
  currentRunner?.requestCancel()
}

function doRunTests() {
  initializeFailedTestsFromConfig()
  if (game !== undefined) game.tick_paused = false

  const runner = new TestRunner(getTestState(), testListeners)
  currentRunner = runner
  tapEvent(defines.events.on_tick, () => {
    runner.tick()
    if (runner.isDone()) {
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

const tappedHandlers: Partial<Record<defines.events, TappedHandler>> = {}
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
    tappedHandlers[event] = undefined
    script.on_event(event, handler.original)
  }
}

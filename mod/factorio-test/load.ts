import { LuaBootstrap } from "factorio:runtime"
import * as util from "util"
import { Remote, Settings, TestStage } from "../constants"
import { gameEnvironmentListener, resultListener } from "./builtin-test-event-listeners"
import { cliEventEmitter } from "./cli-events"
import { resolveConfig } from "./config"
import { createLogListener, debugAdapterLogger, logLogger, MessageHandler } from "./output"
import { TestRunner } from "./runner"
import { createTestApi } from "./setup-globals"
import { getAutoStartConfig, getAutoStartMod, isHeadlessMode } from "./shared/auto-start-config"
import { debugAdapterEnabled } from "./shared/util"
import { RunStore, TestContext } from "./state"
import { testStorage } from "./storage"
import { TestEventListener } from "./test-events"
import { progressGuiListener, progressGuiLogger } from "./test-gui"
import Config = FactorioTest.Config

declare const ____originalRequire: typeof require

const onTestStageChanged = script.generate_event_name<{ stage: TestStage }>()

const storageRunStore: RunStore = {
  stage: {
    get: () => testStorage().testStage ?? TestStage.NotRun,
    set: (stage) => {
      testStorage().testStage = stage
      script.raise_event(onTestStageChanged, { stage })
    },
  },
  persisted: () => testStorage(),
}

let testContext: TestContext

function isRunning() {
  const stage = testContext.store.stage.get()
  return !(stage === TestStage.NotRun || stage === TestStage.LoadError || stage === TestStage.Finished)
}

// noinspection JSUnusedGlobalSymbols
export = function (files: string[], config: Partial<Config>): void {
  testContext = loadTests(files, config)
  remote.add_interface(Remote.FactorioTest, {
    runTests,
    cancelTestRun,
    modName: () => script.mod_name,
    getTestStage: () => testContext.store.stage.get(),
    isRunning,
    onTestStageChanged: () => onTestStageChanged,
    getResults: () => testContext.testState().report.results,
    getConfig: () => testContext.testState().config,
  })
  tapEvent(defines.events.on_tick, tryContinueTests)
}

function loadTests(files: string[], partialConfig: Partial<Config>): TestContext {
  const config = resolveConfig(partialConfig)

  if (config.load_luassert) {
    debug.getmetatable = getmetatable
    require("@NoResolution:__factorio-test__/luassert/init")
  }

  const context = new TestContext(storageRunStore)
  const globals = createTestApi(context)
  const defineGlobal = __DebugAdapter?.defineGlobal
  if (defineGlobal) {
    for (const key in globals) defineGlobal(key)
  }
  for (const [key, value] of pairs(globals)) {
    ;(globalThis as any)[key] = value
  }

  const modToTest = getAutoStartMod() || settings.global[Settings.ModToTest]!.value
  const _require = modToTest === "factorio-test" ? require : ____originalRequire

  context.beginDefinition(config)
  for (const file of files) {
    globals.describe(file, () => _require(file))
  }
  context.endDefinition()
  return context
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
  const listeners: TestEventListener[] = []
  if (headless) listeners.push(cliEventEmitter)
  // resultListener ends the headless process, so what follows it only runs in-game.
  listeners.push(gameEnvironmentListener, resultListener)
  listeners.push(createLogListener(createMessageHandlers(headless)))
  if (!headless) listeners.push(progressGuiListener)
  return listeners
}

function initializeFailedTestsFromConfig(): void {
  const storage = testStorage()
  if (storage.lastFailedTests !== undefined) return

  const fromConfig = getAutoStartConfig().last_failed_tests
  if (fromConfig && fromConfig.length > 0) {
    storage.lastFailedTests = util.list_to_map(fromConfig)
  }
}

function tryContinueTests() {
  const testStage = testContext.store.stage.get()
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
  testContext.store.stage.set(TestStage.Ready)
  doRunTests()
}

function cancelTestRun() {
  currentRunner?.requestCancel()
}

function doRunTests() {
  initializeFailedTestsFromConfig()
  if (game !== undefined) game.tick_paused = false

  const testListeners = createTestListeners(isHeadlessMode())
  const runner = new TestRunner(testContext.testState(), testListeners)
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

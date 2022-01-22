import "__testorio__/luassert/init"
import { Remote, TestStage } from "../shared-constants"
import { assertNever } from "./_util"
import { builtinTestListeners } from "./builtinTestListeners"
import { fillConfig } from "./config"
import { addLogHandler, debugAdapterEnabled, debugAdapterLogger, gameLogger, LogLevel, setLogLevel } from "./log"
import { progressGuiListener, progressGuiLogger } from "./progressGui"
import { createRunner, TestRunner } from "./runner"
import { globals } from "./setup"
import { getTestState, resetTestState, TestState } from "./state"
import { addTestListeners } from "./testEvents"
import Config = Testorio.Config

declare const ____originalRequire: typeof require

export function load(this: unknown, files: string[], config: Partial<Config>): void {
  loadTests(files, config)
  remote.add_interface(Remote.RunTests, {
    runTests,
    modName: () => script.mod_name,
    currentTestStage: () => getTestState().getTestStage(),
  })
  addOnEvent(defines.events.on_game_created_from_scenario, runTests)
  addOnEvent(defines.events.on_tick, tryContinueTests)
}

function loadTests(files: string[], partialConfig: Partial<Config>): TestState {
  const config = fillConfig(partialConfig)
  Object.assign(globalThis, globals)
  resetTestState(config)
  const state = getTestState()

  ticks_between_tests(config.default_ticks_between_tests)
  const _require = settings.global["testorio:test-mod"].value === "testorio" ? require : ____originalRequire
  for (const file of files) {
    describe(file, () => {
      _require(file)
    })
  }
  state.currentBlock = undefined
  return state
}

addTestListeners(...builtinTestListeners)

function tryContinueTests() {
  const testStage = getTestState().getTestStage()
  if (testStage === TestStage.Running || testStage === TestStage.ToReload) {
    runTests()
  } else {
    revertPatchedEvents()
  }
}

function runTests() {
  log("Running tests")
  let runner: TestRunner | undefined
  if (game) game.tick_paused = false

  const state = getTestState()
  const { config } = state
  if (config.show_progress_gui) {
    addTestListeners(progressGuiListener)
    addLogHandler(progressGuiLogger)
  }
  if (config.log_to_game) {
    addLogHandler(gameLogger)
  }
  if (config.log_to_DA && debugAdapterEnabled) {
    addLogHandler(debugAdapterLogger)
  }
  if (config.log_to_log || (config.log_to_DA && !debugAdapterEnabled)) {
    addLogHandler((_, message) => {
      log(message)
    })
  }
  if (config.log_level === "trace") {
    setLogLevel(LogLevel.Trace)
  } else if (config.log_level === "debug") {
    setLogLevel(LogLevel.Debug)
  } else if (config.log_level === "basic") {
    setLogLevel(LogLevel.Info)
  } else {
    assertNever(config.log_level)
  }

  config.before_test_run?.()
  addOnEvent(defines.events.on_tick, () => {
    if (!runner) {
      runner = createRunner(state)
    }
    runner.tick()
    if (runner.isDone()) {
      revertPatchedEvents()
      config.after_test_run?.()
    }
  })
}

const patchedHandlers: Record<defines.Events, [handler?: (data: any) => void]> = {}
let scriptPatched = false
const oldOnEvent = script.on_event

function addOnEvent(event: defines.Events, func: () => void) {
  if (!patchedHandlers[event]) {
    patchedHandlers[event] = [script.get_event_handler(event)]
  }

  oldOnEvent(event, (data) => {
    patchedHandlers[event][0]?.(data)
    func()
  })

  if (!scriptPatched) {
    scriptPatched = true

    script.on_event = (event: any, func: any) => {
      const handler = patchedHandlers[event]
      if (handler) {
        handler[0] = func
      } else {
        oldOnEvent(event, func)
      }
    }
  }
}

function revertPatchedEvents() {
  script.on_event = oldOnEvent
  for (const [event, handler] of pairs(patchedHandlers)) {
    delete patchedHandlers[event]
    script.on_event(event, handler[0])
  }
}

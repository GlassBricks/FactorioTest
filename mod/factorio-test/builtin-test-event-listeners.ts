import { Settings } from "../constants"
import { logListener } from "./output"
import { resultCollector } from "./results"
import { TestEventListener } from "./test-events"
import { cleanupTestState } from "./state"

function emitResult(status: string) {
  print("FACTORIO-TEST-RESULT:" + status)
  if (settings.startup[Settings.AutoStart]?.value === "headless") {
    error("FACTORIO-TEST-EXIT")
  }
}

const setupListener: TestEventListener = (event, state) => {
  if (event.type === "testRunStarted") {
    game.speed = state.config.game_speed
    game.autosave_enabled = false
    state.config.before_test_run?.()
  } else if (event.type === "testRunFinished") {
    game.speed = 1
    const status = state.results.status!
    if (state.config.sound_effects) {
      const passed = status === "passed" || status === "todo"
      game.play_sound({ path: passed ? "utility/game_won" : "utility/game_lost" })
    }

    state.config.after_test_run?.()
    cleanupTestState()

    emitResult(status)
  } else if (event.type === "loadError") {
    game.speed = 1
    game.play_sound({ path: "utility/console_message" })

    emitResult("loadError")
  }
}

export const builtinTestEventListeners: TestEventListener[] = [resultCollector, setupListener, logListener]

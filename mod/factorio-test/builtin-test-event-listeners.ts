import { Protocol } from "../constants"
import { logListener } from "./output"
import { TestEventListener } from "./test-events"
import { cleanupTestState } from "./state"
import { isHeadlessMode } from "./shared/auto-start-config"
import { failedTestCollector } from "./failed-test-storage"

function emitResult(status: string) {
  print(Protocol.Result + status)
  if (isHeadlessMode()) {
    error(Protocol.Exit)
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

    const bailedPrefix = state.run.bailedOut ? "bailed:" : ""
    const focusedSuffix = state.hasFocusedTests ? ":focused" : ""

    state.config.after_test_run?.()
    cleanupTestState()
    emitResult(bailedPrefix + status + focusedSuffix)
  } else if (event.type === "testRunCancelled") {
    game.speed = 1
    if (state.config.sound_effects) {
      game.play_sound({ path: "utility/console_message" })
    }
    const status = state.run.bailedOut ? "bailed" : "cancelled"

    state.config.after_test_run?.()
    cleanupTestState()
    emitResult(status)
  } else if (event.type === "loadError") {
    game.speed = 1
    game.play_sound({ path: "utility/console_message" })

    emitResult("loadError")
  }
}

export const builtinTestEventListeners: TestEventListener[] = [setupListener, logListener, failedTestCollector]

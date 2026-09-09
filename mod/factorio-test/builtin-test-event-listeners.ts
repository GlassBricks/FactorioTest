import { Protocol } from "../constants"
import { logListener } from "./output"
import { TestEventListener } from "./test-events"
import { cleanupTestState, TestState } from "./state"
import { isHeadlessMode } from "./shared/auto-start-config"
import { failedTestCollector } from "./failed-test-storage"

function emitResult(status: string) {
  print(Protocol.Result + status)
  if (isHeadlessMode()) {
    error(Protocol.Exit)
  }
}

const gameEnvironmentListener: TestEventListener = (event, state) => {
  switch (event.type) {
    case "testRunStarted":
      game.speed = state.config.game_speed
      game.autosave_enabled = false
      state.config.before_test_run?.()
      break
    case "testRunFinished": {
      game.speed = 1
      if (state.config.sound_effects) {
        const passed = state.results.status === "passed" || state.results.status === "todo"
        game.play_sound({ path: passed ? "utility/game_won" : "utility/game_lost" })
      }
      break
    }
    case "testRunCancelled":
      game.speed = 1
      if (state.config.sound_effects) {
        game.play_sound({ path: "utility/console_message" })
      }
      break
    case "loadError":
      game.speed = 1
      game.play_sound({ path: "utility/console_message" })
      break
  }
}

function endRun(state: TestState, status: string): void {
  state.config.after_test_run?.()
  cleanupTestState()
  emitResult(status)
}

/** emitResult aborts the process in headless mode, so this must be the last thing a run does. */
const resultListener: TestEventListener = (event, state) => {
  switch (event.type) {
    case "testRunFinished": {
      const bailedPrefix = state.run.bailedOut ? "bailed:" : ""
      const focusedSuffix = state.hasFocusedTests ? ":focused" : ""
      endRun(state, bailedPrefix + state.results.status! + focusedSuffix)
      break
    }
    case "testRunCancelled":
      endRun(state, state.run.bailedOut ? "bailed" : "cancelled")
      break
    case "loadError":
      emitResult("loadError")
      break
  }
}

export const builtinTestEventListeners: TestEventListener[] = [
  gameEnvironmentListener,
  resultListener,
  logListener,
  failedTestCollector,
]

import { Protocol } from "../constants"
import { logListener } from "./output"
import { TestEventContext, TestEventListener } from "./test-events"
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
        const passed = state.report!.results.status === "passed" || state.report!.results.status === "todo"
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

function endRun(state: TestEventContext, status: string): void {
  state.config.after_test_run?.()
  emitResult(status)
}

/** emitResult aborts the process in headless mode, so this must be the last thing a run does. */
const resultListener: TestEventListener = (event, state) => {
  switch (event.type) {
    case "testRunFinished": {
      const bailedPrefix = state.report!.bailedOut ? "bailed:" : ""
      const focusedSuffix = state.suite.hasFocusedTests ? ":focused" : ""
      endRun(state, bailedPrefix + state.report!.results.status! + focusedSuffix)
      break
    }
    case "testRunCancelled":
      endRun(state, state.report!.bailedOut ? "bailed" : "cancelled")
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

import { Protocol } from "../constants"
import { TestEventContext, TestEventListener } from "./test-events"
import { isHeadlessMode } from "./shared/auto-start-config"

function emitResult(status: string) {
  print(Protocol.Result + status)
  if (isHeadlessMode()) {
    error(Protocol.Exit)
  }
}

export const gameEnvironmentListener: TestEventListener = (event, state) => {
  switch (event.type) {
    case "testRunStarted":
      game.speed = state.config.step ? 1 : state.config.game_speed
      game.autosave_enabled = false
      state.config.before_test_run?.()
      break
    case "testRunFinished": {
      game.speed = 1
      if (state.config.sound_effects) {
        const passed = state.report.results.status === "passed" || state.report.results.status === "todo"
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
    case "stepPaused":
      game.tick_paused = true
      break
    case "stepResumed":
      game.tick_paused = false
      if (event.action === "runRest") game.speed = state.config.game_speed
      break
  }
}

function endRun(state: TestEventContext, status: string): void {
  state.config.after_test_run?.()
  emitResult(status)
}

/** emitResult aborts the process in headless mode, so nothing after this runs there. */
export const resultListener: TestEventListener = (event, state) => {
  switch (event.type) {
    case "testRunFinished": {
      const bailedPrefix = state.report.bailedOut ? "bailed:" : ""
      const focusedSuffix = state.suite.hasFocusedTests ? ":focused" : ""
      endRun(state, bailedPrefix + state.report.results.status! + focusedSuffix)
      break
    }
    case "testRunCancelled":
      endRun(state, state.report.bailedOut ? "bailed" : "cancelled")
      break
    case "loadError":
      emitResult("loadError")
      break
  }
}

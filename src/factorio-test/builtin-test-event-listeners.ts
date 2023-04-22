import { logListener } from "./output"
import { resultCollector } from "./results"
import { TesteEventListener } from "./test-events"
import { cleanupTestState } from "./state"

const setupListener: TesteEventListener = (event, state) => {
  if (event.type === "testRunStarted") {
    game.speed = state.config.game_speed
    game.autosave_enabled = false
    state.config.before_test_run?.()
  } else if (event.type === "testRunFinished") {
    game.speed = 1
    const status = state.results.status;
    if (state.config.sound_effects) {
      const passed = status === "passed" || status === "todo"
      if (passed) {
        game.play_sound({ path: "utility/game_won" })
      } else {
        game.play_sound({ path: "utility/game_lost" })
      }
    }
    print("FACTORIO-TEST:" + status) // signal to cli

    state.config.after_test_run?.()
    cleanupTestState()

  } else if (event.type === "loadError") {
    game.speed = 1
    game.play_sound({ path: "utility/console_message" })
  }
}

export const builtinTestEventListeners: TesteEventListener[] = [resultCollector, setupListener, logListener]

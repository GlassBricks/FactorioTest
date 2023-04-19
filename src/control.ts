import "./control/index"
import { Settings } from "./constants"

// Only load self-tests when factorio-test-test-mod is also present
// so users get less confused
if (script.active_mods["__factorio-test-test-mod"]) {
  require("__factorio-test__/init")(["test.meta.test", "test.reload.test"], {
    sound_effects: true,
    after_test_run() {
      const results = remote.call("factorio-test", "getResults") as any
      if (results.status === "passed") {
        settings.global[Settings.TestMod] = { value: "__factorio-test-test-mod" }
        game.reload_mods()
      }
    },
  })
}

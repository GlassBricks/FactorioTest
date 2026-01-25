import "./control/index"
import { Settings } from "./constants"

// Only load self-tests with auto start, so users get less confused
if (
  settings.startup[Settings.AutoStart]!.value !== "false" &&
  settings.startup[Settings.AutoStartMod]!.value === script.mod_name
) {
  require("__factorio-test__/init")(["test.meta.test", "test.reload.test"])
}

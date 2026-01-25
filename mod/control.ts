import "./control/index"
import { isAutoStartEnabled, getAutoStartMod } from "./factorio-test/auto-start-config"

const shouldAutoStart = isAutoStartEnabled() && getAutoStartMod() === script.mod_name
if (shouldAutoStart) {
  require("__factorio-test__/init")(["test.meta.test", "test.reload.test"])
}

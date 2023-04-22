import "./control/index"

// Only load self-tests when usage-test-mod is also present, so users get less confused
if (script.active_mods["__factorio-usage-test-mod"]) {
  require("__factorio-test__/init")(["test.meta.test", "test.reload.test"])
}

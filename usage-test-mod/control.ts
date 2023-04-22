declare const __DebugAdapter: any
declare const global: any
if ("factorio-test" in script.active_mods) {
  require("__factorio-test__/init")(["test1", "folder/test2"], {
    tag_blacklist: ["no"],
    log_passed_tests: true,
    log_skipped_tests: true,
    sound_effects: true,
    after_test_run() {
      global._ranTests = true
      const results = remote.call("factorio-test", "getResults") as any
      const expected = {
        failed: 1,
        passed: 5,
        skipped: 2,
        todo: 1,
        describeBlockErrors: 2,
        status: "failed",
      }
      let match = true
      for (const [key, value] of pairs(expected)) {
        if (results[key] !== value) {
          match = false
          break
        }
      }
      if (match) {
        settings.global["__factorio-usage-test-mod:state"] = { value: "terminate" }
        game.reload_mods()
      } else {
        game.print("Test results does not match expected!")
      }
    },
  } satisfies Partial<FactorioTest.Config>)
  if (
    settings.global["__factorio-usage-test-mod:state"].value === "terminate" &&
    script.active_mods.debugadapter !== undefined
  ) {
    require("@NoResolution:__debugadapter__/debugadapter.lua")
    __DebugAdapter.terminate()
  }
  if (settings.global["factorio-test-mod-to-test"].value === script.mod_name) {
    script.on_event(defines.events.on_tick, () => {
      script.on_event(defines.events.on_tick, undefined)
      if(!global._ranTests) {
        remote.call("factorio-test", "runTests")
      }
    })
  }
}

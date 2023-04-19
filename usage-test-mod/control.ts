declare const __DebugAdapter: any
if ("factorio-test" in script.active_mods) {
  require("__factorio-test__/init")(["test1", "folder/test2", "folder/inWorld"], {
    tag_blacklist: ["no"],
    log_passed_tests: true,
    log_skipped_tests: true,
    sound_effects: true,
    after_test_run() {
      const results = remote.call("factorio-test", "getResults") as any
      const expected = {
        failed: 1,
        passed: 6,
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
        settings.global["__factorio-test-test-mod:state"] = { value: "terminate" }
        game.reload_mods()
      } else {
        game.print("Test results does not match expected!")
      }
    },
  })
  if (
    settings.global["__factorio-test-test-mod:state"].value === "terminate" &&
    script.active_mods.debugadapter !== undefined
  ) {
    require("@NoResolution:__debugadapter__/debugadapter.lua")
    __DebugAdapter.terminate()
  }
  if (settings.global["factorio-test:test-mod"].value === script.mod_name) {
    script.on_event(defines.events.on_tick, () => {
      script.on_event(defines.events.on_tick, undefined)
      remote.call("factorio-test", "runTests")
    })
  }
}

if ("factorio-test" in script.active_mods) {
  require("__factorio-test__/init")(["test1", "folder/test2"], {
    tag_blacklist: ["no"],
    log_passed_tests: true,
    log_skipped_tests: true,
    sound_effects: true,
    after_test_run() {
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
      print("FACTORIO-TEST-MESSAGE-START")
      if(match) {
        log("Usage test mod result: passed")
      } else {
        log("Usage test mod result: failed")
      }
      print("FACTORIO-TEST-MESSAGE-END")
    },
  } satisfies Partial<FactorioTest.Config>)
}

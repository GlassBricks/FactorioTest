if ("factorio-test" in script.active_mods) {
  require("__factorio-test__/init")(["tests"], {
    after_test_run() {
      print("FACTORIO-TEST-MESSAGE-START")
      log("only-test-mod: completed")
      print("FACTORIO-TEST-MESSAGE-END")
    },
  })
}

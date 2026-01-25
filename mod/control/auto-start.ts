import { Remote } from "../constants"
import { getAutoStartConfig, isAutoStartEnabled, isHeadlessMode } from "../factorio-test/auto-start-config"
import { LocalisedString } from "factorio:runtime"

script.on_load(() => {
  if (!isAutoStartEnabled()) return

  const headless = isHeadlessMode()
  const modToTest = getAutoStartConfig().mod!

  script.on_event(defines.events.on_tick, () => {
    script.on_event(defines.events.on_tick, undefined)

    function autoStartError(message: LocalisedString) {
      if (!headless) game.print(message)
      log(message)
      print("FACTORIO-TEST-MESSAGE-START")
      log(message)
      print("FACTORIO-TEST-MESSAGE-END")
      print("FACTORIO-TEST-RESULT:could not auto start")
      if (headless) error("FACTORIO-TEST-EXIT")
    }

    if (!(modToTest in script.active_mods)) {
      return autoStartError(`Cannot auto-start tests: mod ${modToTest} is not active.`)
    }

    if (remote.interfaces[Remote.FactorioTest] == undefined) {
      return autoStartError("Cannot auto-start tests: the selected mod is not registered with Factorio Test.")
    }

    remote.call(Remote.FactorioTest, "runTests", modToTest)
  })
})

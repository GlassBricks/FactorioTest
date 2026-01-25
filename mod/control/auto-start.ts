import { Remote, Settings } from "../constants"
import { LocalisedString } from "factorio:runtime"

script.on_load(() => {
  const autoStart = settings.startup[Settings.AutoStart]!.value as string
  if (autoStart === "false") return

  const headless = autoStart === "headless"

  script.on_event(defines.events.on_tick, () => {
    script.on_event(defines.events.on_tick, undefined)

    const modToTest = settings.startup[Settings.AutoStartMod]!.value as string

    function autoStartError(message: LocalisedString) {
      if (!headless) game.print(message)
      log(message)
      print("FACTORIO-TEST-MESSAGE-START")
      log(message)
      print("FACTORIO-TEST-MESSAGE-END")
      print("FACTORIO-TEST-RESULT:could not auto start")
      if (headless) error("FACTORIO-TEST-EXIT")
    }

    if (modToTest == "") {
      return autoStartError("Cannot auto-start tests: no mod selected.")
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

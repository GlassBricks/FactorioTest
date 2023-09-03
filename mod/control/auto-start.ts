import { Remote, Settings } from "../constants"
import { LocalisedString } from "factorio:runtime"

script.on_event(defines.events.on_game_created_from_scenario, () => {
  const shouldAutoStart = settings.startup[Settings.AutoStart]!.value
  if (!shouldAutoStart) return

  const modToTest = settings.global[Settings.ModToTest]!.value as string

  function autoStartError(message: LocalisedString) {
    game.print(message)
    print("FACTORIO-TEST-MESSAGE-START")
    log(message)
    print("FACTORIO-TEST-MESSAGE-END")
    print("FACTORIO-TEST-RESULT:could not auto start")
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

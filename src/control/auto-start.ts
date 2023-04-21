import { Remote, Settings } from "../constants"

script.on_event(defines.events.on_game_created_from_scenario, () => {
  const shouldAutoStart = settings.startup[Settings.AutoStart]!.value
  if (!shouldAutoStart) return

  const modToTest = settings.global[Settings.ModToTest]!.value as string

  function errorMessage(message: LocalisedString) {
    game.print(message)
    log(message)
    log("FACTORIO-TEST: failed, cannot start")
  }

  if (modToTest == "") {
    return errorMessage("Cannot auto-start tests: no mod selected.")
  }

  if (!(modToTest in script.active_mods)) {
    return errorMessage(`Cannot auto-start tests: mod ${modToTest} is not active.`)
  }

  if (remote.interfaces[Remote.FactorioTest] == undefined) {
    return errorMessage("Cannot auto-start tests: the selected mod is not registered with Factorio Test.")
  }

  remote.call(Remote.FactorioTest, "runTests", modToTest)
})

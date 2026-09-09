import { Protocol, Remote } from "../constants"
import { getAutoStartConfig, isAutoStartEnabled, isHeadlessMode } from "../factorio-test/auto-start-config"
import { LocalisedString } from "factorio:runtime"
import { hasAutoStarted, markAutoStarted, startTests } from "./start-tests"

function armAutoStart() {
  if (!isAutoStartEnabled()) return
  if (hasAutoStarted()) return

  const headless = isHeadlessMode()
  const modToTest = getAutoStartConfig().mod!

  script.on_event(defines.events.on_tick, () => {
    script.on_event(defines.events.on_tick, undefined)

    function autoStartError(message: LocalisedString) {
      if (!headless) game.print(message)
      log(message)
      print(Protocol.MessageStart)
      log(message)
      print(Protocol.MessageEnd)
      print(Protocol.Result + "could not auto start")
      if (headless) error(Protocol.Exit)
    }

    if (!(modToTest in script.active_mods)) {
      return autoStartError(`Cannot auto-start tests: mod ${modToTest} is not active.`)
    }

    if (!remote.interfaces[Remote.FactorioTest]) {
      return autoStartError("Cannot auto-start tests: the selected mod is not registered with Factorio Test.")
    }

    markAutoStarted()
    startTests(modToTest)
  })
}

// on_init instead of on_load when the save was created without factorio-test present
script.on_load(armAutoStart)
script.on_init(armAutoStart)

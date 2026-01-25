import { Misc, Remote } from "../constants"
import { getPlayer } from "../factorio-test/_util"
import { guiAction } from "./guiAction"

guiAction(Misc.CloseTestGui, () => {
  if (remote.interfaces[Remote.FactorioTest]) {
    remote.call(Remote.FactorioTest, "cancelTestRun")
    remote.call(Remote.FactorioTest, "fireCustomEvent", "closeProgressGui")
  }
  getPlayer().gui.screen[Misc.TestGui]?.destroy()
})

guiAction(Misc.CancelTestRun, () => {
  if (remote.interfaces[Remote.FactorioTest]) {
    remote.call(Remote.FactorioTest, "cancelTestRun")
  }
})

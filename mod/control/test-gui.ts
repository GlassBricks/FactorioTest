import { OnGuiClickEvent } from "factorio:runtime"
import { Misc, Remote } from "../constants"
import { getPlayer } from "../factorio-test/shared/util"
import { guiAction } from "./guiAction"

guiAction(Misc.CloseTestGui, () => {
  if (remote.interfaces[Remote.FactorioTest]) {
    remote.call(Remote.FactorioTest, "cancelTestRun")
  }
  getPlayer().gui.screen[Misc.TestGui]?.destroy()
})

guiAction(Misc.CancelTestRun, () => {
  if (remote.interfaces[Remote.FactorioTest]) {
    remote.call(Remote.FactorioTest, "cancelTestRun")
  }
})

guiAction(Misc.StepAction, (e: OnGuiClickEvent) => {
  if (remote.interfaces[Remote.FactorioTest]) {
    remote.call(Remote.FactorioTest, "stepAction", e.element.tags.stepAction)
  }
})

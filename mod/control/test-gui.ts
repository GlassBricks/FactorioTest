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

function stepAction(action: string) {
  return () => {
    if (remote.interfaces[Remote.FactorioTest]?.stepAction) {
      remote.call(Remote.FactorioTest, "stepAction", action)
    }
  }
}

guiAction(Misc.StepNext, stepAction("next"))
guiAction(Misc.StepSkipTest, stepAction("skipTest"))
guiAction(Misc.StepRunRest, stepAction("runRest"))

import { guiAction } from "./guiAction"
import { Misc, Remote } from "../shared-constants"

guiAction(Misc.CloseProgressGui, () => {
  if (remote.interfaces[Remote.TestMod]) {
    remote.call(Remote.TestMod, "fireCustomEvent", "closeProgressGui")
  }
})

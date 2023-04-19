import { guiAction } from "./guiAction"
import { Misc, Remote } from "../shared-constants"

function getPlayer(): LuaPlayer | undefined {
  // noinspection LoopStatementThatDoesntLoopJS
  for (const [, player] of game.players) {
    return player
  }
}

guiAction(Misc.CloseProgressGui, () => {
  if (remote.interfaces[Remote.FactorioTest]) {
    remote.call(Remote.FactorioTest, "fireCustomEvent", "closeProgressGui")
  }
  getPlayer()?.gui.screen[Misc.TestProgressGui]?.destroy()
})

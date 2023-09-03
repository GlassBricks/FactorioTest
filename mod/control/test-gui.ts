import { guiAction } from "./guiAction"
import { Misc, Remote } from "../constants"
import { LuaPlayer } from "factorio:runtime"

function getPlayer(): LuaPlayer | undefined {
  // noinspection LoopStatementThatDoesntLoopJS
  for (const [, player] of game.players) {
    return player
  }
}

guiAction(Misc.CloseTestGui, () => {
  if (remote.interfaces[Remote.FactorioTest]) {
    remote.call(Remote.FactorioTest, "fireCustomEvent", "closeProgressGui")
  }
  getPlayer()?.gui.screen[Misc.TestGui]?.destroy()
})

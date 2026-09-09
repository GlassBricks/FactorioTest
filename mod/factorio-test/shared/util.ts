import { LuaPlayer } from "factorio:runtime"

export function getPlayer(): LuaPlayer {
  return game.players[1] ?? error("No player found")
}

export const debugAdapterEnabled = script.active_mods["debugadapter"] !== undefined

export function assertNever(value: never): never {
  return error(`value ${value} should be never`)
}

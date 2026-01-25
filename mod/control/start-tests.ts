import { Remote } from "../constants"
import { postLoadAction } from "./post-load-action"

declare const storage: {
  __tests_autostarted?: boolean
}

export function hasAutoStarted(): boolean {
  return storage.__tests_autostarted === true
}

export function markAutoStarted(): void {
  storage.__tests_autostarted = true
}

export function startTests(modToTest?: string): boolean {
  if (!remote.interfaces[Remote.FactorioTest]) return false
  remote.call(Remote.FactorioTest, "runTests", modToTest)
  return true
}

const triggerStartTests = postLoadAction("startTests", () => startTests())

export function reloadAndStartTests(): void {
  game.reload_mods()
  triggerStartTests()
}

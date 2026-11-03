import type { TestRunPayload } from "../../../types/config"
import { Misc, Settings } from "../../constants"

function decodePayload(raw: string | undefined): TestRunPayload {
  if (!raw?.startsWith(Misc.TestRunPayloadPrefix)) return {}
  return helpers.json_to_table(raw.slice(Misc.TestRunPayloadPrefix.length)) as TestRunPayload
}

function readPayload(): TestRunPayload {
  if (script.test_arg !== undefined) return decodePayload(script.test_arg)
  return decodePayload(settings.startup[Settings.AutoStartConfig]?.value as string | undefined)
}

let cachedPayload: TestRunPayload | undefined

export function getTestRunPayload(): TestRunPayload {
  return (cachedPayload ??= readPayload())
}

export function isHeadlessMode(): boolean {
  return script.test_arg !== undefined
}

export function isAutoStartEnabled(): boolean {
  const mod = getTestRunPayload().mod
  return mod !== undefined && mod !== ""
}

export function getAutoStartMod(): string | undefined {
  return getTestRunPayload().mod
}

export function finishHeadlessTest(passed: boolean): void {
  if (isHeadlessMode()) script.finish_test(passed)
}

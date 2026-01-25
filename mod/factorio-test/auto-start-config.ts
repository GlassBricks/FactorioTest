import { Settings } from "../constants"

export interface AutoStartConfig {
  mod?: string
  headless?: boolean
  last_failed_tests?: string[]
}

let cachedConfig: AutoStartConfig | undefined

export function getAutoStartConfig(): AutoStartConfig {
  if (cachedConfig) return cachedConfig
  const json = settings.startup[Settings.AutoStartConfig]?.value as string | undefined
  if (!json || json === "{}") {
    cachedConfig = {}
    return cachedConfig
  }
  cachedConfig = helpers.json_to_table(json) as AutoStartConfig
  return cachedConfig
}

export function isHeadlessMode(): boolean {
  return getAutoStartConfig().headless === true
}

export function isAutoStartEnabled(): boolean {
  const config = getAutoStartConfig()
  return config.mod !== undefined && config.mod !== ""
}

export function getAutoStartMod(): string | undefined {
  return getAutoStartConfig().mod
}

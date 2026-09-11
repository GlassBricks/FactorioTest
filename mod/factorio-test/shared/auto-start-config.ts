import { Settings } from "../../constants"

export interface AutoStartConfig {
  mod?: string
  headless?: boolean
  last_failed_tests?: string[]
}

function parseAutoStartConfig(): AutoStartConfig {
  const json = settings.startup[Settings.AutoStartConfig]?.value as string | undefined
  if (!json || json === "{}") return {}
  return helpers.json_to_table(json) as AutoStartConfig
}

let cachedConfig: AutoStartConfig | undefined

export function getAutoStartConfig(): AutoStartConfig {
  return (cachedConfig ??= parseAutoStartConfig())
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

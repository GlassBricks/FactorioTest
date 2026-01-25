import Config = FactorioTest.Config
import { Settings } from "../constants"

function getSettingsConfig(): Partial<Config> {
  const json = settings.global[Settings.Config]?.value as string | undefined
  if (!json || json === "{}") return {}
  return helpers.json_to_table(json) as Partial<Config>
}

const defaultConfig: Config = {
  default_timeout: 60 * 60,
  default_ticks_between_tests: 1,
  game_speed: 1000,
  log_passed_tests: true,
  log_skipped_tests: false,
  sound_effects: false,
  reorder_failed_first: true,
}

export function fillConfig(modConfig: Partial<Config>): Config {
  const settingsConfig = getSettingsConfig()

  return {
    ...defaultConfig,
    ...modConfig,
    ...settingsConfig,
  }
}

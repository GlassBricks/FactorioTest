import Config = FactorioTest.Config
import { getTestRunPayload } from "./shared/auto-start-config"

const defaultConfig: Config = {
  default_timeout: 60 * 60,
  default_ticks_between_tests: 1,
  game_speed: 1000,
  log_passed_tests: true,
  log_skipped_tests: false,
  sound_effects: false,
  reorder_failed_first: false,
  load_luassert: false,
  step: false,
}

export function withDefaultConfig(config: Partial<Config>): Config {
  return { ...defaultConfig, ...config }
}

export function disableStepIfHeadless(config: Config, headless: boolean): { config: Config; warning?: string } {
  if (!headless || !config.step) return { config }
  return {
    config: { ...config, step: false },
    warning: "factorio-test: step requires graphics mode (there is no GUI to continue from); ignoring it",
  }
}

/** The CLI's config overrides the config the mod under test passed in. */
export function resolveConfig(modConfig: Partial<Config>): Config {
  return withDefaultConfig({ ...modConfig, ...(getTestRunPayload().config as Partial<Config> | undefined) })
}

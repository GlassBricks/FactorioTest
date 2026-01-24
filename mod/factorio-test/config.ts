import Config = FactorioTest.Config

export function fillConfig(config: Partial<Config>): Config {
  return {
    default_timeout: 60 * 60,
    default_ticks_between_tests: 1,
    game_speed: 1000,
    log_passed_tests: true,
    log_skipped_tests: false,
    sound_effects: false,
    ...config,
  }
}

import Config = FactorioTest.Config

export function fillConfig(config: Partial<Config>): Config {
  const showProgressGui = config.show_progress_gui !== false
  const logToDa = config.log_to_DA !== false
  return {
    show_progress_gui: showProgressGui,
    default_timeout: 60 * 60,
    default_ticks_between_tests: 1,
    game_speed: 1000,
    log_to_game: !showProgressGui,
    log_to_DA: logToDa,
    log_to_log: !logToDa,
    log_passed_tests: true,
    log_skipped_tests: false,
    sound_effects: false,
    ...config,
  }
}

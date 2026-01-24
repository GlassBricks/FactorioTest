export interface TestRunnerConfig {
  test_pattern?: string
  tag_whitelist?: string[]
  tag_blacklist?: string[]
  default_timeout?: number
  game_speed?: number
  log_passed_tests?: boolean
  log_skipped_tests?: boolean
}

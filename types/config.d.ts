/**
 * Startup setting the CLI sets to auto-start a test run. Snake_case: read by the Factorio mod.
 */
export interface AutoStartConfig {
  mod?: string
  headless?: boolean
  last_failed_tests?: string[]
}

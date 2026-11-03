/**
 * What the CLI sends to start a test run: `--test-arg` (headless) or via the auto-start startup setting (graphics),
 * as `TEST_RUN_PAYLOAD_PREFIX + JSON`. Snake_case: read by the Factorio mod.
 */
export interface TestRunPayload {
  mod?: string
  last_failed_tests?: string[]
  config?: Record<string, unknown>
}

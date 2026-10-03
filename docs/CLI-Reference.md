# CLI Reference

The Factorio Test CLI runs tests from the command line, suitable for CI/CD pipelines and local development.

Run `npx factorio-test run --help` for usage info and examples.

## Installation

```bash
npm install -g factorio-test-cli
# or, as a dev dependency
npm install -D factorio-test-cli
```

## Config File

Options can be set in a config file instead of on the command line. The CLI looks for configuration in, in order:

1. Path specified via `-c, --config <path>`
2. `factorio-test.json` in the current directory
3. `"factorio-test"` key in `package.json`

Keys are the camelCase form of the long CLI flag (`--game-speed` → `gameSpeed`). CLI arguments override the config file.

| Config Key | CLI Flag | Description |
|------------|----------|-------------|
| `modPath` | `-p, --mod-path` | Path to mod folder |
| `modName` | `--mod-name` | Name of mod in data directory |
| `factorioPath` | `--factorio-path` | Path to Factorio binary |
| `dataDirectory` | `-d, --data-directory` | Factorio data directory (default: `./factorio-test-data-dir`) |
| `save` | `--save` | Path to save file |
| `mods` | `--mods` | Additional mods to enable (array) |
| `factorioArgs` | `--factorio-args` | Extra Factorio arguments (array) |
| `verbose` | `-v, --verbose` | Verbose logging; pipe Factorio output to stdout |
| `quiet` | `-q, --quiet` | Only show the final result |
| `outputFile` | `--output-file`, `--no-output-file` | Test results JSON path, or `false` to disable |
| `forbidOnly` | `--[no-]forbid-only` | Fail if `.only` tests are present (default: `true`) |
| `outputTimeout` | `--output-timeout` | Kill Factorio after this many seconds without output; `0` disables (default: `15`) |
| `watchPatterns` | `--watch-patterns` | Glob patterns to watch (array) |
| `udpPort` | `--udp-port` | UDP port for graphics watch mode (default: `14434`) |

`modPath`, `factorioPath`, `dataDirectory`, `save`, and `outputFile` are resolved relative to the config file.

`--graphics`, `--watch`, and `--no-auto-start` are command-line only.

### Test Execution Options

These are passed to the mod, and override the corresponding (snake_case) in-mod [Lua config](Configuration.md):

| Config Key | CLI Flag | Lua Config | Description |
|------------|----------|------------|-------------|
| `testPattern` | `--test-pattern` | `test_pattern` | Filter tests by Lua pattern (or array of patterns, any must match) matched against the full test path. Combined with positional filter arguments |
| `tagWhitelist` | `--tag-whitelist` | `tag_whitelist` | Only run tests with these tags |
| `tagBlacklist` | `--tag-blacklist` | `tag_blacklist` | Skip tests with these tags |
| `defaultTimeout` | `--default-timeout` | `default_timeout` | Async test timeout (ticks) |
| `gameSpeed` | `--game-speed` | `game_speed` | Game speed multiplier |
| `bail` | `-b, --bail [count]` | `bail` | Stop after n failures (flag alone: 1) |
| `reorderFailedFirst` | `--[no-]reorder-failed-first` | `reorder_failed_first` | Run failed tests first |
| `logPassedTests` | `--[no-]log-passed-tests` | `log_passed_tests` | Log passed test names |
| `logSkippedTests` | `--log-skipped-tests` | `log_skipped_tests` | Log skipped test names |
| `step` | `--step` | `step` | Pause before each test and step ([Step Mode](Running-Tests.md#step-mode)); requires `--graphics` |

### Example

```json
{
  "modPath": "./my-mod",
  "dataDirectory": "./factorio-test-data",
  "mods": ["quality", "space-age"],
  "tagBlacklist": ["slow"],
  "gameSpeed": 10
}
```

### Deprecated: `test` key

Previously, test execution options were nested under a `test` key in snake_case (`"test": { "game_speed": 10 }`). This is still accepted, with a deprecation warning. Setting an option both at the top level and under `test` is an error.

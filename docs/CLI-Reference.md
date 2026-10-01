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

### CLI Options

These use camelCase in the config file:

| Config Key | CLI Flag | Description |
|------------|----------|-------------|
| `modPath` | `--mod-path` | Path to mod folder |
| `modName` | `--mod-name` | Name of mod in data directory |
| `factorioPath` | `--factorio-path` | Path to Factorio binary |
| `dataDirectory` | `--data-directory` | Factorio data directory |
| `save` | `--save` | Path to save file |
| `mods` | `--mods` | Additional mods to enable (array) |
| `factorioArgs` | `--factorio-args` | Extra Factorio arguments (array) |
| `verbose` | `-v, --verbose` | Verbose logging; pipe Factorio output to stdout |
| `quiet` | `-q, --quiet` | Only show the final result |
| `outputFile` | `--output-file` | Test results JSON path |
| `forbidOnly` | `--forbid-only` | Fail if `.only` tests are present (default: `true`) |
| `outputTimeout` | `--output-timeout` | Kill Factorio after this many seconds without output; `0` disables (default: `15`) |
| `watchPatterns` | `--watch-patterns` | Glob patterns to watch (array) |
| `udpPort` | `--udp-port` | UDP port for graphics watch mode (default: `14434`) |

`modPath`, `factorioPath`, `dataDirectory`, `save`, and `outputFile` are resolved relative to the config file.

### Test Execution Options

Test execution options are nested under a `test` key and use snake_case. These override the in-mod [Lua config](Configuration.md):

| Config Key | CLI Flag | Description |
|------------|----------|-------------|
| `test_pattern` | `--test-pattern` | Filter tests by Lua pattern (or array of patterns, any must match) matched against the full test path. Combined with positional filter arguments |
| `tag_whitelist` | `--tag-whitelist` | Only run tests with these tags |
| `tag_blacklist` | `--tag-blacklist` | Skip tests with these tags |
| `default_timeout` | `--default-timeout` | Async test timeout (ticks) |
| `game_speed` | `--game-speed` | Game speed multiplier |
| `bail` | `-b, --bail [count]` | Stop after n failures (flag alone: 1) |
| `reorder_failed_first` | `--reorder-failed-first` | Run failed tests first |
| `log_passed_tests` | `--log-passed-tests` | Log passed test names |
| `log_skipped_tests` | `--log-skipped-tests` | Log skipped test names |

### Example

```json
{
  "modPath": "./my-mod",
  "dataDirectory": "./factorio-test-data",
  "mods": ["quality", "space-age"],
  "test": {
    "tag_blacklist": ["slow"],
    "game_speed": 10
  }
}
```

# CLI Reference

The Factorio Test CLI runs tests from the command line, suitable for CI/CD pipelines and local development.

Run `npx factorio-test run --help` for usage info and examples.

## Test target

Specify exactly one of these, as what is tested:

| Config Key     | CLI Flag          | Description                                                                      |
| -------------- | ----------------- | -------------------------------------------------------------------------------- |
| `modPath`      | `-p, --mod-path`  | Path to mod folder; symlinked into the mods folder                               |
| `modName`      | `--mod-name`      | Name of mod in data directory                                                    |
| `scenarioPath` | `--scenario-path` | Path to scenario folder; symlinked into `<data directory>/scenarios`             |
| `scenario`     | `--scenario`      | Scenario as `[mod/]name`: from `<data directory>/scenarios`, or shipped in a mod |

Exception: `--mod-path` with `--scenario <mod>/<name>` tests that mod's scenario. The mod is enabled with its dependencies, but its own tests are not run.
A scenario from another mod needs that mod enabled, e.g. with `--mods`.

A scenario's tests run in a new game created from it (`--scenario2map`), so `--save` and `--start-scenario` can't be used with a scenario target.

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

| Config Key       | CLI Flag                            | Description                                                                                                                                      |
| ---------------- | ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `factorioPath`   | `--factorio-path`                   | Path to Factorio binary                                                                                                                          |
| `dataDirectory`  | `-d, --data-directory`              | Factorio data directory (default: `./factorio-test-data-dir`)                                                                                    |
| `save`           | `--save`                            | Path to save file                                                                                                                                |
| `startScenario`  | `--start-scenario`                  | Testing a mod: start in a new game from this scenario (`[mod/]name`, e.g. `base/freeplay`), instead of the default save                          |
| `mods`           | `--mods`                            | Additional mods to enable, e.g. `["space-age", "flib >= 0.16", "!quality"]` (array)                                                              |
| `frozenLockfile` | `--[no-]frozen-lockfile`            | Fail if the lock file is missing or out of date, instead of updating it (default: on if the `CI` environment variable is set). See [Mods](#mods) |
| `factorioArgs`   | `--factorio-args`                   | Extra Factorio arguments (array)                                                                                                                 |
| `verbose`        | `-v, --verbose`                     | Verbose logging; pipe Factorio output to stdout                                                                                                  |
| `quiet`          | `-q, --quiet`                       | Only show the final result                                                                                                                       |
| `outputFile`     | `--output-file`, `--no-output-file` | Test results JSON path, or `false` to disable                                                                                                    |
| `forbidOnly`     | `--[no-]forbid-only`                | Fail if `.only` tests are present (default: `true`)                                                                                              |
| `outputTimeout`  | `--output-timeout`                  | Kill Factorio after this many seconds without output; `0` disables (default: `15`)                                                               |
| `watchPatterns`  | `--watch-patterns`                  | Glob patterns to watch (array)                                                                                                                   |
| `udpPort`        | `--udp-port`                        | UDP port for graphics watch mode (default: `14434`)                                                                                              |

`modPath`, `scenarioPath`, `factorioPath`, `dataDirectory`, `save`, and `outputFile` are resolved relative to the config file.

`--graphics`, `--watch`, and `--no-auto-start` are command-line only.

### Test Execution Options

These are passed to the mod, and override the corresponding (snake_case) in-mod [Lua config](Configuration.md):

| Config Key           | CLI Flag                      | Lua Config             | Description                                                                                                                                      |
| -------------------- | ----------------------------- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| `testPattern`        | `--test-pattern`              | `test_pattern`         | Filter tests by Lua pattern (or array of patterns, any must match) matched against the full test path. Combined with positional filter arguments |
| `tagWhitelist`       | `--tag-whitelist`             | `tag_whitelist`        | Only run tests with these tags                                                                                                                   |
| `tagBlacklist`       | `--tag-blacklist`             | `tag_blacklist`        | Skip tests with these tags                                                                                                                       |
| `defaultTimeout`     | `--default-timeout`           | `default_timeout`      | Async test timeout (ticks)                                                                                                                       |
| `gameSpeed`          | `--game-speed`                | `game_speed`           | Game speed multiplier                                                                                                                            |
| `bail`               | `-b, --bail [count]`          | `bail`                 | Stop after n failures (flag alone: 1)                                                                                                            |
| `reorderFailedFirst` | `--[no-]reorder-failed-first` | `reorder_failed_first` | Run failed tests first                                                                                                                           |
| `logPassedTests`     | `--[no-]log-passed-tests`     | `log_passed_tests`     | Log passed test names                                                                                                                            |
| `logSkippedTests`    | `--log-skipped-tests`         | `log_skipped_tests`    | Log skipped test names                                                                                                                           |
| `step`               | `--step`                      | `step`                 | Pause before each test and step ([Step Mode](Running-Tests.md#step-mode)); requires `--graphics`                                                 |

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

## Mod management

Each run will enable the mods it needs, and attempt to install them from the mod portal if missing.

- The mod under test
- `factorio-test`
- Extra mods listed in `mods` config or `--mods` cli arg
- All mod's transitive dependencies (required, and recommended `+`)

All other mods will be disabled. Use config to enable additional mods.

### Configuring additional mods

`mods` entries use the `info.json` dependency format, `[!] name [op version]`:

```json
{ "mods": ["space-age", "flib >= 0.16", "!quality"] }
```

- `name` enables a mod; `op version` (`<`, `<=`, `=`, `>=`, `>`) enforces a specific version.
- `!name` keeps a mod disabled; this also leaves out a recommended optional dependency (e.g. `space-age` recommends `quality`).
- DLC mods are listed like any other mod.

### Mod versions and the lock file

The CLI will attempt to automatically install all your mod's dependencies, plus any mods declared in the `mods` config option. Mod resolution will prefer to use already locked or installed versions first; before trying to download from the mod portal.

Only if your mod has external dependencies, chosen mod versions will be recorded in `factorio-test.lock.json`. This file next to the config file (or in the current directory, without one). Commit it, so collaborators and CI then use the same versions, even after newer ones are released.

If your mod or config does not depend on any mods besides base-game mods, no lock file is created or needed.

### Updating mod versions

To update mods version, run `factorio-test mods update` (all mods), or `factorio-test mods update [MOD...]`.

### Providing mods yourself

For manual or advanced setups: directories and symlinks in the mods folder (`<data directory>/mods`), and zip files matching the locked version are used as-is. Use them for your own builds, or mods not on the mod portal.

### Downloading

Downloading from the mod portal requires a Factorio account. Credentials can be supplied from:

1. The `FACTORIO_USERNAME` and `FACTORIO_TOKEN` environment variables (your token is shown on https://factorio.com/profile.
   Note: the "token" is not the same as Mod portal API keys; these don't work for downloads.)
2. From a Factorio installation, in common locations, where you've already logged in.

### Commands

- `factorio-test mods install` will resolve and download needed mods, and update the lock file, without running tests.
- `factorio-test mods update [MODS...]`: updates the named mods (or all mods, if none named) to the newest compatible versions, and updates the lock file.

`factorio-test run` does `mods install`, then enables the mods and runs the tests.

These take the same `--config`, `--mod-path` / `--mod-name`, `--mods`, `--data-directory` and `--factorio-path` options. `--mod-path` / `--mod-name` are optional here.

## Unreleased

### Features

- Added `.step()` test api: allows breaking up a test into multiple independent optionally named "steps". Can be used for interactively stepping through a test (see step mode), or having multiple distinct "async" contexts.
- Added step mode: (`--step` with CLI, `step` option in config). When running in-game (graphics mode), allows pause before each test, to interactively watch and step through tests. Requires factorio-test mod v3.1.1.

#### Improved mod management and CI

Enabled mods and dependencies are now automatically managed.

This also enables easier CI setups; see docs on how to configure CI.

- Missing mods and dependencies will be attempted to be downloaded from the mod portal, automatically.
- Only the mod under test, configured mods, and transitive dependencies will be enabled.
  - Configure extra mods or specific mod versions through the `mods` key in the config file, or through the `--mods` cli arg.
  - Use `"!quality"` to omit a recommended optional dependency.
- Configured extra mods (in `factorio-test.json` config file, or `--mods` cli arg) use `info.json` dependency format: `"flib >= 0.16"`. The `name=true` / `name=false` syntax in `mods` is no longer supported.
- Manually installed mods (folders, symlinks, zip files matching configured version) are preferred and used as-is.

- Chosen mod versions are recorded in `factorio-test.lock.json`, generated on first run; commit it so collaborators and CI use the same versions.
- New `factorio-test mods install` command: resolves and downloads mods and updates the lock file, without running tests.
- New `factorio-test mods update [names...]` command: updates mods to the newest versions on mod portal, and updates the lock file.

### Changes

- The Space Age DLC mods are now always disabled by default; you can manually enable them via config. (Previously, DLC mods may be accidentally enabled).
- Config file options are now all top-level camelCase. Test execution options previously under `"test"` in snake_case (e.g. `"test": { "game_speed": 10 }`) are now e.g. `"gameSpeed": 10`. The `test` key is still accepted, with a deprecation warning.
- `"outputFile": false` in a config file disables writing the results file, like `--no-output-file`.
- The bundled default save used for tests is now a Factorio 2.1 save with only the `base` mod. This should remove migration notifications when run in graphics mode.

### Fixes

- Running the CLI with `npx factorio-test-cli` without installing it no longer fails to find `fmtk`.
- Invalid numeric CLI option values (e.g. `--udp-port abc`) are now reported as errors, instead of being ignored.
- Factorio output with CRLF line endings no longer produces spurious empty lines.
- In `--watch` mode, a rerun now waits for the cancelled run to finish cleaning up, so rapid file changes no longer leave a stale uncancellable run.
- Multiple filter arguments now run tests matching any of them (previously matched nothing). They are also combinable with `--test-pattern`, instead of replacing it.
- `outputFile` in a config file is now resolved relative to the config file, consistent with other paths.
- Fixed incorrect `read-data` path in the generated `config.ini` on macOS (#3). If affected, delete `config.ini` in the data directory (default `./factorio-test-data-dir`) to regenerate it.

## v3.6.0

- Updated for Factorio 2.1!
- Skipped tests are no longer printed in verbose mode output.
- Recognize `recycler` as a built-in 2.1 mod (no longer downloaded from the portal).

## v3.5.1

### Changes

- `--reorder-failed-first` is now disabled by default. Use `--reorder-failed-first` to opt in.

### Improvements

- Improved help text.

## v3.5.0

### Features

- Added `--no-auto-start` option to launch factorio without auto-starting tests (requires `--graphics`).

## v3.4.0

### Improvements

- Verbose mode now shows human-readable event messages instead of raw JSON.
- Verbose mode no longer duplicates log lines in per-test results (logs are already streamed inline).

## v3.3.1

### Improvements

- Describe block errors (e.g. failing `after_all` hooks) are now displayed in CLI output.
- Test failure recap now shows the test name on the first line, followed by labeled "Log messages:" and "Errors:" sections.

## v3.3.0

### Improvements

- Error messages for Factorio crashes/hangs now include the path to `factorio-current.log`.

## v3.2.0

### Features

- `--output-timeout <seconds>` option to detect and kill stuck Factorio processes (default: 15s, 0 to disable).

### Improvements

- Rich test summary with failure/todo recaps and a counts line (e.g. `Tests: 1 failed, 2 passed (3 total)`).

## v3.1.2

- Updated help text to note that test filters are lua patterns.

## v3.1.1

### Features

- `--version` flag to display CLI version.

## v3.1.0

### Features

- Mods specified in config `mods` array are now automatically downloaded from the mod portal if not present.
- Support version constraints in mod dependencies (e.g., `"modName >= 1.2.0"`). Outdated mods are automatically updated.

### Improvements

- Suppress fmtk output unless `--verbose` is enabled.

## v3.0.5

### Bugfixes

- Fix broken symlinks not being replaced when setting up mod path.

## v3.0.4

### Bugfixes

- Fix regression where CLI errors displayed full stack trace instead of clean message.

## v3.0.3

### Improvements

- Improved CLI output when run in headless mode.

## v3.0.2

### Bugfixes

- Fix progress bar crash when test count exceeds expected total.
- Fix skipped/todo tests incorrectly counted in progress and printed without `--verbose`.

## v3.0.1

### Bugfixes

- Fix missing config/ directory in published package.

## v3.0.0

See also: [mod changelog](../mod/changelog.txt) for in-game test framework changes.

### Breaking Changes

- **CLI argument changes**: `--mod-path` is now a named option instead of positional. Use `--factorio-args` to pass arguments to Factorio instead of `--` separator.
- **Requires factorio-test mod v3.0.0+**: The CLI now validates mod version compatibility on startup.

### Features

- **Headless test running**: Tests now run without GUI.
- **Graphics mode**: Use `--graphics` flag to run with the in-game GUI, with same config options. GUI will persist after tests finish.
- **Test runner options in config**: Options previously only configurable in Lua (`game_speed`, `default_timeout`, `tag_whitelist`, `tag_blacklist`, `log_passed_tests`, `log_skipped_tests`) can now be set in config file or via CLI.
- **Config file support**: Configure options via `factorio-test.json` or `package.json["factorio-test"]`. CLI options override file settings.
- **`--watch` flag**: Monitor files and automatically rerun tests on changes. Now works with `--graphics` mode using UDP-triggered reloads.
- **`--bail <n>` option**: Stop test execution after n failures.
- **`--forbid-only` (default) / `--no-forbid-only`**: Fail when `.only` tests are present. Enabled by default; use `--no-forbid-only` to allow `.only` tests.
- **`--quiet` flag**: Suppress per-test output for cleaner logs.
- **Progress bar**: Display test progress during TTY execution.
- **`test-results.json` output**: Test results saved to file for failed test reordering.
- **`reorder_failed_first` config option**: Run previously failed tests first.
- **Automatic mod dependency downloading**: Missing mod dependencies are automatically fetched from the mod portal.
- **Cleaner error messages**: CLI errors display without stack traces.

### Bugfixes

- Fix test duration display in CLI output.
- Fix Node.js deprecation warning (DEP0190).

## v2.0.0

- Added "--mods" option, to control the mods that are loaded when running. All other mods are now disabled by default.
- The default factorio data directory is now `./factorio-test-data-dir` instead of just `./factorio-test-data`.
- Improved help text.

## v1.0.5

- Fixed problems when used on Windows.
- Made error messages more informative.

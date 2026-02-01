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

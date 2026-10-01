## Registering Tests

To register your mod with Factorio Test, add this to the end of your `control.lua`:

```lua
if script.active_mods["factorio-test"] then
    require("__factorio-test__/init")(
        { "my-test-file", "another-test-file" },
        { --[[ optional config ]] }
    )
end
```

You do _not_ have to add Factorio Test as a dependency of your mod.

Tests are only loaded if both the Factorio Test mod is active _and_ your mod is selected for testing.
It's suggested to not import test files in regular code, as Factorio Test may not always be active.

## Running from CLI (recommended)

For CI/CD and command-line testing, use the CLI:

```bash
npx factorio-test run -p ./my-mod
```

The CLI will try to auto-detect your Factorio installation, set up an isolated data directory for mods, saves, and config; download mods if needed; then run tests in headless mode.
By default it uses a bundled save file, that has an empty world, is filled with lab tiles, and has one player with the name "" (empty string).
Exits with code 0 only if all tests pass.
Messages logged via `print` or `localised_print` are captured and shown with failing tests.

You can also run with `--graphics`, which instead launches the game in graphical mode with the same settings and setup.

See [CLI Reference](CLI-Reference.md) for all available options.

## Running in-game

You'll need to manually set up the environment:

1. Open Factorio
2. Make sure both Factorio Test and your mod are enabled
3. Open or create a save
4. Click the "Tests" button in the upper left corner
5. Select your mod from the list (if not listed, verify your `control.lua` setup)
6. Click "Reload mods and run tests"

An in-game GUI will display test progress and info.

Test output is also printed to the Factorio log file.
If [Factorio DebugAdapter](https://github.com/justarandomgeek/vscode-factoriomod-debug) is detected,
output goes to the debug console with clickable links instead.

## CLI options

### Watch Mode

Use `--watch` to automatically rerun tests when files change:

```bash
npx factorio-test run --mod-path ./my-mod --watch
```

In headless mode, this restarts the Factorio process on each change.

With `--graphics --watch`, the CLI sends a UDP signal to trigger in-game reload without restarting (port set by `--udp-port`, default `14434`).

Configure watched patterns with `--watch-patterns` (default: `info.json`, `**/*.lua`).

### Test Results File

By default, test results are written to `test-results.json` in the data directory. With `--reorder-failed-first`, this file is used to run previously failed tests first.

Control output with:

- `--output-file <path>` - Custom output path
- `--no-output-file` - Disable results file

# Running Tests

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
Avoid requiring test files from regular code, as Factorio Test may not be active.

## Running from the CLI (Recommended)

For CI/CD and command-line testing, use the CLI:

```bash
npx factorio-test run -p ./my-mod
```

The CLI auto-detects your Factorio installation, sets up an isolated data directory (mods, saves, config), downloads mods if needed, then runs tests in headless mode.
By default it uses a bundled save: an empty lab-tile world with one player named `""` (empty string).
The CLI exits with code 0 only if all tests pass.
Messages logged via `print` or `localised_print` are captured and shown with failing tests.

Use `--graphics` to launch the game in graphical mode instead, with the same setup.

See [CLI Reference](CLI-Reference.md) for all available options.

## Running In-Game

This requires manually setting up the environment:

1. Open Factorio
2. Make sure both Factorio Test and your mod are enabled
3. Open or create a save
4. Click the "Tests" button in the upper left corner
5. Select your mod from the list (if not listed, verify your `control.lua` setup)
6. Click "Reload mods and run tests"

An in-game GUI displays test progress and results.

Test output is also printed to the Factorio log file.
If [Factorio DebugAdapter](https://github.com/justarandomgeek/vscode-factoriomod-debug) is detected,
output goes to the debug console with clickable links instead.

## CLI Options

### Watch Mode

Use `--watch` to automatically rerun tests when files change:

```bash
npx factorio-test run --mod-path ./my-mod --watch
```

In headless mode, this restarts the Factorio process on each change.

With `--graphics --watch`, the CLI sends a UDP signal to trigger in-game reload without restarting (port set by `--udp-port`, default `14434`).

Configure watched patterns with `--watch-patterns` (default: `info.json`, `**/*.lua`).

### Test Results File

By default, test results are written to `test-results.json` in the data directory. With `--reorder-failed-first`, the CLI uses this file to run previously failed tests first.

Control output with:

- `--output-file <path>` - Custom output path
- `--no-output-file` - Disable results file

This page covers in-mod Lua configuration. For CLI and config file options, see [CLI Reference](CLI-Reference.md).

## Lua Configuration

Pass a config table as the second argument to `require("__factorio-test__/init")`:

```lua
require("__factorio-test__/init")(
    { "my-test-file" },
    {
        load_luassert = true,
        game_speed = 100,
        default_timeout = 120 * 60,
    }
)
```

## Config Options

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `load_luassert` | boolean | `false` | Enable the luassert assertion library |
| `default_timeout` | number | `3600` | Default timeout for async tests (ticks) |
| `default_ticks_between_tests` | number | `1` | Ticks to wait between tests |
| `game_speed` | number | `1000` | Game speed during test runs |
| `log_passed_tests` | boolean | `true` | Show passed tests in output |
| `log_skipped_tests` | boolean | `false` | Show skipped tests in output |
| `reorder_failed_first` | boolean | `false` | Run previously failed tests first |
| `bail` | number | - | Stop after n failures |
| `sound_effects` | boolean | `false` | Play sound effects on test completion |
| `test_pattern` | string | - | Only run tests whose full path (e.g. `block > test`) matches this Lua pattern |
| `tag_whitelist` | string[] | - | Only run tests with all these tags |
| `tag_blacklist` | string[] | - | Skip tests with any of these tags |
| `before_test_run` | function | - | Called before tests start |
| `after_test_run` | function | - | Called after tests complete |

## CLI Override

When using the CLI, some options from the command line or config file override the corresponding Lua options. The priority order is:

1. In-mod Lua config (lowest priority)
2. Config file (`test` key)
3. CLI options (highest priority)

For more details, see `factorio-test run --help` or [CLI Reference](CLI-Reference.md).

## Example

```lua
require("__factorio-test__/init")(
    { "my-test-file" },
    {
        tag_blacklist = { "slow" },
        log_passed_tests = true,
        before_test_run = function()
            game.surfaces[1].clear()
        end,
        after_test_run = function()
            log("Tests completed")
        end,
    }
)
```

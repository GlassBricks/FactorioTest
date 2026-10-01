## Setup

1. Add one or more test files to your mod:

```lua
-- my-first-test.lua
test("Hello, World!", function()
    assert(game.surfaces[1].name == "nauvis")
end)
```

2. Add the following to the bottom of your `control.lua`:

```lua
if script.active_mods["factorio-test"] then
    require("__factorio-test__/init")({ "my-first-test" }, { --[[ optional config ]] })
end
```

See [Configuration](Configuration.md) for config options.

## Running Tests with CLI (Recommended)

Install the CLI with npm:

```bash
npm install -g factorio-test-cli
# or, as a dev dependency
npm install -D factorio-test-cli
```

Run tests:

```bash
npx factorio-test run -p ./path/to/your/mod
```

For more details, see `factorio-test run --help` or [CLI Reference](CLI-Reference.md).

## Running Tests in-game

This will require some manual setup.

See [Running Tests](Running-Tests.md#running-in-game).

## Next Steps

See the [documentation index](README.md) for more information on particular topics.

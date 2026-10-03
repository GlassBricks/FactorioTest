# Writing Tests

Factorio Test takes inspiration from [Jest](https://jestjs.io/) and [Busted](https://olivinelabs.com/busted/).

## Defining Tests

Use `describe` to define test blocks, and `test`/`it` to define tests:

```lua
test("a file-level test", function()
    assert(game.surfaces[1].name == "nauvis")
end)

describe("a block", function()
    test("inside describe", function()
    end)

    describe("nested", function()
        describe("the factory", function()
            it("must grow", function()
            end)
        end)
    end)
end)
```

Code in describe blocks runs when the file is loaded.
Code that interacts with the game or must run in an event belongs in a `test` or a lifecycle hook (see below), not directly in a describe block.

## Setup and Teardown

Use `before_each` and `after_each` to run code before/after each test in a file or describe block.
Use `before_all` and `after_all` for code that runs once before/after _all_ tests in a block.

Use `after_test` _inside_ a test to run code after that specific test completes.

`after_*` hooks always run, whether the test passed or failed.

```lua
before_all(function()
    setup_the_world()
end)

after_all(function()
    clean_up_the_world()
end)

before_each(function()
    prepare_the_factory()
end)

after_each(function()
    reset_the_factory()
end)

test("some test", function()
    after_test(function()
        clean_up_for_this_test_only()
    end)
    assert(...)
end)
```

## Optional luassert

luassert is opt-in. To use the [luassert](https://github.com/Olivine-Labs/luassert) library, enable it in your config:

```lua
require("__factorio-test__/init")({ "my-test" }, { load_luassert = true })
```

With luassert enabled, you can use assertions like:

```lua
assert.are_equal("nauvis", game.surfaces[1].name)
assert.is_true(condition)
assert.is_nil(value)
```

## Skipping Tests

Use `test.skip`/`it.skip` to skip a single test. Use `describe.skip` to skip an entire describe block.

```lua
test.skip("skipped", function()
    -- ...
end)
describe.skip("a block", function()
    -- everything in here will be skipped
end)
```

## Focused Tests

Use `test.only`, `it.only`, or `describe.only` to run only the marked tests.

```lua
test.only("this one", function()
    -- ...
end)
describe("a block", function()
    -- everything in here will be skipped unless it also has .only
end)
```

If a describe block with `.only` has nested items with `.only`, only the inner `.only` items run.

```lua
describe.only("a block", function()
    test.only("this one", function()
        -- ...
    end)
    test("this one will be skipped", function()
        -- ...
    end)
end)
```

By default, the CLI fails if `.only` tests are present, to prevent accidentally committing focused tests. Allow them with `--no-forbid-only`.

## Todo Tests

Use `test.todo(description)` as a placeholder for a test you plan to implement later.
Todo tests show up as TODO items in the test output.

```lua
test.todo("find more iron")
```

## Parameterized Tests

To run the same test on multiple inputs, use `test.each` or `describe.each`.

### Basic Usage

```lua
test.each({ 2, 6, 8 })("%d is even", function(v)
    assert(v % 2 == 0)
end)
```

With multiple parameters per test case:

```lua
test.each({
    { 1, 1, 2 },
    { 3, 4, 7 },
    { 2, 2, 4 }
})("%d + %d = %d", function(a, b, expected)
    assert(a + b == expected)
end)
```

### Template Syntax

The test name supports several template placeholders:

| Placeholder      | Description            |
| ---------------- | ---------------------- |
| `%d`, `%s`, etc. | Lua format specifiers  |
| `%#`             | 0-based item index     |
| `%$`             | 1-based item index     |
| `%p`             | Pretty-formatted value |
| `$property`      | Object property access |
| `$foo.bar`       | Nested property access |

Example with object properties:

```lua
test.each({
    { id = 1, name = "first" },
    { id = 2, name = "second" }
})("test $id: $name", function(params)
    assert(params.id > 0)
end)
-- Generates: "test 1: first", "test 2: second"
```

Example with index placeholders:

```lua
test.each({ "a", "b", "c" })("case %$ (%#): %s", function(letter)
    assert(letter)
end)
-- Generates: "case 1 (0): a", "case 2 (1): b", "case 3 (2): c"
```

## Asynchronous Tests

Asynchronous tests run across multiple game ticks.

There are three ways to make a test async:

1. Call `async()` within a test to mark it async. Call `done()` (possibly in a later tick) to mark it complete.
   The test will fail if `done()` is not called within the timeout period. Pass a timeout in ticks to `async` to override the default timeout (3600 ticks = 1 minute).
2. Use `after_ticks(ticks, fn)` to run a function after the given number of ticks. The test finishes when all `after_ticks` functions complete.
3. Use `on_tick(fn)` to add a function that runs every tick during the test. Return `false` from the function to remove it.

These methods may be combined. Without `async()`, the test finishes only after:

- all `on_tick` functions have been removed
- all `after_ticks` functions have run

With `async()`, the test always finishes when `done()` is called.

```lua
test("Items appear after waiting", function()
    local chest = surface.find_entities_filtered{ name = "iron-chest" }[1]
    wish_for_items()
    after_ticks(80, function()
        assert(chest.get_inventory(defines.inventory.chest).get_item_count() > 1)
    end)
end)

test("custom async test", function()
    async(1000)
    on_tick(function()
        if condition_met() then
            done()
        end
    end)
    -- fails if condition not met within 1000 ticks
end)

test("multiple conditions", function()
    setup_world()
    on_tick(function()
        if cond1() then return false end
    end)
    on_tick(function()
        if cond2() then return false end
    end)
    -- fails if both conditions are not met within 3600 ticks
end)
```

The default async timeout can be changed via [Configuration](Configuration.md).

## Steps

Chain `.step(fn)` or `.step(caption, fn)` after a test to split it into parts that run in sequence.

Each step starts on a new tick, with its own `async()` context: it starts once the previous part
completes, and `async`, `done`, `on_tick` and `after_ticks` apply to the part they are called in.

Steps are also breakpoints where [step mode](Running-Tests.md#step-mode) will pause within a test,
which can be useful for interactive in-game debugging.

```lua
test("connects an underground pipe", function()
    place_underground()
end)
    .step("place the covering tile", function()
        place_tile()
    end)
    .step(function()
        assert_connected()
    end)
```

- Use `.step`, not `:step`.
- `on_tick` and `after_ticks` handlers stop when their part completes; register them in each part
  that needs them.
- Steps can be mixed with `after_reload_mods` and `after_reload_script`.

## Tags

Tag a test or describe block by calling `tags` immediately before its definition:

```lua
tags("slow", "integration")
test("a tagged test", function()
    -- ...
end)
```

Tags on a describe block apply to everything inside it.

Tests can be filtered by tag via `--tag-whitelist` and `--tag-blacklist`. See [Configuration](Configuration.md).

## Ticks Between Tests

By default, tests run 1 tick apart. Use `ticks_between_tests(ticks)` to set a different wait time
(including 0). This applies only to the remainder of the current describe block or file.

```lua
ticks_between_tests(2)
test("a test", function()
end)
test("another test", function()
    -- waits 2 ticks after the previous test
end)
ticks_between_tests(0)
test("immediate test", function()
    -- runs immediately after the previous test
end)
```

The default can be changed via [Configuration](Configuration.md).

## Testing Save/Reload Behavior

Test save/reload behavior by chaining `after_reload_mods(fn)` or `after_reload_script(fn)` after a test.
These call `game.reload_mods()` and `game.reload_script()`, respectively.

This also tags the test with `"after_reload_mods"` or `"after_reload_script"`.

**Warning**: A reload **reruns** all files, so anything not stored in `storage` or in the game itself is reset, including local variables.

```lua
test("reload test", function()
    storage.foo = { data = 123 }
end).after_reload_mods(function()
    assert(storage.foo.data == 123)
end)
```

```lua
local foo = 0
test("reload test", function()
    foo = 1
end).after_reload_mods(function()
    -- foo is reset to 0 after reload
    assert(foo == 0)
end)
```
